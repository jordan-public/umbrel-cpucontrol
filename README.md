# Umbrel CPU Control

**DISCLAIMER:** Use at your own risk. The developer, Jordan Stojanovski, assumes no responsibility or liability for any hardware damage, system instability, or data loss that may arise from using this software to modify core CPU parameters.

Protect your Umbrel node from overheating and overloading! This app allows you to monitor and manage your CPU directly. Keep a close eye on hardware health with real-time CPU Temperature, CPU Load, CPU Power, and available thermal sensor readings. You can actively manage thermal performance by manually toggling Turbo Boost, dialing in a specific Max Performance percentage, or setting a Running Average Power Limit when your hardware exposes RAPL controls.

Source code: https://github.com/jordan-public/umbrel-cpucontrol

## Features
- **CPU Temperature Monitoring:** View the current CPU temperature and any additional thermal zones exposed by the host.
- **CPU Power Monitoring:** View measured CPU power draw when RAPL energy counters are available.
- **Turbo Boost Control:** Toggle Turbo Boost on or off when supported by the CPU.
- **Max Performance:** Adjust the CPU performance limit between 10% and 100%.
- **Running Average Power Limit:** Adjust the CPU package power limit in watts when writable RAPL controls are available.
- **Preset Buttons:** Quickly apply Powersave, Cool, Moderate, or Performance settings from the main page.
- **Persistent State:** The app saves your configuration and automatically restores it upon startup.
- **API Access:** Exposes HTTP endpoints for reading and writing CPU parameters programmatically.

## Security and Networking

The web UI is served through Umbrel's app proxy with Umbrel authentication enabled. The container does not publish port `3000` directly to the LAN.

The `/api/*` endpoints are whitelisted at the Umbrel proxy so local automation such as Home Assistant can call them. API requests are only accepted when API access is enabled in the app UI. Token-based API authorization is planned for a future release.

## Control Behavior

CPU Control does not run automatic tuning policies based on temperature, load, or power draw. It changes CPU parameters only when you use the UI, call the API, press a preset button, or when it restores previously saved user-selected settings on startup. If a host does not expose a supported sensor or writable control, that item is hidden from the UI.

## Home Assistant Integration
Want to add these controls to your smart home dashboard? Check out the **[Home Assistant Integration Guide](integrations/home-assistant/README.md)** for a complete, ready-to-use copy & paste YAML configuration!

## API Endpoints

### `GET /api/status`
Returns the current state of the CPU.
**Response:**
```json
{
  "version": "1.0.23",
  "temperature": 100,
  "load": 25.4,
  "turboSupported": true,
  "throttling": 100,
  "turboboost": true,
  "apiEnabled": true,
  "tempUnit": "C",
  "thermalZones": [
    {
      "id": "thermal_zone0",
      "name": "x86_pkg_temp",
      "temperature": 58.2
    }
  ],
  "rapl": {
    "supported": true,
    "name": "package-0",
    "powerDrawWatts": 12.4,
    "powerLimitWatts": 20,
    "minPowerLimitWatts": 1,
    "maxPowerLimitWatts": 45,
    "writable": true
  },
  "raplPowerLimitWatts": 20
}
```

### `POST /api/settings`
Updates the CPU parameters and saves the state.
**Request Body:**
```json
{
  "turboboost": false,
  "throttling": 20,
  "raplPowerLimitWatts": 15,
  "apiEnabled": true
}
```

## How It Works

The app controls the CPU by interacting directly with the Linux `sysfs` filesystem:
- **Max Performance:** Sets the percentage in `/sys/devices/system/cpu/intel_pstate/max_perf_pct`.
- **Turbo Boost:** Toggles Turbo Boost via `/sys/devices/system/cpu/intel_pstate/no_turbo`.
- **Temperature:** Reads from `/sys/class/thermal/thermal_zone*/temp`.
- **CPU Power and Running Average Power Limit:** Reads RAPL energy counters and power limits from `/sys/class/powercap/intel-rapl*`, and writes `constraint_0_power_limit_uw` only when the file exists and is writable.

To work within Umbrel, the container must be run with the necessary privileges and volume mounts to access `/sys`.

## Developer Notes
For instructions on how to build and deploy this app to Docker Hub (intended for developers, not end users), please refer to the [DEPLOY.md](DEPLOY.md) file.
