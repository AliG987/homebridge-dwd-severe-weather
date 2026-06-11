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
});
