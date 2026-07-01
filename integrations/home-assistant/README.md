# Home Assistant Integration

Because the Umbrel CPU Control app exposes standard HTTP REST endpoints, integrating it into Home Assistant is simple. You can view the live temperatures, CPU load, and interact with the Turbo Boost and Max Performance settings natively inside Home Assistant.

The app's UI is protected by Umbrel's app proxy. The `/api/*` endpoints are intentionally whitelisted for local automation, but they only respond after API access has been enabled in the app UI. Token-based API authorization is planned for a future release.

There are two ways to add this to your Home Assistant instance:

## Option 1: Copy and Paste (Easiest)
Copy the YAML configuration below and paste it directly into your `configuration.yaml` file.

**For Umbrel Home Assistant Users:**
Because Umbrel runs the "Container" edition of Home Assistant, you don't have access to the Supervisor Add-on Store for the File Editor. Instead:
1. Install the native **"File Browser"** app directly from the Umbrel App Store.
2. Open File Browser and navigate to `app-data/home-assistant/data/`.
3. Open `configuration.yaml` and paste the code block below.
4. **Networking Note:** Docker containers on Umbrel often fail to resolve `.local` domains. You **must** replace `umbrel.local` in the YAML below with either your Umbrel's static local IP (e.g., `192.168.1.50`) or the internal Docker gateway IP (typically `10.21.21.1`).

**For Standard Home Assistant Users:**
You can paste this using the File Editor or Studio Code Server add-ons. Before saving, ensure `umbrel.local` resolves correctly, or replace it with your Umbrel's IP address.

```yaml
# Home Assistant Configuration for Umbrel CPU Control
# Be sure to replace umbrel.local with your Umbrel's IP address if umbrel.local doesn't resolve for your Home Assistant instance.

rest:
  - resource: "http://umbrel.local:3000/api/status"
    scan_interval: 10
    sensor:
      - name: "Umbrel CPU Temperature"
        unique_id: "umbrel_cpu_temperature"
        value_template: "{{ value_json.temperature }}"
        device_class: temperature
        unit_of_measurement: "°C"
      - name: "Umbrel CPU Load"
        unique_id: "umbrel_cpu_load"
        value_template: "{{ value_json.load }}"
        unit_of_measurement: "%"
      - name: "Umbrel Max Performance"
        unique_id: "umbrel_cpu_throttling_limit"
        value_template: "{{ value_json.throttling }}"
        unit_of_measurement: "%"
    binary_sensor:
      - name: "Umbrel Turbo Boost State"
        unique_id: "umbrel_turbo_boost_state"
        value_template: "{{ value_json.turboboost }}"

rest_command:
  set_umbrel_turbo:
    url: "http://umbrel.local:3000/api/settings"
    method: POST
    headers:
      content_type: 'application/json'
    payload: '{"turboboost": {{ state }}}'
    
  set_umbrel_throttling:
    url: "http://umbrel.local:3000/api/settings"
    method: POST
    headers:
      content_type: 'application/json'
    payload: '{"throttling": {{ level }}}'

switch:
  - platform: template
    switches:
      umbrel_turbo_boost:
        friendly_name: "Umbrel Turbo Boost"
        unique_id: "umbrel_turbo_boost_switch"
        value_template: "{{ is_state('binary_sensor.umbrel_turbo_boost_state', 'on') }}"
        turn_on:
          service: rest_command.set_umbrel_turbo
          data:
            state: true
        turn_off:
          service: rest_command.set_umbrel_turbo
          data:
            state: false

input_number:
  umbrel_cpu_throttling:
    name: "Set Umbrel Max Performance"
    min: 10
    max: 100
    step: 1
    unit_of_measurement: "%"
    icon: mdi:speedometer

automation:
  - id: 'umbrel_cpu_throttling_sync'
    alias: "Umbrel - Sync Max Performance Input"
    description: "Sends the API command when the Max Performance slider is changed."
    trigger:
      - platform: state
        entity_id: input_number.umbrel_cpu_throttling
    action:
      - service: rest_command.set_umbrel_throttling
        data:
          level: "{{ trigger.to_state.state | int }}"

  - id: 'umbrel_cpu_throttling_update'
    alias: "Umbrel - Update Max Performance Slider from API"
    description: "Updates the slider if Max Performance was changed directly on the Umbrel dashboard."
    trigger:
      - platform: state
        entity_id: sensor.umbrel_cpu_throttling_limit
    condition:
      - condition: template
        value_template: "{{ states('input_number.umbrel_cpu_throttling') | int != trigger.to_state.state | int }}"
    action:
      - service: input_number.set_value
        data:
          entity_id: input_number.umbrel_cpu_throttling
          value: "{{ trigger.to_state.state | int }}"
```

After pasting, save the file and restart Home Assistant.

## Option 2: Using Packages
If your Home Assistant is configured to use [Packages](https://www.home-assistant.io/docs/configuration/packages/), you do not need to paste the code block above. Instead, you can simply download the pre-configured package file:

🔗 **[Download `cpu_control.yaml`](cpu_control.yaml)**

Just drop the downloaded `cpu_control.yaml` file into your `packages/` directory, update `umbrel.local` to your Umbrel IP if necessary, and restart Home Assistant.

---

## Adding to Your Dashboard
Once Home Assistant has restarted, you will have several new entities available:

**Sensors:**
- `sensor.umbrel_cpu_temperature` (°C)
- `sensor.umbrel_cpu_load` (%)
- `sensor.umbrel_cpu_throttling_limit` (Max Performance, %)

**Controls:**
- `switch.umbrel_turbo_boost` (Toggle Turbo Boost ON/OFF)
- `input_number.umbrel_cpu_throttling` (Slider to set Max Performance)

You can add these entities directly to an **Entities Card** in your Lovelace dashboard to monitor and control your Umbrel node!
