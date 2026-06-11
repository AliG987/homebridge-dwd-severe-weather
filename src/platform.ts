import { join } from 'node:path';
import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';
import { APIEvent } from 'homebridge';
import { validateConfig, type DwdSevereWeatherConfig } from './config';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MIN_POLL_INTERVAL_MINUTES,
  PLATFORM_NAME,
  PLUGIN_NAME,
} from './settings';
import { DwdCrowdReportsClient, type CrowdReportsProvider } from './dwd/DwdCrowdReportsClient';
import { DwdWarningsClient } from './dwd/DwdWarningsClient';
import { WarnCellResolver } from './dwd/WarnCellResolver';
import type {
  CategoryState,
  FetchWarningsResult,
  PluginCacheData,
  SensorCategory,
  WeatherWarningCategory,
} from './dwd/types';
import { buildCategoryState, buildOverallState, getDisplayName } from './dwd/warningMapping';
import { FileCache } from './utils/cache';
import { PluginLogger } from './utils/logger';
import { WeatherWarningAccessory } from './homekit/WeatherWarningAccessory';

export class DwdSevereWeatherPlatform implements DynamicPlatformPlugin {
  private readonly cachedAccessories = new Map<string, PlatformAccessory>();
  private readonly managedAccessories = new Map<SensorCategory, WeatherWarningAccessory>();
  private readonly cache: FileCache<PluginCacheData>;
  private readonly warningsClient: DwdWarningsClient;
  private readonly warnCellResolver: WarnCellResolver;
  private readonly crowdReportsClient: CrowdReportsProvider;
  private readonly logger: PluginLogger;
  private readonly validatedConfig: DwdSevereWeatherConfig | undefined;

  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private pollInProgress = false;
  private consecutiveFailures = 0;
  private lastSuccessfulUpdate: string | undefined;

