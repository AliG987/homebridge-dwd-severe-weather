import { describe, expect, it } from 'vitest';
import type { CategoryWarningConfig, CrowdReportsConfig } from '../src/config';
import type { CrowdReport, WeatherWarning } from '../src/dwd/types';
import {
  buildCategoryState,
  buildOverallState,
  filterOfficialWarningsForCategory,
  isWarningRelevantToCategory,
  levelMeetsMinimum,
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
  mode: 'officialOnly',
};

describe('warning mapping', () => {
  it('orders warning levels by severity', () => {
    expect(levelMeetsMinimum('red', 'orange')).toBe(true);
    expect(levelMeetsMinimum('yellow', 'orange')).toBe(false);
  });

  it('detects separate rain, thunderstorm and wind warnings', () => {
    expect(isWarningRelevantToCategory(warning({ event: 'Starkregen' }), 'rain')).toBe(true);
    expect(isWarningRelevantToCategory(warning({ event: 'Schweres Gewitter' }), 'thunderstorm')).toBe(
      true,
    );
    expect(isWarningRelevantToCategory(warning({ event: 'Sturmboeen' }), 'storm')).toBe(true);
  });

  it('maps each official DWD group to exactly one warning category', () => {
    const cases = [
      { eventGroup: 'RAIN', expected: 'rain' },
      { eventGroup: 'THUNDERSTORM', expected: 'thunderstorm' },
      { eventGroup: 'WIND', expected: 'storm' },
    ] as const;
    const categories = ['rain', 'thunderstorm', 'storm'] as const;

    for (const { eventGroup, expected } of cases) {
      const groupedWarning = warning({ eventGroup });

      for (const category of categories) {
        expect(isWarningRelevantToCategory(groupedWarning, category)).toBe(category === expected);
      }
    }
  });

  it('does not treat storm gusts inside a thunderstorm description as a separate storm warning', () => {
    const thunderstorm = warning({
      event: 'Starkes Gewitter',
      eventCode: '38',
      eventGroup: 'THUNDERSTORM',
      description: 'Dabei gibt es schwere Sturmböen, Starkregen und Hagel.',
    });

    expect(isWarningRelevantToCategory(thunderstorm, 'thunderstorm')).toBe(true);
    expect(isWarningRelevantToCategory(thunderstorm, 'rain')).toBe(false);
    expect(isWarningRelevantToCategory(thunderstorm, 'storm')).toBe(false);
  });

  it('uses the DWD WIND group for storm warnings', () => {
    const storm = warning({
      event: 'Sturm',
      eventCode: '58',
      eventGroup: 'WIND',
    });

    expect(isWarningRelevantToCategory(storm, 'thunderstorm')).toBe(false);
    expect(isWarningRelevantToCategory(storm, 'storm')).toBe(true);
  });

  it('ignores prewarnings unless explicitly enabled', () => {
    const warnings = [
      warning({
        event: 'Vorabinformation schweres Gewitter',
        isPreWarning: true,
      }),
    ];

    expect(filterOfficialWarningsForCategory(warnings, 'thunderstorm', warningConfig, now)).toHaveLength(
      0,
    );
    expect(
      filterOfficialWarningsForCategory(
        warnings,
        'thunderstorm',
        {
          ...warningConfig,
          includePreWarnings: true,
        },
        now,
      ),
    ).toHaveLength(1);
  });

  it('keeps official warnings as priority in officialOrCrowd mode', () => {
    const state = buildCategoryState(
      'storm',
      warningConfig,
      {
        ...crowdConfig,
        mode: 'officialOrCrowd',
      },
      [warning({ event: 'Amtliche Warnung vor Sturmboeen', level: 'orange' })],
      crowdReports(2, 'wind'),
      center,
      now,
    );

    expect(state.active).toBe(true);
    expect(state.source).toBe('official');
    expect(state.level).toBe('orange');
  });

  it('requires official and crowd matches in officialAndCrowd mode', () => {
    const withoutCrowd = buildCategoryState(
      'storm',
      warningConfig,
      {
        ...crowdConfig,
        mode: 'officialAndCrowd',
      },
      [warning({ event: 'Amtliche Warnung vor Sturmboeen' })],
      [],
      center,
      now,
    );
    const withCrowd = buildCategoryState(
      'storm',
      warningConfig,
      {
        ...crowdConfig,
        mode: 'officialAndCrowd',
      },
      [warning({ event: 'Amtliche Warnung vor Sturmboeen' })],
      crowdReports(2, 'wind'),
      center,
      now,
    );

    expect(withoutCrowd.active).toBe(false);
    expect(withCrowd.active).toBe(true);
    expect(withCrowd.source).toBe('combined');
  });

  it('builds an active overall state from active category states', () => {
    const storm = buildCategoryState(
      'storm',
      warningConfig,
      crowdConfig,
      [warning({ event: 'Amtliche Warnung vor Sturmboeen', level: 'red' })],
      [],
      center,
      now,
    );
    const overall = buildOverallState([storm], now);

    expect(overall.active).toBe(true);
    expect(overall.level).toBe('red');
  });
});

function warning(overrides: Partial<WeatherWarning> = {}): WeatherWarning {
  return {
    id: 'warning-1',
    source: 'official',
    warnCellIds: ['123'],
    event: 'Gewitter',
    level: 'yellow',
    isPreWarning: false,
    startsAt: '2026-06-11T11:00:00.000Z',
    endsAt: '2026-06-11T13:00:00.000Z',
    ...overrides,
  };
}

function crowdReports(count: number, type: CrowdReport['type']): CrowdReport[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `report-${index}`,
    type,
    latitude: 52.52,
    longitude: 13.405,
    reportedAt: '2026-06-11T11:45:00.000Z',
  }));
}
