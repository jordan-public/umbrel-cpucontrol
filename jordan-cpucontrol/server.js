const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const dns = require('dns').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const cpu = require('./cpu');
const pkg = require('./package.json');

const app = express();
app.use(express.json());
const execFileAsync = promisify(execFile);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// Generate a random token on startup. The UI served from '/' will be given this token to bypass API checks.
const UI_TOKEN = crypto.randomBytes(16).toString('hex');

let globalState = {
    throttling: 100,
    turboboost: true,
    apiEnabled: false,
    apiAllowedIp: 'auto',
    tempUnit: 'C'
};

function ipToLong(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isValidIPv4(ip) {
    if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
    return ip.split('.').every(octet => {
        const value = Number(octet);
        return Number.isInteger(value) && value >= 0 && value <= 255;
    });
}

function normalizeIPv4(value) {
    if (!value) return '';
    let ip = String(value).trim().replace(/^"|"$/g, '');

    if (ip.includes('::ffff:')) {
        ip = ip.split('::ffff:')[1];
    }

    if (/^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(ip)) {
        ip = ip.slice(0, ip.lastIndexOf(':'));
    }

    const match = ip.match(/(\d{1,3}\.){3}\d{1,3}/);
    return match && isValidIPv4(match[0]) ? match[0] : '';
}

function extractIPv4(ip) {
    if (!ip) return '';
    const parts = String(ip).split(','); // in case of multiple IPs in x-forwarded-for
    return normalizeIPv4(parts[0]);
}

function getContainerNetworks() {
    const networks = [];
    const interfaces = os.networkInterfaces();

    for (const entries of Object.values(interfaces)) {
        for (const entry of entries || []) {
            if (entry.family !== 'IPv4' || entry.internal) continue;
            if (!isValidIPv4(entry.address) || !isValidIPv4(entry.netmask)) continue;

            const maskLong = ipToLong(entry.netmask);
            const prefix = maskLong.toString(2).split('1').length - 1;
            const networkLong = ipToLong(entry.address) & maskLong;
            const network = [
                (networkLong >>> 24) & 255,
                (networkLong >>> 16) & 255,
                (networkLong >>> 8) & 255,
                networkLong & 255
            ].join('.');

            networks.push({
                address: entry.address,
                cidr: `${network}/${prefix}`
            });
        }
    }

    return networks;
}

function isIpInCidr(ip, cidr) {
    try {
        if (!isValidIPv4(ip) || typeof cidr !== 'string' || !cidr.includes('/')) return false;
        const [range, bitsValue] = cidr.split('/');
        const bits = parseInt(bitsValue, 10);
        if (!isValidIPv4(range) || Number.isNaN(bits) || bits < 0 || bits > 32) return false;
        const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
        return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
    } catch {
        return false;
    }
}

function isContainerNetworkIp(ip) {
    if (!isValidIPv4(ip)) return false;
    return getContainerNetworks().some(network => isIpInCidr(ip, network.cidr));
}

function getForwardedHeaderIp(headerValue) {
    if (!headerValue) return '';
    const firstForwarded = String(headerValue).split(',')[0];
    const parts = firstForwarded.split(';').map(part => part.trim());
    const forPart = parts.find(part => part.toLowerCase().startsWith('for='));
    if (!forPart) return '';
    return normalizeIPv4(forPart.slice(4));
}

function getClientIpInfo(req) {
    const xff = req.headers['x-forwarded-for'];
    const xri = req.headers['x-real-ip'];
    const forwarded = req.headers.forwarded;
    const remote = req.socket.remoteAddress;

    if (forwarded) {
        const ip = getForwardedHeaderIp(forwarded);
        if (ip) return { ip, source: 'forwarded' };
    }

    if (xff) {
        const ip = extractIPv4(xff);
        if (ip) return { ip, source: 'x-forwarded-for' };
    }

    if (xri) {
        const ip = extractIPv4(xri);
        if (ip) return { ip, source: 'x-real-ip' };
    }

    return { ip: normalizeIPv4(remote), source: 'socket' };
}

function isLoopbackIp(ip) {
    return ip.startsWith('127.');
}

function isLinkLocalIp(ip) {
    return ip.startsWith('169.254.');
}

function isUsableUmbrelLocalIp(ip) {
    if (!isValidIPv4(ip)) return false;
    if (ip === '0.0.0.0' || isLoopbackIp(ip) || isLinkLocalIp(ip)) return false;
    if (isContainerNetworkIp(ip)) return false;
    return true;
}

function cidrFromIPv4(ip) {
    const parts = ip.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

async function resolveHostIPv4(hostname) {
    try {
        const addresses = await dns.lookup(hostname, { family: 4, all: true });
        return addresses.map(entry => entry.address).filter(isValidIPv4);
    } catch {
        return [];
    }
}

async function getRouteSourceIp() {
    try {
        const { stdout } = await execFileAsync('ip', ['route', 'get', '1.1.1.1'], { timeout: 1500 });
        const match = stdout.match(/\bsrc\s+((?:\d{1,3}\.){3}\d{1,3})\b/);
        return match ? normalizeIPv4(match[1]) : '';
    } catch {
        return '';
    }
}

async function detectUmbrelLocalCidr() {
    const candidates = [];
    const envNames = [
        'UMBREL_HOST_IP',
        'UMBREL_LOCAL_IP',
        'UMBREL_IP',
        'HOST_IP',
        'LOCAL_IP'
    ];

    for (const name of envNames) {
        candidates.push({ ip: normalizeIPv4(process.env[name]), source: `env:${name}` });
    }

    for (const hostname of ['umbrel.local', 'umbrel', 'host.docker.internal']) {
        const addresses = await resolveHostIPv4(hostname);
        for (const address of addresses) {
            candidates.push({ ip: address, source: `dns:${hostname}` });
        }
    }

    for (const network of getContainerNetworks()) {
        candidates.push({ ip: network.address, source: 'container-interface' });
    }

    candidates.push({ ip: await getRouteSourceIp(), source: 'route-src' });

    const chosen = candidates.find(candidate => isUsableUmbrelLocalIp(candidate.ip));
    if (chosen) {
        return {
            cidr: cidrFromIPv4(chosen.ip),
            ip: chosen.ip,
            source: chosen.source
        };
    }

    return {
        error: 'Could not detect Umbrel LAN subnet from host/DNS/route data. The container only exposed Docker network addresses.',
        rejectedCandidates: candidates
            .filter(candidate => candidate.ip)
            .map(candidate => `${candidate.source}:${candidate.ip}`)
    };
}

function canCheckClientAgainstConfiguredCidr(clientInfo) {
    if (clientInfo.source !== 'socket') return true;
    if (!isContainerNetworkIp(clientInfo.ip)) return true;
    return false;
}

function isConfiguredCidr(cidr) {
    if (cidr === '0.0.0.0/0') return true;
    if (typeof cidr !== 'string' || !cidr.includes('/')) return false;
    const [range, bits] = cidr.split('/');
    const prefix = parseInt(bits, 10);
    return isValidIPv4(range) && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32;
}

async function ensureAutoAllowedIpResolved() {
    if (globalState.apiAllowedIp !== 'auto') return;

    const detection = await detectUmbrelLocalCidr();
    if (detection.cidr) {
        globalState.apiAllowedIp = detection.cidr;
        await saveState();
        console.log(`Auto-detected Umbrel local CIDR: ${detection.cidr} (${detection.source})`);
    } else {
        console.warn(detection.error, detection.rejectedCandidates || []);
    }
}

// Ensure data dir exists
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
        console.error('Failed to create data directory:', err);
    }
}

