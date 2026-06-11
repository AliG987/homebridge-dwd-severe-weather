import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class FileCache<T extends object> {
  public constructor(private readonly filePath: string) {}

  public async read(): Promise<Partial<T>> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content) as unknown;
      return isRecord(parsed) ? (parsed as Partial<T>) : {};
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return {};
      }

      if (error instanceof SyntaxError) {
        return {};
      }

      throw error;
    }
  }

  public async write(data: Partial<T>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }

  public async update(updater: (current: Partial<T>) => Partial<T>): Promise<Partial<T>> {
    const current = await this.read();
    const updated = updater(current);
    await this.write(updated);
    return updated;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
