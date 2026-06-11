import { zipSync, strToU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DwdWarningsClient } from '../src/dwd/DwdWarningsClient';

describe('DwdWarningsClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses CAP warnings when the primary source succeeds', async () => {
    const zip = zipSync({
      'warning.xml': strToU8(`
        <alert>
          <identifier>cap-1</identifier>
          <info>
            <event>Schweres Gewitter</event>
            <severity>Severe</severity>
            <onset>2026-06-11T11:00:00+00:00</onset>
            <expires>2026-06-11T13:00:00+00:00</expires>
            <area>
              <geocode>
                <valueName>WARNCELLID</valueName>
                <value>111000000</value>
              </geocode>
            </area>
          </info>
        </alert>
      `),
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/COMMUNEUNION_DWD_STAT/')) {
        return new Response('<a href="latest.zip">latest.zip</a>');
      }

      return new Response(zip);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new DwdWarningsClient({ requestTimeoutMs: 100 }).getWarningsForWarnCell(
      '111000000',
    );

    expect(result.provider).toBe('cap');
    expect(result.warnings).toHaveLength(1);
  });

  it('uses WarnWetter JSON only as fallback after primary parse failure', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/COMMUNEUNION_DWD_STAT/')) {
        return new Response('<a href="broken.zip">broken.zip</a>');
      }

      if (url.endsWith('broken.zip')) {
        return new Response('not-a-zip');
      }

      return new Response(
        JSON.stringify({
          warnings: {
            '111000000': [
              {
                id: 'fallback-1',
                event: 'Sturmboeen',
                level: 2,
                start: '2026-06-11T11:00:00.000Z',
                end: '2026-06-11T13:00:00.000Z',
              },
            ],
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new DwdWarningsClient({ requestTimeoutMs: 100 }).getWarningsForWarnCell(
      '111000000',
    );

    expect(result.provider).toBe('warnwetterFallback');
    expect(result.warnings).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
