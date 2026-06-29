# Umbrel CPU Control

An Umbrel app to monitor and control CPU temperature, Hyperthreading, and Throttling, designed for Intel CPUs (e.g., NUC8i7BNH) using `intel_pstate`.

## Features
- **CPU Temperature Monitoring:** View the current CPU temperature in real-time.
- **Hyperthreading Control:** Toggle Hyperthreading on or off.
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
  "hyperthreading": true,
  "throttling": 100
}
```

### `POST /api/settings`
Updates the CPU parameters and saves the state.
**Request Body:**
```json
{
  "hyperthreading": false,
  "throttling": 20
}
```

## How It Works

The app controls the CPU by interacting directly with the Linux `sysfs` filesystem:
- **Throttling:** Sets the percentage in `/sys/devices/system/cpu/intel_pstate/max_perf_pct` and disables turbo boost in `/sys/devices/system/cpu/intel_pstate/no_turbo` when throttling is applied.
- **Hyperthreading:** Toggles SMT via `/sys/devices/system/cpu/smt/control`.
- **Temperature:** Reads from `/sys/class/thermal/thermal_zone*/temp`.

To work within Umbrel, the container must be run with the necessary privileges and volume mounts to access `/sys`.
