import type { CategoryState, SensorCategory } from '../dwd/types';
import { getDisplayName } from '../dwd/warningMapping';

export const GROUPED_MATTER_WARNING_CONTEXT_KIND = 'dwd-grouped-weather-warnings';

export interface MatterApiLike {
  deviceTypes: Record<string, unknown>;
  registerPlatformAccessories(
    pluginIdentifier: string,
    platformName: string,
    accessories: MatterAccessoryLike[],
  ): Promise<void>;
  unregisterPlatformAccessories(
    pluginIdentifier: string,
    platformName: string,
    accessories: MatterAccessoryLike[],
  ): Promise<void>;
  updateAccessoryState(
    uuid: string,
    cluster: string,
    attributes: Record<string, unknown>,
    partId?: string,
  ): Promise<void>;
}

export interface MatterAccessoryPartLike {
  id: string;
  displayName: string;
  deviceType: unknown;
  clusters: Record<string, Record<string, unknown>>;
}

export interface MatterAccessoryLike {
  UUID: string;
  displayName: string;
  deviceType: unknown;
  serialNumber: string;
  manufacturer: string;
  model: string;
  context: Record<string, unknown>;
  clusters?: Record<string, Record<string, unknown>>;
  parts?: MatterAccessoryPartLike[];
}

export interface GroupedMatterWarningOptions {
  uuid: string;
  displayName: string;
  includeRain: boolean;
  includeThunderstorm: boolean;
  includeWind: boolean;
  includeHail: boolean;
  includeOverall: boolean;
}

export function getGroupedMatterPartIds(
  options: GroupedMatterWarningOptions,
): SensorCategory[] {
  const partIds: SensorCategory[] = [];

  if (options.includeRain) {
    partIds.push('rain');
  }

  if (options.includeThunderstorm) {
    partIds.push('thunderstorm');
  }

  if (options.includeWind) {
    partIds.push('storm');
  }

  if (options.includeHail) {
    partIds.push('hail');
  }

  if (options.includeOverall) {
    partIds.push('overall');
  }

  return partIds;
}

export function buildGroupedMatterWarningAccessory(
  matter: MatterApiLike,
  options: GroupedMatterWarningOptions,
): MatterAccessoryLike {
  const partIds = getGroupedMatterPartIds(options);

  if (partIds.length === 0) {
    throw new Error('Grouped Matter warning accessory requires at least one child sensor.');
  }

  const bridgedNode = requireDeviceType(matter, 'BridgedNode');

  return {
    UUID: options.uuid,
    displayName: options.displayName,
    deviceType: bridgedNode,
    serialNumber: 'dwd-grouped-weather-warnings',
    manufacturer: 'Deutscher Wetterdienst',
    model: 'DWD Severe Weather Warning Group',
    context: {
      kind: GROUPED_MATTER_WARNING_CONTEXT_KIND,
      partIds,
      rainSensorAvailable: hasDeviceType(matter, 'RainSensor'),
    },
    parts: partIds.map((partId) => buildPart(matter, partId)),
  };
}

export function isGroupedMatterWarningAccessory(accessory: MatterAccessoryLike): boolean {
  return accessory.context.kind === GROUPED_MATTER_WARNING_CONTEXT_KIND;
}

export function isMatterAccessoryLike(accessory: unknown): accessory is MatterAccessoryLike {
  if (!isRecord(accessory)) {
    return false;
  }

  return (
    typeof accessory.UUID === 'string' &&
    typeof accessory.displayName === 'string' &&
    'deviceType' in accessory &&
    isRecord(accessory.context)
  );
}

export function hasSameGroupedMatterParts(
  accessory: MatterAccessoryLike,
  desiredPartIds: readonly SensorCategory[],
): boolean {
  const cachedPartIds = readStringArray(accessory.context.partIds);

  return (
    cachedPartIds.length === desiredPartIds.length &&
    cachedPartIds.every((partId, index) => partId === desiredPartIds[index])
  );
}

export async function updateGroupedMatterWarningStates(
  matter: MatterApiLike,
  uuid: string,
  partIds: readonly SensorCategory[],
  states: readonly CategoryState[],
): Promise<void> {
  const statesByCategory = new Map(states.map((state) => [state.category, state]));

  await Promise.all(
    partIds.map((partId) =>
      matter.updateAccessoryState(
        uuid,
        'booleanState',
        {
          stateValue: statesByCategory.get(partId)?.active ?? false,
        },
        partId,
      ),
    ),
  );
}

export function hasRainSensorDeviceType(matter: MatterApiLike): boolean {
  return hasDeviceType(matter, 'RainSensor');
}

function buildPart(matter: MatterApiLike, partId: SensorCategory): MatterAccessoryPartLike {
  return {
    id: partId,
    displayName: getDisplayName(partId),
    deviceType: deviceTypeForPart(matter, partId),
    clusters: {
      booleanState: {
        stateValue: false,
      },
    },
  };
}

function deviceTypeForPart(matter: MatterApiLike, partId: SensorCategory): unknown {
  if (partId !== 'storm' && hasDeviceType(matter, 'RainSensor')) {
    return matter.deviceTypes.RainSensor;
  }

  return requireDeviceType(matter, 'ContactSensor');
}

function hasDeviceType(matter: MatterApiLike, deviceType: string): boolean {
  return matter.deviceTypes[deviceType] !== undefined;
}

function requireDeviceType(matter: MatterApiLike, deviceType: string): unknown {
  const value = matter.deviceTypes[deviceType];

  if (value === undefined) {
    throw new Error(`Matter device type "${deviceType}" is not available.`);
  }

  return value;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
