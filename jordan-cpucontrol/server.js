const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const cpu = require('./cpu');

const app = express();
app.use(express.json());

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

function extractIPv4(ip) {
    if (!ip) return '';
    const parts = ip.split(','); // in case of multiple IPs in x-forwarded-for
    let firstIp = parts[0].trim();
    if (firstIp.includes('::ffff:')) {
        return firstIp.split('::ffff:')[1];
    }
    return firstIp;
}

function getBestClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    const xri = req.headers['x-real-ip'];
    const remote = req.socket.remoteAddress;
    
    // Prefer proxy headers if they exist
    if (xff) {
        const ip = extractIPv4(xff);
        if (ip && !ip.startsWith('10.21.') && !ip.startsWith('127.')) return ip;
    }
    if (xri) {
        const ip = extractIPv4(xri);
        if (ip && !ip.startsWith('10.21.') && !ip.startsWith('127.')) return ip;
    }
    
    // Fallback
    return extractIPv4(xff || xri || remote || '');
}

function getHostIp(req) {
    let host = req.headers.host || '';
    if (host.includes(':')) host = host.split(':')[0];
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
        if (!host.startsWith('127.') && !host.startsWith('10.21.')) {
            return host;
        }
    }
    return null;
}

function isIpInCidr(ip, cidr) {
    try {
        const [range, bits] = cidr.split('/');
        const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
        return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
    } catch {
        return false;
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
    const clientIp = getBestClientIp(req);
    if (!isIpInCidr(clientIp, globalState.apiAllowedIp)) {
        return res.status(403).json({ error: `Access denied. Your IP (${clientIp}) is not within the allowed CIDR block (${globalState.apiAllowedIp}).` });
    }
    
    next();
});

// API Endpoints
app.get('/api/status', async (req, res) => {
    try {
        const state = await cpu.getCurrentState();
        
        res.json({
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
