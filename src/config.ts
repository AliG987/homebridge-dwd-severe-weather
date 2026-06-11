import {
  DEFAULT_POLL_INTERVAL_MINUTES,
  MIN_POLL_INTERVAL_MINUTES,
  PLATFORM_NAME,
} from './settings';
import type {
  ConfiguredWarningLevel,
  CrowdMode,
  SensorType,
  WeatherWarningCategory,
  WeatherWarningLevel,
} from './dwd/types';

export interface CategoryWarningConfig {
  enabled: boolean;
  minimumLevel: WeatherWarningLevel;
  includePreWarnings: boolean;
}

export interface CrowdReportsConfig {
  enabled: boolean;
  radiusKm: number;
  maxAgeMinutes: number;
  minimumReports: number;
  mode: CrowdMode;
}

export interface DwdSevereWeatherConfig {
  platform: typeof PLATFORM_NAME;
  name: string;
  latitude: number;
  longitude: number;
  warnCellId?: string;
  pollIntervalMinutes: number;
  sensorType: SensorType;
  debug: boolean;
  overallSensor: {
    enabled: boolean;
  };
  warnings: Record<WeatherWarningCategory, CategoryWarningConfig>;
  crowdReports: CrowdReportsConfig;
}

export class ConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const SENSOR_TYPES: readonly SensorType[] = ['occupancy', 'motion', 'contact', 'switch'];
const CROWD_MODES: readonly CrowdMode[] = [
  'officialOnly',
  'crowdOnly',
  'officialOrCrowd',
  'officialAndCrowd',
];
const WARNING_LEVELS: readonly ConfiguredWarningLevel[] = [
  'yellow',
  'orange',
  'red',
  'purple',
  'extreme',
];

export function validateConfig(rawConfig: unknown): DwdSevereWeatherConfig {
  const raw = requireRecord(rawConfig, 'Configuration must be an object.');

  const latitude = requireFiniteNumber(raw.latitude, 'latitude');
  const longitude = requireFiniteNumber(raw.longitude, 'longitude');

  if (latitude < -90 || latitude > 90) {
    throw new ConfigError('latitude must be between -90 and 90.');
  }

  if (longitude < -180 || longitude > 180) {
    throw new ConfigError('longitude must be between -180 and 180.');
  }

  const name = readString(raw.name, 'DWD Unwetter').trim() || 'DWD Unwetter';
  const pollIntervalMinutes = Math.max(
    MIN_POLL_INTERVAL_MINUTES,
    Math.floor(readNumber(raw.pollIntervalMinutes, DEFAULT_POLL_INTERVAL_MINUTES)),
  );

  return {
    platform: PLATFORM_NAME,
    name,
    latitude,
    longitude,
    warnCellId: readOptionalNonEmptyString(raw.warnCellId),
    pollIntervalMinutes,
    sensorType: readEnum(raw.sensorType, SENSOR_TYPES, 'occupancy'),
    debug: readBoolean(raw.debug, false),
    overallSensor: {
      enabled: readBoolean(readRecord(raw.overallSensor).enabled, true),
    },
    warnings: {
      thunderstorm: readCategoryWarningConfig(
        readRecord(readRecord(raw.warnings).thunderstorm),
        'orange',
      ),
      storm: readCategoryWarningConfig(readRecord(readRecord(raw.warnings).storm), 'yellow'),
    },
    crowdReports: readCrowdReportsConfig(readRecord(raw.crowdReports)),
  };
}

export function normalizeConfiguredLevel(level: ConfiguredWarningLevel): WeatherWarningLevel {
  return level === 'extreme' ? 'purple' : level;
}

function readCategoryWarningConfig(
  raw: Record<string, unknown>,
  defaultLevel: ConfiguredWarningLevel,
): CategoryWarningConfig {
  const configuredLevel = readEnum(raw.minimumLevel, WARNING_LEVELS, defaultLevel);

  return {
    enabled: readBoolean(raw.enabled, true),
    minimumLevel: normalizeConfiguredLevel(configuredLevel),
    includePreWarnings: readBoolean(raw.includePreWarnings, false),
  };
}

function readCrowdReportsConfig(raw: Record<string, unknown>): CrowdReportsConfig {
  return {
    enabled: readBoolean(raw.enabled, false),
    radiusKm: clamp(readNumber(raw.radiusKm, 10), 1, 100),
    maxAgeMinutes: Math.floor(clamp(readNumber(raw.maxAgeMinutes, 60), 5, 1440)),
    minimumReports: Math.floor(clamp(readNumber(raw.minimumReports, 2), 1, 20)),
    mode: readEnum(raw.mode, CROWD_MODES, 'officialOnly'),
  };
}

function requireRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ConfigError(errorMessage);
  }

  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, propertyName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(`${propertyName} must be a finite number.`);
  }

  return value;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
