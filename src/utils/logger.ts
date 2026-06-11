import type { Logger } from 'homebridge';

export class PluginLogger {
  private readonly lastLogAt = new Map<string, number>();

  public constructor(
    private readonly log: Logger,
    private readonly debugEnabled: boolean,
  ) {}

  public info(message: string): void {
    this.log.info(message);
  }

  public warn(message: string): void {
    this.log.warn(message);
  }

  public error(message: string): void {
    this.log.error(message);
  }

  public debug(message: string): void {
    if (this.debugEnabled) {
      this.log.debug(message);
    }
  }

  public warnRateLimited(key: string, message: string, intervalMs = 10 * 60 * 1000): void {
    if (this.shouldLog(key, intervalMs)) {
      this.warn(message);
    }
  }

  public errorRateLimited(key: string, message: string, intervalMs = 10 * 60 * 1000): void {
    if (this.shouldLog(key, intervalMs)) {
      this.error(message);
    }
  }

  private shouldLog(key: string, intervalMs: number): boolean {
    const now = Date.now();
    const lastLogAt = this.lastLogAt.get(key) ?? 0;
    if (now - lastLogAt < intervalMs) {
      return false;
    }

    this.lastLogAt.set(key, now);
    return true;
  }
}
