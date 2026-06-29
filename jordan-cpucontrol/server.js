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

function getLocalCidr() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const parts = iface.address.split('.');
                return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
            }
        }
    }
    return '192.168.1.0/24';
}

let globalState = {
    throttling: 100,
    turboboost: true,
    apiEnabled: false,
    apiAllowedIp: getLocalCidr()
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
        
        await cpu.setThrottling(globalState.throttling);
        await cpu.setTurboBoost(globalState.turboboost);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('No saved state found. Using system defaults.');
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
    
    // Check IP
    const clientIp = extractIPv4(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
    if (!isIpInCidr(clientIp, globalState.apiAllowedIp)) {
        return res.status(403).json({ error: `IP ${clientIp} not allowed by CIDR ${globalState.apiAllowedIp}` });
    }
    
    next();
});

// API Endpoints
app.get('/api/status', async (req, res) => {
    try {
        const state = await cpu.getCurrentState();
        
        res.json({
            temperature: state.temperature,
            turboSupported: state.turboSupported,
            throttling: globalState.throttling,
            turboboost: globalState.turboboost,
            apiEnabled: globalState.apiEnabled,
            apiAllowedIp: globalState.apiAllowedIp
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { throttling, turboboost, apiEnabled, apiAllowedIp } = req.body;
    
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