// Load state and apply to system on startup
async function startup() {
    await ensureDataDir();
    try {
        const data = await fs.readFile(STATE_FILE, 'utf8');
        const state = JSON.parse(data);
        console.log('Restoring saved state on startup:', state);
        
        if (state.throttling !== undefined) globalState.throttling = state.throttling;
        if (state.turboboost !== undefined) globalState.turboboost = state.turboboost;
        if (state.apiEnabled !== undefined) globalState.apiEnabled = state.apiEnabled;
        if (state.apiAllowedIp !== undefined) globalState.apiAllowedIp = state.apiAllowedIp;
        if (state.tempUnit !== undefined) globalState.tempUnit = state.tempUnit;

        await ensureAutoAllowedIpResolved();
        
        await cpu.setThrottling(globalState.throttling);
        await cpu.setTurboBoost(globalState.turboboost);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('No saved state found. Discovering current system state.');
            try {
                const currentState = await cpu.getCurrentState();
                globalState.throttling = currentState.throttling;
                if (currentState.turboSupported) {
                    globalState.turboboost = currentState.turboboost;
                } else {
                    globalState.turboboost = false;
                }
                await ensureAutoAllowedIpResolved();
            } catch (e) {
                console.error('Failed to discover system state:', e);
            }
        } else {
            console.error('Error reading saved state:', err);
        }
    }
}

