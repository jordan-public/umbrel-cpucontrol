const nodeFs = require('fs');
const fs = nodeFs.promises;
const path = require('path');
const os = require('os');

// Sysfs paths
const PSTATE_DIR = '/sys/devices/system/cpu/intel_pstate';
const NO_TURBO_FILE = path.join(PSTATE_DIR, 'no_turbo');
const MAX_PERF_FILE = path.join(PSTATE_DIR, 'max_perf_pct');
const SMT_CONTROL_FILE = '/sys/devices/system/cpu/smt/control';
const THERMAL_DIR = '/sys/class/thermal';
const POWERCAP_DIR = '/sys/class/powercap';

let previousRaplSample = null;

async function safeWrite(filePath, data) {
    try {
        await fs.writeFile(filePath, data.toString(), 'utf8');
        console.log(`Wrote ${data} to ${filePath}`);
        return true;
    } catch (err) {
        console.error(`Failed to write to ${filePath}: ${err.message}`);
        return false;
    }
}

async function safeRead(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return data.trim();
    } catch (err) {
        // Fallback for development/macOS
        return null;
    }
}

async function setThrottling(pct) {
    // 10% to 100%
    const val = Math.max(10, Math.min(100, pct));
    await safeWrite(MAX_PERF_FILE, val);
}

function roundToTenth(value) {
    return Math.round(value * 10) / 10;
}

async function canWrite(filePath) {
    try {
        await fs.access(filePath, nodeFs.constants.W_OK);
        return true;
    } catch (err) {
        return false;
    }
}

async function getThermalZones() {
    try {
        const dirs = await fs.readdir(THERMAL_DIR);
        const zones = dirs.filter(d => d.startsWith('thermal_zone'));
        const readings = [];

        for (const zone of zones) {
            const zonePath = path.join(THERMAL_DIR, zone);
            const tempFile = path.join(zonePath, 'temp');
            const typeFile = path.join(zonePath, 'type');

            try {
                const tempStr = await fs.readFile(tempFile, 'utf8');
                const tempVal = parseInt(tempStr, 10);
                if (isNaN(tempVal)) continue;

                const type = await safeRead(typeFile);
                readings.push({
                    id: zone,
                    name: type || zone,
                    temperature: roundToTenth(tempVal / 1000)
                });
            } catch (e) {
                // Ignore zones that can't be read
            }
        }

        return readings;
    } catch (err) {
        return [];
    }
}

async function setTurboBoost(enabled) {
    const noTurbo = enabled ? 0 : 1;
    await safeWrite(NO_TURBO_FILE, noTurbo);
}

async function checkTurboSupported() {
    try {
        const cpuinfo = await fs.readFile('/proc/cpuinfo', 'utf8');
        if (cpuinfo.includes('ida')) {
            return true;
        }
    } catch (e) {
        // Ignored
    }
    return false;
}

async function getTemperature() {
    const zones = await getThermalZones();
    if (zones.length > 0) {
        return Math.max(...zones.map(zone => zone.temperature));
    }
    
    // Default fallback if no sysfs available (e.g. on Mac)
    return 45.0 + Math.random() * 5.0; // dummy temp
}

async function walkPowercapDirs(dirPath, depth = 0) {
    if (depth > 3) return [];

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const dirs = [];

        for (const entry of entries) {
            if ((!entry.isDirectory() && !entry.isSymbolicLink()) || !entry.name.startsWith('intel-rapl')) continue;

            const childPath = path.join(dirPath, entry.name);
            dirs.push(childPath);
            dirs.push(...await walkPowercapDirs(childPath, depth + 1));
        }

        return dirs;
    } catch (err) {
        return [];
    }
}

async function findRaplPackageZone() {
    const dirs = await walkPowercapDirs(POWERCAP_DIR);
    const candidates = [];

    for (const dir of dirs) {
        const name = await safeRead(path.join(dir, 'name'));
        const energyFile = path.join(dir, 'energy_uj');
        const limitFile = path.join(dir, 'constraint_0_power_limit_uw');
        const energy = await safeRead(energyFile);
        const limit = await safeRead(limitFile);

        if (energy === null && limit === null) continue;

        candidates.push({
            dir,
            name: name || path.basename(dir),
            energyFile,
            limitFile
        });
    }

    return candidates.find(zone => /package|pkg/i.test(zone.name)) || candidates[0] || null;
}

