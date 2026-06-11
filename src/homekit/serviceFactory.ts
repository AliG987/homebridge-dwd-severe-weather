import type { Characteristic, Service } from 'homebridge';
import type { SensorType } from '../dwd/types';

type ServiceConstructor = typeof Service & { UUID: string };

export interface HapClasses {
  Service: typeof Service;
  Characteristic: typeof Characteristic;
}

export function serviceConstructorForSensorType(
  hap: HapClasses,
  sensorType: SensorType,
): ServiceConstructor {
  switch (sensorType) {
    case 'motion':
      return hap.Service.MotionSensor;
    case 'contact':
      return hap.Service.ContactSensor;
    case 'switch':
      return hap.Service.Switch;
    case 'occupancy':
    default:
      return hap.Service.OccupancySensor;
  }
}

export function updateActiveCharacteristic(
  hap: HapClasses,
  service: Service,
  sensorType: SensorType,
  active: boolean,
): void {
  switch (sensorType) {
    case 'motion':
      service.updateCharacteristic(hap.Characteristic.MotionDetected, active);
      return;
    case 'contact':
      service.updateCharacteristic(
        hap.Characteristic.ContactSensorState,
        active
          ? hap.Characteristic.ContactSensorState.CONTACT_DETECTED
          : hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED,
      );
      return;
    case 'switch':
      service.updateCharacteristic(hap.Characteristic.On, active);
      return;
    case 'occupancy':
    default:
      service.updateCharacteristic(
        hap.Characteristic.OccupancyDetected,
        active
          ? hap.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : hap.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
  }
}
