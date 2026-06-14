import { describe, expect, it } from 'vitest';
import type { CategoryWarningConfig, CrowdReportsConfig } from '../src/config';
import type { CrowdReport } from '../src/dwd/types';
import {
  buildCategoryState,
  buildHailState,
  filterCrowdReportsForCategory,
} from '../src/dwd/warningMapping';

const now = new Date('2026-06-11T12:00:00.000Z');
const center = { latitude: 52.52, longitude: 13.405 };
const warningConfig: CategoryWarningConfig = {
  enabled: true,
  minimumLevel: 'yellow',
  includePreWarnings: false,
};
const crowdConfig: CrowdReportsConfig = {
  enabled: true,
  radiusKm: 10,
  maxAgeMinutes: 60,
  minimumReports: 2,
  mode: 'crowdOnly',
};

describe('crowd report filtering', () => {
  it('filters by category, radius and max age', () => {
    const reports: CrowdReport[] = [
      report('near-wind', 'wind', 52.52, 13.405, '2026-06-11T11:30:00.000Z'),
      report('old-wind', 'wind', 52.52, 13.405, '2026-06-11T10:30:00.000Z'),
      report('far-wind', 'wind', 53.5, 13.405, '2026-06-11T11:30:00.000Z'),
      report('hail', 'hail', 52.52, 13.405, '2026-06-11T11:30:00.000Z'),
    ];

    const matches = filterCrowdReportsForCategory(reports, 'storm', crowdConfig, center, now);

    expect(matches.map((match) => match.id)).toEqual(['near-wind']);
  });

  it('requires the configured minimum report count', () => {
    const oneReport = buildCategoryState(
      'storm',
      warningConfig,
      crowdConfig,
      [],
      [report('near-wind', 'wind', 52.52, 13.405, '2026-06-11T11:30:00.000Z')],
      center,
      now,
    );
    const twoReports = buildCategoryState(
      'storm',
      warningConfig,
      crowdConfig,
      [],
      [
        report('near-wind-1', 'wind', 52.52, 13.405, '2026-06-11T11:30:00.000Z'),
        report('near-wind-2', 'wind', 52.521, 13.405, '2026-06-11T11:40:00.000Z'),
      ],
      center,
      now,
    );

    expect(oneReport.active).toBe(false);
    expect(twoReports.active).toBe(true);
    expect(twoReports.source).toBe('crowd');
  });

  it('builds hail state only from matching crowd reports', () => {
    const oneHailReport = buildHailState(
      crowdConfig,
      [report('near-hail', 'hail', 52.52, 13.405, '2026-06-11T11:30:00.000Z')],
      center,
      now,
    );
    const twoHailReports = buildHailState(
      crowdConfig,
      [
        report('near-hail-1', 'hail', 52.52, 13.405, '2026-06-11T11:30:00.000Z'),
        report('near-hail-2', 'hail', 52.521, 13.405, '2026-06-11T11:40:00.000Z'),
        report('near-wind', 'wind', 52.52, 13.405, '2026-06-11T11:45:00.000Z'),
      ],
      center,
      now,
    );

    expect(oneHailReport.active).toBe(false);
    expect(twoHailReports.active).toBe(true);
    expect(twoHailReports.category).toBe('hail');
    expect(twoHailReports.reportCount).toBe(2);
  });
});

function report(
  id: string,
  type: CrowdReport['type'],
  latitude: number,
  longitude: number,
  reportedAt: string,
): CrowdReport {
  return {
    id,
    type,
    latitude,
    longitude,
    reportedAt,
  };
}
