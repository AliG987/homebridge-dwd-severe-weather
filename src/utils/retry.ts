import { DEFAULT_REQUEST_TIMEOUT_MS, DEFAULT_RETRIES } from '../settings';

export interface FetchWithRetryOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
}

export class HttpError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, retries = DEFAULT_RETRIES, retryBaseDelayMs = 500, ...requestInit } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, requestInit, timeoutMs);
      if (response.ok) {
        return response;
      }

      throw new HttpError(`DWD request failed with HTTP ${response.status}.`, response.status, url);
    } catch (error) {
      lastError = error;

      if (attempt >= retries) {
        break;
      }

      await delay(backoffDelayMs(retryBaseDelayMs, attempt));
    }
  }

  throw toError(lastError, `DWD request failed for ${url}.`);
}

async function fetchWithTimeout(
  url: string,
  requestInit: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...requestInit,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function backoffDelayMs(baseDelayMs: number, attempt: number): number {
  const jitterMs = Math.floor(Math.random() * 100);
  return baseDelayMs * 2 ** attempt + jitterMs;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}
