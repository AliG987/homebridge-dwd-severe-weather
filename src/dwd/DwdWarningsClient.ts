import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DWD_CAP_DEFAULT_ZIP_URL,
  DWD_CAP_DIRECTORY_URL,
  DWD_WARNWETTER_WARNINGS_URL,
} from '../settings';
import { fetchWithRetry } from '../utils/retry';
import type { FetchWarningsResult, WeatherWarning } from './types';
import { parseCapZip, parseWarnWetterWarnings } from './parsers';

export interface DwdWarningsClientOptions {
  requestTimeoutMs?: number;
}

export class DwdWarningsClient {
  private readonly requestTimeoutMs: number;

  public constructor(options: DwdWarningsClientOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  public async getWarningsForWarnCell(warnCellId: string): Promise<FetchWarningsResult> {
    try {
      const capWarnings = await this.fetchCapWarnings();
      return {
        warnings: filterWarningsForWarnCell(capWarnings, warnCellId),
        provider: 'cap',
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      const fallbackWarnings = await this.fetchWarnWetterWarnings();
      return {
        warnings: filterWarningsForWarnCell(fallbackWarnings, warnCellId),
        provider: 'warnwetterFallback',
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  private async fetchCapWarnings(): Promise<WeatherWarning[]> {
    const zipUrl = await this.findLatestCapZipUrl();
    const response = await fetchWithRetry(zipUrl, {
      timeoutMs: this.requestTimeoutMs,
      headers: {
        Accept: 'application/zip, application/octet-stream',
      },
    });

    return parseCapZip(await response.arrayBuffer());
  }

  private async findLatestCapZipUrl(): Promise<string> {
    const response = await fetchWithRetry(DWD_CAP_DIRECTORY_URL, {
      timeoutMs: this.requestTimeoutMs,
      headers: {
        Accept: 'text/html, text/plain',
      },
    });
    const html = await response.text();
    const zipLinks = [...html.matchAll(/href=["']([^"']+\.zip)["']/gi)]
      .map((match) => match[1])
      .filter((href): href is string => href !== undefined)
      .sort();

    const latestLink = zipLinks.at(-1);
    return latestLink ? new URL(latestLink, DWD_CAP_DIRECTORY_URL).toString() : DWD_CAP_DEFAULT_ZIP_URL;
  }

  private async fetchWarnWetterWarnings(): Promise<WeatherWarning[]> {
    const response = await fetchWithRetry(DWD_WARNWETTER_WARNINGS_URL, {
      timeoutMs: this.requestTimeoutMs,
      headers: {
        Accept: 'application/json',
      },
    });

    return parseWarnWetterWarnings((await response.json()) as unknown);
  }
}

function filterWarningsForWarnCell(
  warnings: readonly WeatherWarning[],
  warnCellId: string,
): WeatherWarning[] {
  return warnings.filter((warning) => warning.warnCellIds.includes(warnCellId));
}
