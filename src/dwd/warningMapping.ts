import type {
  CategoryState,
  CrowdReport,
  CrowdReportType,
  GeoPoint,
  SensorCategory,
  WeatherWarning,
  WeatherWarningCategory,
  WeatherWarningLevel,
} from './types';
import type { CategoryWarningConfig, CrowdReportsConfig } from '../config';
import { haversineDistanceKm } from '../utils/geo';

const LEVEL_ORDER: Record<WeatherWarningLevel, number> = {
  yellow: 1,
  orange: 2,
  red: 3,
  purple: 4,
};

const DISPLAY_NAMES: Record<SensorCategory, string> = {
  rain: 'Regen/Starkregen',
  thunderstorm: 'Gewitter',
  storm: 'Sturm/Wind',
  hail: 'Hagel',
  overall: 'Unwetter aktiv',
};

const CROWD_TYPES_BY_CATEGORY: Record<WeatherWarningCategory, readonly CrowdReportType[]> = {
  rain: ['heavyRain'],
  thunderstorm: ['hail', 'lightning'],
  storm: ['wind'],
};

const EVENT_CODE_PREFIXES: Record<WeatherWarningCategory, readonly string[]> = {
  // Current DWD CAP II codes, plus prefix matching for legacy four-digit event codes.
  rain: [],
  thunderstorm: ['31', '38', '46'],
  storm: ['11', '57', '58'],
};

const EVENT_GROUPS: Record<WeatherWarningCategory, readonly string[]> = {
  rain: ['rain'],
  thunderstorm: ['thunderstorm', 'hail'],
  storm: ['wind'],
};

export function getDisplayName(category: SensorCategory): string {
  return DISPLAY_NAMES[category];
}

export function levelMeetsMinimum(
  level: WeatherWarningLevel,
  minimumLevel: WeatherWarningLevel,
): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minimumLevel];
}

export function compareWarningLevels(
  left: WeatherWarningLevel | undefined,
  right: WeatherWarningLevel | undefined,
): number {
  return (left ? LEVEL_ORDER[left] : 0) - (right ? LEVEL_ORDER[right] : 0);
}

export function isWarningRelevantToCategory(
  warning: WeatherWarning,
  category: WeatherWarningCategory,
): boolean {
  const normalizedGroup = normalizeText(warning.eventGroup ?? '');

  if (normalizedGroup) {
    return EVENT_GROUPS[category].includes(normalizedGroup);
  }

  if (matchesEventCodePrefix(warning.eventCode, EVENT_CODE_PREFIXES[category])) {
    return true;
  }

  const primaryText = normalizeText([warning.event, warning.headline].filter(Boolean).join(' '));
  const primaryCategory = categoryFromText(primaryText);

  if (primaryCategory) {
    return primaryCategory === category;
  }

  return categoryFromText(normalizeText(warning.description ?? '')) === category;
}

export function filterOfficialWarningsForCategory(
  warnings: readonly WeatherWarning[],
  category: WeatherWarningCategory,
  config: CategoryWarningConfig,
  now = new Date(),
): WeatherWarning[] {
  const nowMs = now.getTime();

  return warnings
    .filter((warning) => {
      if (!config.includePreWarnings && warning.isPreWarning) {
        return false;
      }

      if (!levelMeetsMinimum(warning.level, config.minimumLevel)) {
        return false;
      }

      if (!isWarningCurrentlyActive(warning, nowMs, config.includePreWarnings)) {
        return false;
      }

      return isWarningRelevantToCategory(warning, category);
    })
    .sort(sortWarningsBySeverityAndStart);
}

export function filterCrowdReportsForCategory(
  reports: readonly CrowdReport[],
  category: WeatherWarningCategory,
  config: CrowdReportsConfig,
  center: GeoPoint,
  now = new Date(),
): CrowdReport[] {
  return filterCrowdReportsForTypes(
    reports,
    CROWD_TYPES_BY_CATEGORY[category],
    config,
    center,
    now,
  );
}

export function filterCrowdReportsForTypes(
  reports: readonly CrowdReport[],
  allowedTypes: readonly CrowdReportType[],
  config: CrowdReportsConfig,
  center: GeoPoint,
  now = new Date(),
): CrowdReport[] {
  if (!config.enabled) {
    return [];
  }

  const maxAgeMs = config.maxAgeMinutes * 60 * 1000;
  const nowMs = now.getTime();

  return reports.filter((report) => {
    if (!allowedTypes.includes(report.type)) {
      return false;
    }

    const reportTime = Date.parse(report.reportedAt);
    if (!Number.isFinite(reportTime) || nowMs - reportTime > maxAgeMs || reportTime > nowMs + 60_000) {
      return false;
    }

    return haversineDistanceKm(center, report) <= config.radiusKm;
  });
}

export function buildHailState(
  crowdConfig: CrowdReportsConfig,
  crowdReports: readonly CrowdReport[],
  center: GeoPoint,
  now = new Date(),
): CategoryState {
  const updatedAt = now.toISOString();
  const crowdEnabledForMode = crowdConfig.enabled && crowdConfig.mode !== 'officialOnly';
  const crowdMatches = filterCrowdReportsForTypes(crowdReports, ['hail'], crowdConfig, center, now);

  return crowdEnabledForMode && crowdMatches.length >= crowdConfig.minimumReports
    ? crowdState('hail', crowdMatches, updatedAt)
    : inactiveState('hail', updatedAt);
}

