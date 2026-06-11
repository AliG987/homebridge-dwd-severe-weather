import { describe, expect, it } from 'vitest';
import { haversineDistanceKm, isValidCoordinate, pointInPolygon } from '../src/utils/geo';

describe('geo utilities', () => {
  it('calculates a realistic distance between Berlin and Potsdam', () => {
    const distance = haversineDistanceKm(
      { latitude: 52.52, longitude: 13.405 },
      { latitude: 52.3906, longitude: 13.0645 },
    );

    expect(distance).toBeGreaterThan(26);
    expect(distance).toBeLessThan(28);
  });

  it('validates coordinate ranges', () => {
    expect(isValidCoordinate({ latitude: 52.52, longitude: 13.405 })).toBe(true);
    expect(isValidCoordinate({ latitude: 91, longitude: 13.405 })).toBe(false);
  });

  it('detects points inside polygons and outside holes', () => {
    const polygon: [number, number][][] = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
      [
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 4],
        [2, 2],
      ],
    ];

    expect(pointInPolygon({ latitude: 1, longitude: 1 }, polygon)).toBe(true);
    expect(pointInPolygon({ latitude: 3, longitude: 3 }, polygon)).toBe(false);
    expect(pointInPolygon({ latitude: 11, longitude: 11 }, polygon)).toBe(false);
  });
});