async function getRaplState() {
    const zone = await findRaplPackageZone();
    if (!zone) {
        previousRaplSample = null;
        return {
            supported: false,
            powerDrawWatts: null,
            powerLimitWatts: null,
            minPowerLimitWatts: null,
            maxPowerLimitWatts: null,
            writable: false
        };
    }

    const energyRaw = await safeRead(zone.energyFile);
    const maxEnergyRaw = await safeRead(path.join(zone.dir, 'max_energy_range_uj'));
    let powerDrawWatts = null;

    if (energyRaw !== null) {
        const energy = parseInt(energyRaw, 10);
        const maxEnergy = maxEnergyRaw !== null ? parseInt(maxEnergyRaw, 10) : null;
        const now = Date.now();

        if (!isNaN(energy) && previousRaplSample && previousRaplSample.file === zone.energyFile) {
            let energyDelta = energy - previousRaplSample.energy;
            if (energyDelta < 0 && maxEnergy && !isNaN(maxEnergy)) {
                energyDelta = (maxEnergy - previousRaplSample.energy) + energy;
            }

            const seconds = (now - previousRaplSample.time) / 1000;
            if (energyDelta >= 0 && seconds > 0) {
                powerDrawWatts = roundToTenth((energyDelta / 1000000) / seconds);
            }
        }

        if (!isNaN(energy)) {
            previousRaplSample = {
                file: zone.energyFile,
                energy,
                time: now
            };
        }
    }

    const limitRaw = await safeRead(zone.limitFile);
    const minRaw = await safeRead(path.join(zone.dir, 'constraint_0_min_power_uw'));
    const maxRaw = await safeRead(path.join(zone.dir, 'constraint_0_max_power_uw'));
    const writable = limitRaw !== null && await canWrite(zone.limitFile);

    const parsedLimit = limitRaw !== null ? parseInt(limitRaw, 10) : NaN;
    const parsedMin = minRaw !== null ? parseInt(minRaw, 10) : NaN;
    const parsedMax = maxRaw !== null ? parseInt(maxRaw, 10) : NaN;
    const powerLimitWatts = !isNaN(parsedLimit) ? roundToTenth(parsedLimit / 1000000) : null;
    const minPowerLimitWatts = !isNaN(parsedMin) ? roundToTenth(parsedMin / 1000000) : null;
    const maxPowerLimitWatts = !isNaN(parsedMax) ? roundToTenth(parsedMax / 1000000) : null;

    return {
        supported: true,
        name: zone.name,
        powerDrawWatts,
        powerLimitWatts,
        minPowerLimitWatts: minPowerLimitWatts || 1,
        maxPowerLimitWatts,
        writable
    };
}

async function setRaplPowerLimitWatts(watts) {
    const requestedWatts = Number(watts);
    if (Number.isNaN(requestedWatts)) return false;

    const rapl = await getRaplState();
    if (!rapl.supported || !rapl.writable || rapl.powerLimitWatts === null) return false;

    const min = rapl.minPowerLimitWatts || 1;
    const max = rapl.maxPowerLimitWatts || Math.max(requestedWatts, rapl.powerLimitWatts);
    const clamped = Math.max(min, Math.min(max, requestedWatts));
    const microwatts = Math.round(clamped * 1000000);

    const zone = await findRaplPackageZone();
    if (!zone) return false;
    return safeWrite(zone.limitFile, microwatts);
}

let previousCpu = getCpuTimes();

function getCpuTimes() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    if (!cpus) return { idle: 0, total: 0 };
    for(const core of cpus) {
        for(const type in core.times) {
            total += core.times[type];
        }
        idle += core.times.idle;
    }
    return { idle, total };
}

function getCpuLoad() {
    const start = previousCpu;
    const end = getCpuTimes();
    previousCpu = end;
    
    const idleDifference = end.idle - start.idle;
    const totalDifference = end.total - start.total;
    
    if (totalDifference === 0) return 0;
    return 100 - (100 * idleDifference / totalDifference);
}

async function getCpuModelName() {
    try {
        const cpuinfo = await fs.readFile('/proc/cpuinfo', 'utf8');
        const lines = cpuinfo.split('\n');
        for (const line of lines) {
            if (line.startsWith('model name')) {
                const parts = line.split(':');
                if (parts.length > 1) {
                    return parts[1].trim();
                }
            }
        }
    } catch (e) {
        // Ignored, might be on a system without /proc/cpuinfo
    }
    return "Unknown CPU";
}

async function getCurrentState() {
    // Attempt to read current state from sysfs
    const noTurbo = await safeRead(NO_TURBO_FILE);
    const maxPerf = await safeRead(MAX_PERF_FILE);
    const smtControl = await safeRead(SMT_CONTROL_FILE);
    
    const thermalZones = await getThermalZones();
    const temp = thermalZones.length > 0
        ? Math.max(...thermalZones.map(zone => zone.temperature))
        : await getTemperature();
    
    let throttling = 100;
    if (maxPerf !== null) {
        throttling = parseInt(maxPerf, 10);
    }
    
    let turboboost = true;
    if (noTurbo !== null) {
        turboboost = parseInt(noTurbo, 10) === 0;
    }
    
    const turboSupported = await checkTurboSupported();
    
    const load = getCpuLoad();
    
    const modelName = await getCpuModelName();
    const rapl = await getRaplState();

    return {
        temperature: roundToTenth(temp),
        thermalZones,
        load: roundToTenth(load),
        throttling,
        turboboost,
        turboSupported,
        modelName,
        rapl
    };
}

module.exports = {
    setThrottling,
    setTurboBoost,
    setRaplPowerLimitWatts,
    getTemperature,
    getThermalZones,
    getCurrentState,
    getCpuModelName
};
