import { describe, expect, it } from 'vitest';
import { ConfigError, normalizeConfiguredLevel, validateConfig } from '../src/config';

describe('validateConfig', () => {
  it('applies professional defaults', () => {
    const config = validateConfig({
      platform: 'DwdSevereWeather',
      latitude: 52.52,
      longitude: 13.405,
    });

    expect(config.name).toBe('DWD Unwetter');
    expect(config.pollIntervalMinutes).toBe(5);
    expect(config.sensorType).toBe('occupancy');
    expect(config.overallSensor.enabled).toBe(true);
    expect(config.groupedWeatherWarnings.enabled).toBeUndefined();
    expect(config.groupedWeatherWarnings.includeHail).toBe(true);
    expect(config.warnings.thunderstorm.minimumLevel).toBe('orange');
    expect(config.warnings.thunderstorm.includePreWarnings).toBe(false);
    expect(config.warnings.storm.minimumLevel).toBe('yellow');
    expect(config.crowdReports.enabled).toBe(false);
    expect(config.crowdReports.mode).toBe('officialOnly');
  });

  it('rejects invalid coordinates', () => {
    expect(() =>
      validateConfig({
        platform: 'DwdSevereWeather',
        latitude: 95,
        longitude: 13.405,
      }),
    ).toThrow(ConfigError);
  });

  it('enforces the minimum polling interval', () => {
    const config = validateConfig({
      platform: 'DwdSevereWeather',
      latitude: 52.52,
      longitude: 13.405,
      pollIntervalMinutes: 1,
    });

    expect(config.pollIntervalMinutes).toBe(5);
  });

  it('normalizes extreme to purple', () => {
    expect(normalizeConfiguredLevel('extreme')).toBe('purple');
  });

  it('reads grouped Matter warning sensor options', () => {
    const config = validateConfig({
      platform: 'DwdSevereWeather',
      latitude: 52.52,
      longitude: 13.405,
      groupedWeatherWarnings: {
        enabled: true,
        includeHail: false,
      },
    });

    expect(config.groupedWeatherWarnings.enabled).toBe(true);
    expect(config.groupedWeatherWarnings.includeHail).toBe(false);
  });

  it('keeps grouped Matter warning sensors in auto mode when enabled is omitted', () => {
    const config = validateConfig({
      platform: 'DwdSevereWeather',
      latitude: 52.52,
      longitude: 13.405,
      _bridge: {
        hap: {
          enabled: false,
        },
        matter: {
          enabled: true,
        },
      },
    });

    expect(config.groupedWeatherWarnings.enabled).toBeUndefined();
  });

  it('allows grouped Matter warnings to be explicitly disabled on Matter-only child bridges', () => {
    const config = validateConfig({
      platform: 'DwdSevereWeather',
      latitude: 52.52,
      longitude: 13.405,
      groupedWeatherWarnings: {
        enabled: false,
      },
      _bridge: {
        hap: {
          enabled: false,
        },
        matter: {
          enabled: true,
        },
      },
    });

    expect(config.groupedWeatherWarnings.enabled).toBe(false);
  });
});
