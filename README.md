# homebridge-dwd-severe-weather

Homebridge dynamic platform plugin for severe weather warnings from the German Weather Service
(Deutscher Wetterdienst, DWD).

The plugin exposes DWD warnings for a configured location as HomeKit sensors:

- `Gewitter`
- `Sturm/Wind`
- `Unwetter aktiv`

Official DWD warnings are the primary signal. Optional crowd report support is prepared behind a
separate provider interface, but live WarnWetter/crowdsourcing endpoints are not enabled until a
stable public source has been verified.

This plugin is not an official product of Deutscher Wetterdienst.

## Features

- Dynamic Homebridge platform plugin written in strict TypeScript.
- Location configuration by latitude/longitude.
- Optional fixed DWD warncell/community ID.
- Automatic warncell resolution via DWD GeoJSON/WFS data.
- Local cache for resolved warncell IDs and last valid warning state.
- Official DWD warning polling with retry, timeout and fallback behavior.
- CAP/OpenData primary source with WarnWetter JSON fallback if CAP fetch/parsing fails.
- Configurable HomeKit service type:
  - OccupancySensor, default
  - MotionSensor
  - ContactSensor
  - Switch
- Per-category minimum warning level.
- Prewarnings ignored by default.
- StatusFault after repeated/stale update failures.
- Mockable crowd report architecture.

## Installation

```bash
npm install -g homebridge-dwd-severe-weather
```

Then add the platform to your Homebridge config.

## Example Configuration

```json
{
  "platform": "DwdSevereWeather",
  "name": "DWD Unwetter",
  "latitude": 52.52,
  "longitude": 13.405,
  "pollIntervalMinutes": 5,
  "sensorType": "occupancy",
  "overallSensor": {
    "enabled": true
  },
  "warnings": {
    "thunderstorm": {
      "enabled": true,
      "minimumLevel": "orange",
      "includePreWarnings": false
    },
    "storm": {
      "enabled": true,
      "minimumLevel": "yellow",
      "includePreWarnings": false
    }
  },
  "crowdReports": {
    "enabled": false,
    "radiusKm": 10,
    "maxAgeMinutes": 60,
    "minimumReports": 2,
    "mode": "officialOnly"
  },
  "debug": false
}
```

## Latitude/Longitude and Warncell ID

Latitude and longitude are required. They are used to resolve the DWD warncell/community ID and are
also the reference point for optional radius-based crowd report checks.

You can bypass automatic resolution by setting:

```json
{
  "warnCellId": "111000000"
}
```

When `warnCellId` is configured, official warnings use that ID directly. Latitude and longitude are
still required for optional crowd report radius checks.

The resolved warncell ID is cached locally for 30 days. If DWD GeoJSON resolution temporarily fails,
the cached ID is reused and HomeKit `StatusFault` can be set while the plugin retries later.

## Warning Sources

Official warnings:

- Primary source:
  `https://opendata.dwd.de/weather/alerts/cap/COMMUNEUNION_DWD_STAT/`
- Fallback source:
  `https://www.dwd.de/DWD/warnungen/warnapp/json/warnings.json`
- Warncell GeoJSON/WFS:
  `https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=dwd:Warngebiete_Gemeinden&outputFormat=application/json`

The CAP/OpenData source is treated as authoritative. WarnWetter JSON is only used if the CAP request
or parser fails. It is not used merely because there are no active CAP warnings.

The parsers are isolated in `src/dwd/parsers.ts` so changes in DWD formats can be tested with
fixtures.

## Warning Levels

Supported levels:

- `yellow`
- `orange`
- `red`
- `purple`
- `extreme`, normalized to `purple`

Each warning category has its own `minimumLevel`.

Prewarnings are ignored by default:

```json
{
  "includePreWarnings": false
}
```

Set `includePreWarnings` to `true` only if you explicitly want advance information to activate a
sensor.

## Crowd Reports

Crowd reports are intentionally conservative in this version.

The config schema supports:

```json
{
  "crowdReports": {
    "enabled": true,
    "radiusKm": 10,
    "maxAgeMinutes": 60,
    "minimumReports": 2,
    "mode": "officialOrCrowd"
  }
}
```

Modes:

- `officialOnly`, default
- `crowdOnly`
- `officialOrCrowd`
- `officialAndCrowd`

Relevant report categories:

- Thunderstorm: hail, lightning, heavy rain
- Storm/wind: wind

Important: live WarnWetter/crowdsourcing endpoint support is not hard-coded yet. The current DWD
crowd provider returns no live activations. The architecture and tests are in place so a verified
provider can be added without changing the HomeKit or warning-combination logic.

## HomeKit Representation

By default, sensors are exposed as `OccupancySensor`, because "occupied" maps reasonably well to the
presence of a weather event.

Supported sensor types:

- `occupancy`
- `motion`
- `contact`
- `switch`

Each accessory updates:

- active/inactive state for the selected sensor type
- `StatusActive`
- `StatusFault`
- `Name`

Detailed metadata such as highest level, start, end, warning type, text, source and last update time
is stored in accessory context and written to logs. The plugin does not claim Eve compatibility.

## Polling, Cache and Failure Behavior

Default polling interval is 5 minutes. Values below 5 minutes are clamped to 5 minutes.

The plugin:

- uses request timeouts
- retries temporary HTTP failures with backoff
- keeps the last valid state after transient failures
- sets `StatusFault` after repeated failures or stale data
- retries on the next polling cycle

External DWD errors should not crash Homebridge.

## Privacy

Coordinates and the resolved warncell ID are stored only in the local Homebridge cache. No secrets are
stored. The plugin uses coordinates only for DWD/warncell and optional radius-based checks.

## Troubleshooting

Enable debug logging:

```json
{
  "debug": true
}
```

Common checks:

- Confirm latitude and longitude are valid decimal coordinates.
- If warncell resolution fails, configure a fixed `warnCellId` temporarily.
- Increase the polling interval if your installation logs frequent network timeouts.
- Check whether the DWD OpenData endpoint is reachable from the Homebridge host.
- Remove the local cache file if you intentionally moved the configured location.

## Development

```bash
npm install
npm run lint
npm run test
npm run build
```

Normal tests use mock data only and perform no real network requests.

Optional live smoke test:

```bash
DWD_LIVE_TESTS=1 npm run test
```

## Known Verification Boundary

CAP/OpenData warnings and warncell GeoJSON/WFS are implemented as the official path. The fallback
WarnWetter JSON parser is defensive because that format is less stable. Crowd report live endpoints
still need verification before production activation; until then the provider is intentionally
mockable and inactive.
