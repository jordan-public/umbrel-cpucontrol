const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const cpu = require('./cpu');
const pkg = require('./package.json');

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
    tempUnit: 'C',
    raplPowerLimitWatts: null
};

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
        
        const currentState = await cpu.getCurrentState();
        if (state.throttling !== undefined) globalState.throttling = state.throttling;
        if (state.apiEnabled !== undefined) globalState.apiEnabled = state.apiEnabled;
        if (state.tempUnit !== undefined) globalState.tempUnit = state.tempUnit;
        if (state.raplPowerLimitWatts !== undefined) globalState.raplPowerLimitWatts = state.raplPowerLimitWatts;
        
        if (currentState.turboSupported) {
            if (state.turboboost !== undefined) globalState.turboboost = state.turboboost;
            await cpu.setTurboBoost(globalState.turboboost);
        } else {
            globalState.turboboost = false;
        }

        await cpu.setThrottling(globalState.throttling);
        if (globalState.raplPowerLimitWatts !== null && currentState.rapl && currentState.rapl.writable) {
            await cpu.setRaplPowerLimitWatts(globalState.raplPowerLimitWatts);
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log('No saved state found. Discovering current system state.');
            try {
                const currentState = await cpu.getCurrentState();
                globalState.throttling = currentState.throttling;
                if (currentState.rapl && currentState.rapl.writable && currentState.rapl.powerLimitWatts !== null) {
                    globalState.raplPowerLimitWatts = currentState.rapl.powerLimitWatts;
                }
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
    const queryUiToken = typeof req.query.uiToken === 'string' ? req.query.uiToken : '';

    // If request comes from the UI (has the token), allow it unconditionally
    if (req.headers['x-ui-token'] === UI_TOKEN || queryUiToken === UI_TOKEN) {
        return next();
    }

    // Otherwise, check if API is enabled
    if (!globalState.apiEnabled) {
        return res.status(403).json({ error: 'API access is disabled. Enable it in the UI.' });
    }

    next();
});

// API Endpoints
app.get('/api/status', async (req, res) => {
    try {
        const state = await cpu.getCurrentState();
        
        res.json({
            version: pkg.version,
            temperature: state.temperature,
            load: state.load,
            turboSupported: state.turboSupported,
            throttling: globalState.throttling,
            turboboost: globalState.turboboost,
            apiEnabled: globalState.apiEnabled,
            tempUnit: globalState.tempUnit,
            modelName: state.modelName,
            thermalZones: state.thermalZones,
            rapl: state.rapl,
            raplPowerLimitWatts: globalState.raplPowerLimitWatts
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { throttling, turboboost, apiEnabled, tempUnit, raplPowerLimitWatts } = req.body;
    
    try {
        const currentState = await cpu.getCurrentState();

        if (throttling !== undefined) {
            globalState.throttling = Math.max(10, Math.min(100, throttling));
            await cpu.setThrottling(globalState.throttling);
        }
        if (turboboost !== undefined && currentState.turboSupported) {
            globalState.turboboost = !!turboboost;
            await cpu.setTurboBoost(globalState.turboboost);
        } else if (!currentState.turboSupported) {
            globalState.turboboost = false;
        }
        if (apiEnabled !== undefined) {
            globalState.apiEnabled = !!apiEnabled;
        }
        if (tempUnit !== undefined) {
            globalState.tempUnit = tempUnit;
        }
        if (raplPowerLimitWatts !== undefined && currentState.rapl && currentState.rapl.writable) {
            const requestedRapl = Number(raplPowerLimitWatts);
            if (!Number.isNaN(requestedRapl)) {
                const min = currentState.rapl.minPowerLimitWatts || 1;
                const max = currentState.rapl.maxPowerLimitWatts || requestedRapl;
                globalState.raplPowerLimitWatts = Math.max(min, Math.min(max, requestedRapl));
                await cpu.setRaplPowerLimitWatts(globalState.raplPowerLimitWatts);
            }
        }
        
        await saveState();
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 80;

startup().then(() => {
    app.listen(PORT, () => {
        console.log(`Umbrel CPU Control app listening on port ${PORT}`);
    });
});
