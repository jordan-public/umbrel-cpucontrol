const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cpu = require('./cpu');
const pkg = require('./package.json');

const app = express();
app.use(express.json());

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

let globalState = {
    throttling: 100,
    turboboost: true,
    tempUnit: 'C'
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
        
        if (state.throttling !== undefined) globalState.throttling = state.throttling;
        if (state.turboboost !== undefined) globalState.turboboost = state.turboboost;
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

// Serve UI
app.get('/', async (req, res) => {
    try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
        res.send(html);
    } catch (err) {
        res.status(500).send('Error loading UI');
    }
});

// Serve static assets (if any)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

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
            tempUnit: globalState.tempUnit
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { throttling, turboboost, tempUnit } = req.body;
    
    try {
        if (throttling !== undefined) {
            globalState.throttling = Math.max(10, Math.min(100, throttling));
            await cpu.setThrottling(globalState.throttling);
        }
        if (turboboost !== undefined) {
            globalState.turboboost = !!turboboost;
            await cpu.setTurboBoost(globalState.turboboost);
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
