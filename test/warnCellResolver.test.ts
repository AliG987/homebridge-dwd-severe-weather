import { describe, expect, it } from 'vitest';
import { resolveWarnCellFromGeoJson } from '../src/dwd/WarnCellResolver';

describe('warncell resolver', () => {
  it('resolves a warncell ID from mock GeoJSON', () => {
    const geoJson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            WARNCELLID: '111000000',
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [13, 52],
                [14, 52],
                [14, 53],
                [13, 53],
                [13, 52],
              ],
            ],
          },
        },
      ],
    };

    expect(resolveWarnCellFromGeoJson(geoJson, { latitude: 52.52, longitude: 13.405 })).toBe(
      '111000000',
    );
  });

  it('returns undefined when the point is outside all warncells', () => {
    const geoJson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            WARNCELLID: '111000000',
          },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [13, 52],
                [14, 52],
                [14, 53],
                [13, 53],
                [13, 52],
              ],
            ],
          },
        },
      ],
    };

    expect(resolveWarnCellFromGeoJson(geoJson, { latitude: 50, longitude: 8 })).toBeUndefined();
  });
});
