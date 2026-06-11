import { DWD_WARNCELL_GEOJSON_URL, WARNCELL_CACHE_TTL_MS } from '../settings';
import type { DwdSevereWeatherConfig } from '../config';
import type { FileCache } from '../utils/cache';
import { fetchWithRetry } from '../utils/retry';
import { pointInMultiPolygon, pointInPolygon } from '../utils/geo';
import type {
  GeoPoint,
  MultiPolygonCoordinates,
  PluginCacheData,
  PolygonCoordinates,
  WarnCellCacheEntry,
} from './types';

export interface WarnCellResolution {
  warnCellId: string;
  source: 'configured' | 'resolved' | 'cache';
  degraded: boolean;
}

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
};

type GeoJsonFeature = {
  type: 'Feature';
  properties?: Record<string, unknown>;
  geometry?: GeoJsonGeometry;
};

type GeoJsonGeometry =
  | {
      type: 'Polygon';
      coordinates: PolygonCoordinates;
    }
  | {
      type: 'MultiPolygon';
      coordinates: MultiPolygonCoordinates;
    };

export class WarnCellResolver {
  public constructor(private readonly cache: FileCache<PluginCacheData>) {}

  public async resolve(config: DwdSevereWeatherConfig): Promise<WarnCellResolution> {
    if (config.warnCellId) {
      return {
        warnCellId: config.warnCellId,
        source: 'configured',
        degraded: false,
      };
    }

    const center = {
      latitude: config.latitude,
      longitude: config.longitude,
    };
    const cached = await this.readCachedWarnCell(center);

    if (cached && isFreshCacheEntry(cached)) {
      return {
        warnCellId: cached.warnCellId,
        source: 'cache',
        degraded: false,
      };
    }

    try {
      const response = await fetchWithRetry(DWD_WARNCELL_GEOJSON_URL, {
        headers: {
          Accept: 'application/json',
        },
      });
      const geoJson = (await response.json()) as unknown;
      const warnCellId = resolveWarnCellFromGeoJson(geoJson, center);

      if (!warnCellId) {
        throw new Error('No DWD warncell contains the configured coordinates.');
      }

      await this.cache.update((current) => ({
        ...current,
        warnCell: {
          warnCellId,
          latitude: center.latitude,
          longitude: center.longitude,
          updatedAt: new Date().toISOString(),
        },
      }));

      return {
        warnCellId,
        source: 'resolved',
        degraded: false,
      };
    } catch (error) {
      if (cached) {
        return {
          warnCellId: cached.warnCellId,
          source: 'cache',
          degraded: true,
        };
      }

      throw error;
    }
  }

  private async readCachedWarnCell(center: GeoPoint): Promise<WarnCellCacheEntry | undefined> {
    const cached = (await this.cache.read()).warnCell;

    if (!cached || cached.latitude !== center.latitude || cached.longitude !== center.longitude) {
      return undefined;
    }

    return cached;
  }
}

export function resolveWarnCellFromGeoJson(geoJson: unknown, point: GeoPoint): string | undefined {
  if (!isFeatureCollection(geoJson)) {
    throw new Error('DWD warncell response is not a GeoJSON FeatureCollection.');
  }

  for (const feature of geoJson.features) {
    if (!feature.geometry || !feature.properties) {
      continue;
    }

    if (!geometryContainsPoint(feature.geometry, point)) {
      continue;
    }

    return readWarnCellId(feature.properties);
  }

  return undefined;
}

function isFreshCacheEntry(entry: WarnCellCacheEntry): boolean {
  const updatedAt = Date.parse(entry.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt <= WARNCELL_CACHE_TTL_MS;
}

function geometryContainsPoint(geometry: GeoJsonGeometry, point: GeoPoint): boolean {
  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates);
  }

  return pointInMultiPolygon(point, geometry.coordinates);
}

function readWarnCellId(properties: Record<string, unknown>): string | undefined {
  const candidateKeys = [
    'WARNCELLID',
    'WARNCELL_ID',
    'warncellid',
    'warncell_id',
    'CELL_ID',
    'cell_id',
    'AGS',
    'ags',
    'ARS',
    'ars',
  ];

  for (const key of candidateKeys) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function isFeatureCollection(value: unknown): value is GeoJsonFeatureCollection {
  if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    return false;
  }

  return value.features.every(isFeature);
}

function isFeature(value: unknown): value is GeoJsonFeature {
  if (!isRecord(value) || value.type !== 'Feature') {
    return false;
  }

  if (value.geometry !== undefined && !isGeometry(value.geometry)) {
    return false;
  }

  return value.properties === undefined || isRecord(value.properties);
}

function isGeometry(value: unknown): value is GeoJsonGeometry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value.type === 'Polygon' && isPolygonCoordinates(value.coordinates)) ||
    (value.type === 'MultiPolygon' && isMultiPolygonCoordinates(value.coordinates))
  );
}

function isPolygonCoordinates(value: unknown): value is PolygonCoordinates {
  return (
    Array.isArray(value) &&
    value.every(
      (ring) =>
        Array.isArray(ring) &&
        ring.every(
          (position) =>
            Array.isArray(position) &&
            position.length >= 2 &&
            typeof position[0] === 'number' &&
            typeof position[1] === 'number',
        ),
    )
  );
}

function isMultiPolygonCoordinates(value: unknown): value is MultiPolygonCoordinates {
  return Array.isArray(value) && value.every(isPolygonCoordinates);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