// Save state to file
async function saveState() {
    try {
        await fs.writeFile(STATE_FILE, JSON.stringify(globalState, null, 2), 'utf8');
        console.log('State saved to disk:', globalState);
    } catch (err) {
        console.error('Failed to save state:', err);
    }
}

// Serve UI with injected token
app.get('/', async (req, res) => {
    try {
        let html = await fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
        html = html.replace('__UI_TOKEN__', UI_TOKEN);
        res.send(html);
    } catch (err) {
        res.status(500).send('Error loading UI');
    }
});

// Serve static assets (if any)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// API Access Control Middleware
app.use('/api', (req, res, next) => {
    // If request comes from the UI (has the token), allow it unconditionally
    if (req.headers['x-ui-token'] === UI_TOKEN) {
        return next();
    }
    
    // Otherwise, check if API is enabled
    if (!globalState.apiEnabled) {
        return res.status(403).json({ error: 'API access is disabled. Enable it in the UI.' });
    }
    
    // Allow 0.0.0.0/0 as a catch-all bypass
    if (globalState.apiAllowedIp === '0.0.0.0/0') {
        return next();
    }

    // Check IP
    const clientInfo = getClientIpInfo(req);
    const clientIp = clientInfo.ip;

    if (!isConfiguredCidr(globalState.apiAllowedIp) || globalState.apiAllowedIp === 'auto') {
        return res.status(403).json({ error: 'API access CIDR is not configured. Set it in the Umbrel UI first.' });
    }

    if (!canCheckClientAgainstConfiguredCidr(clientInfo)) {
        return res.status(403).json({
            error: `Access denied. Docker only exposed the bridge peer (${clientIp}) to the app, so the original requester IP cannot be verified. Use a path that forwards the real client IP.`
        });
    }

    if (!isIpInCidr(clientIp, globalState.apiAllowedIp)) {
        return res.status(403).json({ error: `Access denied. Your IP (${clientIp}) is not within the allowed CIDR block (${globalState.apiAllowedIp}).` });
    }
    
    next();
});

// API Endpoints
app.get('/api/status', async (req, res) => {
    try {
        const state = await cpu.getCurrentState();
        const clientInfo = getClientIpInfo(req);
        
        res.json({
            version: pkg.version,
            clientIp: clientInfo.ip,
            clientIpSource: clientInfo.source,
            clientIpVerifiable: canCheckClientAgainstConfiguredCidr(clientInfo),
            temperature: state.temperature,
            load: state.load,
            turboSupported: state.turboSupported,
            throttling: globalState.throttling,
            turboboost: globalState.turboboost,
            apiEnabled: globalState.apiEnabled,
            apiAllowedIp: globalState.apiAllowedIp,
            tempUnit: globalState.tempUnit
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/umbrel-local-cidr', async (req, res) => {
    try {
        const detection = await detectUmbrelLocalCidr();
        if (detection.cidr) {
            return res.json(detection);
        }
        res.status(404).json(detection);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { throttling, turboboost, apiEnabled, apiAllowedIp, tempUnit } = req.body;
    
    try {
        if (throttling !== undefined) {
            globalState.throttling = Math.max(10, Math.min(100, throttling));
            await cpu.setThrottling(globalState.throttling);
        }
        if (turboboost !== undefined) {
            globalState.turboboost = !!turboboost;
            await cpu.setTurboBoost(globalState.turboboost);
        }
        if (apiEnabled !== undefined) {
            globalState.apiEnabled = !!apiEnabled;
        }
        if (apiAllowedIp !== undefined) {
            globalState.apiAllowedIp = apiAllowedIp;
        }
        if (tempUnit !== undefined) {
            globalState.tempUnit = tempUnit;
        }
        
        await saveState();
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;

startup().then(() => {
    app.listen(PORT, () => {
        console.log(`Umbrel CPU Control app listening on port ${PORT}`);
    });
});