  public constructor(
    log: Logger,
    rawConfig: PlatformConfig,
    private readonly api: API,
  ) {
    this.cache = new FileCache<PluginCacheData>(
      join(this.api.user.storagePath(), 'dwd-severe-weather-cache.json'),
    );
    this.warningsClient = new DwdWarningsClient({
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    });
    this.warnCellResolver = new WarnCellResolver(this.cache);
    this.crowdReportsClient = new DwdCrowdReportsClient();

    let debugEnabled = false;
    let validatedConfig: DwdSevereWeatherConfig | undefined;

    try {
      validatedConfig = validateConfig(rawConfig);
      debugEnabled = validatedConfig.debug;
    } catch (error) {
      log.error(`Invalid ${PLATFORM_NAME} configuration: ${errorMessage(error)}`);
    }

    this.validatedConfig = validatedConfig;
    this.logger = new PluginLogger(log, debugEnabled);

    this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      void this.start();
    });
    this.api.on(APIEvent.SHUTDOWN, () => {
      this.stop();
    });
  }

  public configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.set(accessory.UUID, accessory);
  }

  private async start(): Promise<void> {
    if (!this.validatedConfig) {
      this.logger.error('DWD severe weather platform disabled because the configuration is invalid.');
      return;
    }

    this.syncAccessories();
    await this.restoreCachedState();
    await this.pollOnce();

    const intervalMs =
      Math.max(MIN_POLL_INTERVAL_MINUTES, this.validatedConfig.pollIntervalMinutes) * 60 * 1000;
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
  }

  private stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private syncAccessories(): void {
    const config = this.requireConfig();
    const desiredCategories = this.getDesiredCategories(config);
    const desiredSet = new Set<SensorCategory>(desiredCategories);
    const existingByCategory = new Map<SensorCategory, PlatformAccessory>();
    const staleAccessories: PlatformAccessory[] = [];

    for (const accessory of this.cachedAccessories.values()) {
      const category = readAccessoryCategory(accessory);

      if (!category) {
        continue;
      }

      if (!desiredSet.has(category)) {
        staleAccessories.push(accessory);
        continue;
      }

      existingByCategory.set(category, accessory);
    }

    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
      for (const accessory of staleAccessories) {
        this.cachedAccessories.delete(accessory.UUID);
      }
    }

    for (const category of desiredCategories) {
      const displayName = getDisplayName(category);
      let accessory = existingByCategory.get(category);

      if (!accessory) {
        const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${config.name}:${category}`);
        accessory = new this.api.platformAccessory(displayName, uuid);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.cachedAccessories.set(accessory.UUID, accessory);
      }

      const context = accessory.context as Record<string, unknown>;
      context.category = category;
      context.displayName = displayName;

      this.managedAccessories.set(
        category,
        new WeatherWarningAccessory(
          {
            Service: this.api.hap.Service,
            Characteristic: this.api.hap.Characteristic,
          },
          accessory,
          category,
          config.sensorType,
        ),
      );
    }
  }

  private async restoreCachedState(): Promise<void> {
    const cached = await this.cache.read();
    const states = cached.lastState?.states;

    if (states && states.length > 0) {
      this.updateAccessories(states, this.shouldSetFault(new Date(), cached.lastState?.updatedAt));
    } else {
      this.updateAccessories(this.buildInactiveStates(new Date()), true);
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.pollInProgress || !this.validatedConfig) {
      return;
    }

    this.pollInProgress = true;

    try {
      const { states, fault } = await this.fetchCurrentStates();
      this.consecutiveFailures = 0;
      this.lastSuccessfulUpdate = new Date().toISOString();
      this.updateAccessories(states, fault);
      await this.writeLastState(states);
    } catch (error) {
      this.consecutiveFailures += 1;
      this.logger.errorRateLimited('poll-failed', `DWD update failed: ${errorMessage(error)}`);
      await this.restoreStateAfterFailure();
    } finally {
      this.pollInProgress = false;
    }
  }

  private async fetchCurrentStates(): Promise<{ states: CategoryState[]; fault: boolean }> {
    const config = this.requireConfig();
    const now = new Date();
    const center = {
      latitude: config.latitude,
      longitude: config.longitude,
    };
    const officialWarnings: FetchOfficialWarningsResult =
      config.crowdReports.mode === 'crowdOnly'
        ? {
            warnings: [],
            provider: 'crowdOnly',
            degraded: false,
          }
        : await this.fetchOfficialWarnings(config);
    const crowdReports =
      config.crowdReports.enabled && config.crowdReports.mode !== 'officialOnly'
        ? await this.crowdReportsClient.getReports(center, config.crowdReports)
        : [];
    const categoryStates: CategoryState[] = [];

    const warningCategories: WeatherWarningCategory[] = ['thunderstorm', 'storm'];

    for (const category of warningCategories) {
      if (!config.warnings[category].enabled) {
        continue;
      }

      categoryStates.push(
        buildCategoryState(
          category,
          config.warnings[category],
          config.crowdReports,
          officialWarnings.warnings,
          crowdReports,
          center,
          now,
        ),
      );
    }

    const states = config.overallSensor.enabled
      ? [...categoryStates, buildOverallState(categoryStates, now)]
      : categoryStates;

    if (officialWarnings.degraded) {
      this.logger.warnRateLimited(
        'warncell-degraded',
        'Using cached DWD warncell ID because resolving the current coordinates failed.',
      );
    }

    this.logger.debug(
      `DWD update completed from ${officialWarnings.provider}; active sensors: ${
        states.filter((state) => state.active).map((state) => state.displayName).join(', ') || 'none'
      }`,
    );

    return {
      states,
      fault: officialWarnings.degraded,
    };
  }

  private async fetchOfficialWarnings(
    config: DwdSevereWeatherConfig,
  ): Promise<FetchOfficialWarningsResult> {
    const warnCell = await this.warnCellResolver.resolve(config);
    const officialWarnings = await this.warningsClient.getWarningsForWarnCell(warnCell.warnCellId);

    return {
      warnings: officialWarnings.warnings,
      provider: officialWarnings.provider,
      degraded: warnCell.degraded,
    };
  }

  private async restoreStateAfterFailure(): Promise<void> {
    const cached = await this.cache.read();
    const states = cached.lastState?.states ?? this.buildInactiveStates(new Date());
    const referenceTime = cached.lastState?.updatedAt ?? this.lastSuccessfulUpdate;
    this.updateAccessories(states, this.shouldSetFault(new Date(), referenceTime));
  }

  private async writeLastState(states: CategoryState[]): Promise<void> {
    try {
      const updatedAt = new Date().toISOString();
      await this.cache.update((current) => ({
        ...current,
        lastState: {
          states,
          updatedAt,
        },
      }));
    } catch (error) {
      this.logger.warnRateLimited('cache-write', `Could not write DWD cache: ${errorMessage(error)}`);
    }
  }

  private updateAccessories(states: readonly CategoryState[], fault: boolean): void {
    for (const state of states) {
      this.managedAccessories.get(state.category)?.update(state, fault);
    }
  }

  private buildInactiveStates(now: Date): CategoryState[] {
    return this.getDesiredCategories(this.requireConfig()).map((category) => ({
      category,
      displayName: getDisplayName(category),
      active: false,
      source: 'none',
      updatedAt: now.toISOString(),
    }));
  }

  private shouldSetFault(now: Date, referenceTime: string | undefined): boolean {
    if (this.consecutiveFailures >= 3) {
      return true;
    }

    if (!referenceTime) {
      return true;
    }

    const referenceMs = Date.parse(referenceTime);
    if (!Number.isFinite(referenceMs)) {
      return true;
    }

    const config = this.requireConfig();
    const staleAfterMs = Math.max(15 * 60 * 1000, config.pollIntervalMinutes * 3 * 60 * 1000);
    return now.getTime() - referenceMs > staleAfterMs;
  }

  private getDesiredCategories(config: DwdSevereWeatherConfig): SensorCategory[] {
    const categories: SensorCategory[] = [];

    if (config.warnings.thunderstorm.enabled) {
      categories.push('thunderstorm');
    }

    if (config.warnings.storm.enabled) {
      categories.push('storm');
    }

    if (config.overallSensor.enabled) {
      categories.push('overall');
    }

    return categories;
  }

  private requireConfig(): DwdSevereWeatherConfig {
    if (!this.validatedConfig) {
      throw new Error('DWD severe weather configuration is invalid.');
    }

    return this.validatedConfig;
  }
}

interface FetchOfficialWarningsResult {
  warnings: FetchWarningsResult['warnings'];
  provider: FetchWarningsResult['provider'] | 'crowdOnly';
  degraded: boolean;
}

function readAccessoryCategory(accessory: PlatformAccessory): SensorCategory | undefined {
  const category = (accessory.context as Record<string, unknown>).category;

  return category === 'thunderstorm' || category === 'storm' || category === 'overall'
    ? category
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