export function buildCategoryState(
  category: WeatherWarningCategory,
  warningConfig: CategoryWarningConfig,
  crowdConfig: CrowdReportsConfig,
  officialWarnings: readonly WeatherWarning[],
  crowdReports: readonly CrowdReport[],
  center: GeoPoint,
  now = new Date(),
): CategoryState {
  const updatedAt = now.toISOString();
  const officialMatches = filterOfficialWarningsForCategory(
    officialWarnings,
    category,
    warningConfig,
    now,
  );
  const crowdMatches = filterCrowdReportsForCategory(crowdReports, category, crowdConfig, center, now);
  const officialActive = officialMatches.length > 0;
  const crowdActive = crowdMatches.length >= crowdConfig.minimumReports;
  const crowdEnabledForMode = crowdConfig.enabled && crowdConfig.mode !== 'officialOnly';
  const strongestOfficial = officialMatches[0];

  if (crowdConfig.mode === 'crowdOnly') {
    return crowdActive && crowdEnabledForMode
      ? crowdState(category, crowdMatches, updatedAt)
      : inactiveState(category, updatedAt);
  }

  if (crowdConfig.mode === 'officialAndCrowd') {
    if (officialActive && crowdActive && crowdEnabledForMode && strongestOfficial) {
      return officialState(category, strongestOfficial, updatedAt, 'combined', crowdMatches.length);
    }

    return inactiveState(category, updatedAt);
  }

  if (officialActive && strongestOfficial) {
    return officialState(category, strongestOfficial, updatedAt, 'official', crowdMatches.length);
  }

  if (crowdConfig.mode === 'officialOrCrowd' && crowdActive && crowdEnabledForMode) {
    return crowdState(category, crowdMatches, updatedAt);
  }

  return inactiveState(category, updatedAt);
}

export function buildOverallState(states: readonly CategoryState[], now = new Date()): CategoryState {
  const activeStates = states.filter((state) => state.active);
  const updatedAt = now.toISOString();

  if (activeStates.length === 0) {
    return inactiveState('overall', updatedAt);
  }

  const strongest = activeStates
    .slice()
    .sort((left, right) => compareWarningLevels(right.level, left.level))[0];

  const sources = new Set(activeStates.map((state) => state.source).filter((source) => source !== 'none'));
  const source = sources.size > 1 ? 'combined' : strongest?.source ?? 'combined';

  return {
    category: 'overall',
    displayName: getDisplayName('overall'),
    active: true,
    source,
    updatedAt,
    level: strongest?.level,
    startsAt: strongest?.startsAt,
    endsAt: strongest?.endsAt,
    warningType: strongest?.warningType,
    text: strongest?.text,
    reportCount: activeStates.reduce((sum, state) => sum + (state.reportCount ?? 0), 0),
  };
}

function officialState(
  category: WeatherWarningCategory,
  warning: WeatherWarning,
  updatedAt: string,
  source: 'official' | 'combined',
  reportCount?: number,
): CategoryState {
  return {
    category,
    displayName: getDisplayName(category),
    active: true,
    source,
    updatedAt,
    level: warning.level,
    startsAt: warning.startsAt,
    endsAt: warning.endsAt,
    warningType: warning.event,
    text: warning.headline ?? warning.description,
    reportCount,
  };
}

function crowdState(
  category: SensorCategory,
  reports: readonly CrowdReport[],
  updatedAt: string,
): CategoryState {
  return {
    category,
    displayName: getDisplayName(category),
    active: true,
    source: 'crowd',
    updatedAt,
    warningType: 'Crowd reports',
    text: `${reports.length} recent matching crowd reports`,
    reportCount: reports.length,
  };
}

function inactiveState(category: SensorCategory, updatedAt: string): CategoryState {
  return {
    category,
    displayName: getDisplayName(category),
    active: false,
    source: 'none',
    updatedAt,
  };
}

function isWarningCurrentlyActive(
  warning: WeatherWarning,
  nowMs: number,
  includePreWarnings: boolean,
): boolean {
  const startsAtMs = Date.parse(warning.startsAt);
  const endsAtMs = Date.parse(warning.endsAt);

  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs)) {
    return false;
  }

  if (warning.isPreWarning && includePreWarnings) {
    return endsAtMs >= nowMs;
  }

  return startsAtMs <= nowMs && endsAtMs >= nowMs;
}

function sortWarningsBySeverityAndStart(left: WeatherWarning, right: WeatherWarning): number {
  const levelDifference = compareWarningLevels(right.level, left.level);
  if (levelDifference !== 0) {
    return levelDifference;
  }

  return Date.parse(left.startsAt) - Date.parse(right.startsAt);
}

function matchesEventCodePrefix(
  eventCode: string | undefined,
  prefixes: readonly string[],
): boolean {
  if (!eventCode) {
    return false;
  }

  return prefixes.some((prefix) => eventCode.startsWith(prefix));
}

function categoryFromText(value: string): WeatherWarningCategory | undefined {
  if (
    value.includes('gewitter') ||
    value.includes('blitz') ||
    value.includes('hagel')
  ) {
    return 'thunderstorm';
  }

  if (
    value.includes('starkregen') ||
    value.includes('dauerregen') ||
    value.includes('regen')
  ) {
    return 'rain';
  }

  if (
    value.includes('wind') ||
    value.includes('sturm') ||
    value.includes('sturmboe') ||
    value.includes('orkan') ||
    value.includes('boe')
  ) {
    return 'storm';
  }

  return undefined;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
