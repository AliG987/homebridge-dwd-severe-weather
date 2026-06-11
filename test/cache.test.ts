import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { FileCache } from '../src/utils/cache';

interface TestCache {
  value?: string;
  count?: number;
}

describe('FileCache', () => {
  it('reads empty cache files as empty objects and persists updates', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dwd-cache-'));
    const filePath = join(directory, 'cache.json');
    const cache = new FileCache<TestCache>(filePath);

    await expect(cache.read()).resolves.toEqual({});
    await cache.update((current) => ({
      ...current,
      value: 'warncell',
      count: 1,
    }));

    expect(await cache.read()).toEqual({
      value: 'warncell',
      count: 1,
    });
    expect(await readFile(filePath, 'utf8')).toContain('warncell');
  });

  it('treats corrupt cache JSON as empty cache', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dwd-cache-'));
    const filePath = join(directory, 'cache.json');
    await writeFile(filePath, '{broken', 'utf8');

    await expect(new FileCache<TestCache>(filePath).read()).resolves.toEqual({});
  });
});
