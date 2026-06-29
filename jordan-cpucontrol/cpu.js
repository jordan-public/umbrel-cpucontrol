const fs = require('fs').promises;
const path = require('path');

// Sysfs paths
const PSTATE_DIR = '/sys/devices/system/cpu/intel_pstate';
const NO_TURBO_FILE = path.join(PSTATE_DIR, 'no_turbo');
const MAX_PERF_FILE = path.join(PSTATE_DIR, 'max_perf_pct');
const SMT_CONTROL_FILE = '/sys/devices/system/cpu/smt/control';
const THERMAL_DIR = '/sys/class/thermal';

async function safeWrite(filePath, data) {
    try {
        await fs.writeFile(filePath, data.toString(), 'utf8');
        console.log(`Wrote ${data} to ${filePath}`);
    } catch (err) {
        console.error(`Failed to write to ${filePath}: ${err.message}`);
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

async function setTurboBoost(enabled) {
    const noTurbo = enabled ? 0 : 1;
    await safeWrite(NO_TURBO_FILE, noTurbo);
}

async function getTemperature() {
    try {
        const dirs = await fs.readdir(THERMAL_DIR);
        const zones = dirs.filter(d => d.startsWith('thermal_zone'));
        
        let maxTemp = 0;
        let found = false;
        
        for (const zone of zones) {
            const tempFile = path.join(THERMAL_DIR, zone, 'temp');
            const typeFile = path.join(THERMAL_DIR, zone, 'type');
            
            try {
                // Some thermal zones might not be CPU (e.g. acpitz, x86_pkg_temp)
                // Let's just find the max temp across all valid zones
                const tempStr = await fs.readFile(tempFile, 'utf8');
                const tempVal = parseInt(tempStr, 10);
                if (!isNaN(tempVal)) {
                    maxTemp = Math.max(maxTemp, tempVal);
                    found = true;
                }
            } catch (e) {
                // Ignore zones that can't be read
            }
        }
        
        if (found) {
            // temp is in millidegrees Celsius
            return maxTemp / 1000;
        }
    } catch (err) {
        // Fallback
    }
    
    // Default fallback if no sysfs available (e.g. on Mac)
    return 45.0 + Math.random() * 5.0; // dummy temp
}

async function getCurrentState() {
    // Attempt to read current state from sysfs
    const noTurbo = await safeRead(NO_TURBO_FILE);
    const maxPerf = await safeRead(MAX_PERF_FILE);
    const smtControl = await safeRead(SMT_CONTROL_FILE);
    
    const temp = await getTemperature();
    
    let throttling = 100;
    if (maxPerf !== null) {
        throttling = parseInt(maxPerf, 10);
    }
    
    let turboboost = true;
    if (noTurbo !== null) {
        turboboost = parseInt(noTurbo, 10) === 0;
    }
    
    return {
        temperature: Math.round(temp * 10) / 10,
        throttling,
        turboboost
    };
}

module.exports = {
    setThrottling,
    setTurboBoost,
    getTemperature,
    getCurrentState
};
