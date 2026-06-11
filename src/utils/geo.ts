import type { GeoPoint } from '../dwd/types';

export type LinearRing = [number, number][];
export type PolygonCoordinates = LinearRing[];
export type MultiPolygonCoordinates = PolygonCoordinates[];

const EARTH_RADIUS_KM = 6371.0088;

export function isValidCoordinate(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

export function haversineDistanceKm(from: GeoPoint, to: GeoPoint): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function pointInPolygon(point: GeoPoint, polygon: PolygonCoordinates): boolean {
  if (polygon.length === 0) {
    return false;
  }

  const [outerRing, ...holes] = polygon;
  if (!outerRing || !pointInRing(point, outerRing)) {
    return false;
  }

  return !holes.some((hole) => pointInRing(point, hole));
}

export function pointInMultiPolygon(point: GeoPoint, multiPolygon: MultiPolygonCoordinates): boolean {
  return multiPolygon.some((polygon) => pointInPolygon(point, polygon));
}

function pointInRing(point: GeoPoint, ring: LinearRing): boolean {
  if (ring.length < 3) {
    return false;
  }

  let inside = false;
  const x = point.longitude;
  const y = point.latitude;

  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex++) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];

    if (!current || !previous) {
      continue;
    }

    const xi = current[0];
    const yi = current[1];
    const xj = previous[0];
    const yj = previous[1];

    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}
