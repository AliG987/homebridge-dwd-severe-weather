import { describe, expect, it } from 'vitest';
import { DWD_CAP_DIRECTORY_URL } from '../src/settings';

describe.skipIf(process.env.DWD_LIVE_TESTS !== '1')('live DWD integration', () => {
  it('can reach the DWD CAP directory when explicitly enabled', async () => {
    const response = await fetch(DWD_CAP_DIRECTORY_URL);
    expect(response.ok).toBe(true);
  });
});
