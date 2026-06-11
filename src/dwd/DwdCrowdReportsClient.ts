import type { CrowdReportsConfig } from '../config';
import type { CrowdReport, GeoPoint } from './types';

export interface CrowdReportsProvider {
  getReports(center: GeoPoint, config: CrowdReportsConfig): Promise<CrowdReport[]>;
}

export class DwdCrowdReportsClient implements CrowdReportsProvider {
  public async getReports(_center: GeoPoint, _config: CrowdReportsConfig): Promise<CrowdReport[]> {
    // The public WarnWetter/crowdsourcing endpoint is intentionally not hard-coded here.
    // Once a stable and legally usable source is verified, implement it behind this provider.
    return [];
  }
}
