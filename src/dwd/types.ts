export type WeatherWarningCategory = 'rain' | 'thunderstorm' | 'storm';
export type SensorCategory = WeatherWarningCategory | 'hail' | 'overall';
export type WeatherWarningLevel = 'yellow' | 'orange' | 'red' | 'purple';
export type ConfiguredWarningLevel = WeatherWarningLevel | 'extreme';
export type WarningSource = 'official' | 'crowd' | 'combined' | 'none';
export type CrowdMode = 'officialOnly' | 'crowdOnly' | 'officialOrCrowd' | 'officialAndCrowd';
export type SensorType = 'occupancy' | 'motion' | 'contact' | 'switch';

export type CrowdReportType = 'hail' | 'lightning' | 'heavyRain' | 'wind';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface WeatherWarning {
  id: string;
  source: 'official';
  warnCellIds: string[];
  event: string;
  eventCode?: string;
  eventGroup?: string;
  level: WeatherWarningLevel;
  isPreWarning: boolean;
  startsAt: string;
  endsAt: string;
  headline?: string;
  description?: string;
  instruction?: string;
}

export interface CrowdReport extends GeoPoint {
  id: string;
  type: CrowdReportType;
  reportedAt: string;
  text?: string;
}

export interface CategoryState {
  category: SensorCategory;
  displayName: string;
  active: boolean;
  source: WarningSource;
  updatedAt: string;
  level?: WeatherWarningLevel;
  startsAt?: string;
  endsAt?: string;
  warningType?: string;
  text?: string;
  reportCount?: number;
}

export interface FetchWarningsResult {
  warnings: WeatherWarning[];
  provider: 'cap' | 'warnwetterFallback';
  fetchedAt: string;
}

export interface WarnCellCacheEntry extends GeoPoint {
  warnCellId: string;
  updatedAt: string;
}

export interface PersistedWarningState {
  states: CategoryState[];
  updatedAt: string;
}

export interface PluginCacheData {
  warnCell?: WarnCellCacheEntry;
  lastState?: PersistedWarningState;
}
