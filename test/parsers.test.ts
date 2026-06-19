import { describe, expect, it } from 'vitest';
import {
  normalizeWarningLevel,
  parseCapXml,
  parseWarnWetterWarnings,
} from '../src/dwd/parsers';

describe('DWD parsers', () => {
  it('maps CAP severity values to configured warning levels', () => {
    expect(normalizeWarningLevel('Minor')).toBe('yellow');
    expect(normalizeWarningLevel('Moderate')).toBe('orange');
    expect(normalizeWarningLevel('Severe')).toBe('red');
    expect(normalizeWarningLevel('Extreme')).toBe('purple');
  });

  it('parses CAP XML into normalized warnings', () => {
    const warnings = parseCapXml(`
      <alert>
        <identifier>cap-1</identifier>
        <info>
          <event>Schweres Gewitter</event>
          <severity>Severe</severity>
          <onset>2026-06-11T11:00:00+00:00</onset>
          <expires>2026-06-11T13:00:00+00:00</expires>
          <headline>Amtliche Warnung vor schwerem Gewitter</headline>
          <description>Blitz, Hagel und Starkregen moeglich.</description>
          <eventCode>
            <valueName>II</valueName>
            <value>46</value>
          </eventCode>
          <eventCode>
            <valueName>GROUP</valueName>
            <value>THUNDERSTORM</value>
          </eventCode>
          <area>
            <areaDesc>Berlin</areaDesc>
            <geocode>
              <valueName>WARNCELLID</valueName>
              <value>111000000</value>
            </geocode>
          </area>
        </info>
      </alert>
    `);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.warnCellIds).toEqual(['111000000']);
    expect(warnings[0]?.event).toBe('Schweres Gewitter');
    expect(warnings[0]?.eventCode).toBe('46');
    expect(warnings[0]?.eventGroup).toBe('THUNDERSTORM');
    expect(warnings[0]?.level).toBe('red');
  });

  it('parses WarnWetter fallback JSON', () => {
    const warnings = parseWarnWetterWarnings({
      warnings: {
        '111000000': [
          {
            id: 'json-1',
            event: 'Sturmboeen',
            level: 2,
            start: 1781175600000,
            end: 1781182800000,
            headline: 'Warnung vor Sturmboeen',
          },
        ],
      },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.warnCellIds).toEqual(['111000000']);
    expect(warnings[0]?.eventCode).toBeUndefined();
    expect(warnings[0]?.level).toBe('orange');
  });

  it('fails clearly for broken WarnWetter payloads', () => {
    expect(() => parseWarnWetterWarnings({ broken: true })).toThrow(
      'WarnWetter payload does not contain a warnings object.',
    );
  });

  it('handles empty DWD payloads without creating fake warnings', () => {
    expect(parseCapXml('<root />')).toEqual([]);
    expect(parseWarnWetterWarnings({ warnings: {} })).toEqual([]);
  });
});
