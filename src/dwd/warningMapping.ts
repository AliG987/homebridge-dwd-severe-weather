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
  thunderstorm: 'Gewitter',
  storm: 'Sturm/Wind',
  overall: 'Unwetter aktiv',
};

const CROWD_TYPES_BY_CATEGORY: Record<WeatherWarningCategory, readonly CrowdReportType[]> = {
  thunderstorm: ['hail', 'lightning', 'heavyRain'],
  storm: ['wind'],
};

const EVENT_CODE_PREFIXES: Record<WeatherWarningCategory, readonly string[]> = {
  // DWD event-code families vary by product. These prefixes are kept as a best-effort supplement
  // to keyword matching and are intentionally isolated here for fixture-based parser tests.
  thunderstorm: ['31', '33', '34', '35', '36', '38', '39'],
  storm: ['24', '25', '26', '27', '28'],
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
  const normalizedText = normalizeText(
    [warning.event, warning.eventCode, warning.headline, warning.description].filter(Boolean).join(' '),
  );

  if (matchesEventCodePrefix(warning.eventCode, EVENT_CODE_PREFIXES[category])) {
    return true;
  }

  if (category === 'thunderstorm') {
    return (
      normalizedText.includes('gewitter') ||
      normalizedText.includes('blitz') ||
      normalizedText.includes('hagel') ||
      normalizedText.includes('starkregen')
    );
  }

  return (
    normalizedText.includes('wind') ||
    normalizedText.includes('sturm') ||
    normalizedText.includes('sturmboe') ||
    normalizedText.includes('orkan')
  );
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
  if (!config.enabled) {
    return [];
  }

  const allowedTypes = CROWD_TYPES_BY_CATEGORY[category];
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
  category: WeatherWarningCategory,
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

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
