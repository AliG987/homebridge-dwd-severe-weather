import type { PlatformAccessory, Service } from 'homebridge';
import type { CategoryState, SensorCategory, SensorType } from '../dwd/types';
import { getDisplayName } from '../dwd/warningMapping';
import {
  type HapClasses,
  serviceConstructorForSensorType,
  updateActiveCharacteristic,
} from './serviceFactory';

export class WeatherWarningAccessory {
  private readonly service: Service;

  public constructor(
    private readonly hap: HapClasses,
    private readonly accessory: PlatformAccessory,
    private readonly category: SensorCategory,
    private readonly sensorType: SensorType,
  ) {
    const displayName = getDisplayName(category);
    const serviceConstructor = serviceConstructorForSensorType(hap, sensorType);
    const existingService = this.accessory.services.find(
      (service) => service.subtype === category || service.displayName === displayName,
    );

    if (existingService && existingService.UUID !== serviceConstructor.UUID) {
      this.accessory.removeService(existingService);
    }

    this.service =
      existingService && existingService.UUID === serviceConstructor.UUID
        ? existingService
        : this.accessory.addService(serviceConstructor, displayName, category);

    this.service.setCharacteristic(hap.Characteristic.Name, displayName);

    const informationService =
      this.accessory.getService(hap.Service.AccessoryInformation) ??
      this.accessory.addService(hap.Service.AccessoryInformation);

    informationService
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Deutscher Wetterdienst')
      .setCharacteristic(hap.Characteristic.Model, 'DWD Severe Weather Warning')
      .setCharacteristic(hap.Characteristic.SerialNumber, `dwd-${category}`);
  }

  public update(state: CategoryState, fault: boolean): void {
    const context = this.accessory.context as Record<string, unknown>;
    context.category = this.category;
    context.lastWarningState = state;

    updateActiveCharacteristic(this.hap, this.service, this.sensorType, state.active);
    this.service.updateCharacteristic(this.hap.Characteristic.StatusActive, true);
    this.service.updateCharacteristic(
      this.hap.Characteristic.StatusFault,
      fault
        ? this.hap.Characteristic.StatusFault.GENERAL_FAULT
        : this.hap.Characteristic.StatusFault.NO_FAULT,
    );
  }
}
