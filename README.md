# Umbrel CPU Control

**DISCLAIMER:** Use at your own risk. The developer, Jordan Stojanovski, assumes no responsibility or liability for any hardware damage, system instability, or data loss that may arise from using this software to modify core CPU parameters.

Protect your Umbrel node from overheating and overloading! This app allows you to monitor and manage your CPU directly. Keep a close eye on hardware health with real-time CPU Temperature and CPU Load metrics. You can actively manage thermal performance by manually toggling Turbo Boost or dialing in a specific CPU Throttling percentage to instantly cool down a machine running too hot. 

Source code: https://github.com/jordan-public/umbrel-cpucontrol

## Features
- **CPU Temperature Monitoring:** View the current CPU temperature in real-time.
- **Turbo Boost Control:** Toggle Turbo Boost on or off.
- **CPU Throttling:** Adjust the CPU performance limit between 10% and 100%.
- **Persistent State:** The app saves your configuration and automatically restores it upon startup.
- **API Access:** Exposes HTTP endpoints for reading and writing CPU parameters programmatically.

## API Endpoints

### `GET /api/status`
Returns the current state of the CPU.
**Response:**
```json
{
  "temperature": 100,
  "turboboost": true,
  "throttling": 100
}
```

### `POST /api/settings`
Updates the CPU parameters and saves the state.
**Request Body:**
```json
{
  "turboboost": false,
  "throttling": 20
}
```

## How It Works

The app controls the CPU by interacting directly with the Linux `sysfs` filesystem:
- **Throttling:** Sets the percentage in `/sys/devices/system/cpu/intel_pstate/max_perf_pct`.
- **Turbo Boost:** Toggles Turbo Boost via `/sys/devices/system/cpu/intel_pstate/no_turbo`.
- **Temperature:** Reads from `/sys/class/thermal/thermal_zone*/temp`.

To work within Umbrel, the container must be run with the necessary privileges and volume mounts to access `/sys`.

## Developer Notes
For instructions on how to build and deploy this app to Docker Hub (intended for developers, not end users), please refer to the [DEPLOY.md](DEPLOY.md) file.
