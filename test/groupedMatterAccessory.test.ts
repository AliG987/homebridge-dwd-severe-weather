import { describe, expect, it, vi } from 'vitest';
import type { CategoryState } from '../src/dwd/types';
import {
  buildGroupedMatterWarningAccessory,
  hasRainSensorDeviceType,
  updateGroupedMatterWarningStates,
  type MatterApiLike,
} from '../src/matter/GroupedWeatherWarningMatterAccessory';

describe('grouped Matter warning accessory', () => {
  it('builds a BridgedNode parent with four child endpoints by default', () => {
    const matter = matterApi();
    const accessory = buildGroupedMatterWarningAccessory(matter, {
      uuid: 'matter-parent',
      displayName: 'DWD Unwetter',
      includeThunderstorm: true,
      includeStorm: true,
      includeHail: true,
      includeOverall: true,
    });

    expect(accessory.deviceType).toBe('bridged-node');
    expect(accessory.parts?.map((part) => part.id)).toEqual([
      'thunderstorm',
      'storm',
      'hail',
      'overall',
    ]);
    expect(accessory.parts?.map((part) => part.clusters.booleanState?.stateValue)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('uses RainSensor for weather-like parts when available', () => {
    const matter = matterApi({
      deviceTypes: {
        RainSensor: 'rain-sensor',
      },
    });
    const accessory = buildGroupedMatterWarningAccessory(matter, {
      uuid: 'matter-parent',
      displayName: 'DWD Unwetter',
      includeThunderstorm: true,
      includeStorm: true,
      includeHail: true,
      includeOverall: true,
    });

    expect(hasRainSensorDeviceType(matter)).toBe(true);
    expect(accessory.parts?.map((part) => [part.id, part.deviceType])).toEqual([
      ['thunderstorm', 'rain-sensor'],
      ['storm', 'contact-sensor'],
      ['hail', 'rain-sensor'],
      ['overall', 'rain-sensor'],
    ]);
  });

  it('updates each child endpoint by stable part id', async () => {
    const updateAccessoryState = vi.fn<MatterApiLike['updateAccessoryState']>(async () => {});
    const matter = matterApi({ updateAccessoryState });
    const states: CategoryState[] = [
      state('thunderstorm', true),
      state('storm', false),
      state('hail', true),
      state('overall', true),
    ];

    await updateGroupedMatterWarningStates(
      matter,
      'matter-parent',
      ['thunderstorm', 'storm', 'hail', 'overall'],
      states,
    );

    expect(updateAccessoryState.mock.calls).toEqual([
      ['matter-parent', 'booleanState', { stateValue: true }, 'thunderstorm'],
      ['matter-parent', 'booleanState', { stateValue: false }, 'storm'],
      ['matter-parent', 'booleanState', { stateValue: true }, 'hail'],
      ['matter-parent', 'booleanState', { stateValue: true }, 'overall'],
    ]);
  });
});

function matterApi(
  options: {
    deviceTypes?: Record<string, unknown>;
    updateAccessoryState?: MatterApiLike['updateAccessoryState'];
  } = {},
): MatterApiLike {
  return {
    deviceTypes: {
      BridgedNode: 'bridged-node',
      ContactSensor: 'contact-sensor',
      ...options.deviceTypes,
    },
    registerPlatformAccessories: async () => {},
    unregisterPlatformAccessories: async () => {},
    updateAccessoryState:
      options.updateAccessoryState ??
      (async () => {
        return undefined;
      }),
  };
}

function state(category: CategoryState['category'], active: boolean): CategoryState {
  return {
    category,
    displayName: category,
    active,
    source: active ? 'crowd' : 'none',
    updatedAt: '2026-06-11T12:00:00.000Z',
  };
}
