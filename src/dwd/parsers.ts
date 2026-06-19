import { XMLParser } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';
import type { WeatherWarning, WeatherWarningLevel } from './types';

type XmlRecord = Record<string, unknown>;

const CAP_XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
});

export class ParserError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ParserError';
  }
}

export function parseCapZip(buffer: ArrayBuffer): WeatherWarning[] {
  let entries: Record<string, Uint8Array>;

  try {
    entries = unzipSync(new Uint8Array(buffer));
  } catch (error) {
    throw new ParserError(`Unable to unzip DWD CAP payload: ${errorMessage(error)}`);
  }

  const warnings: WeatherWarning[] = [];

  for (const [fileName, fileContent] of Object.entries(entries)) {
    if (!fileName.toLowerCase().endsWith('.xml')) {
      continue;
    }

    warnings.push(...parseCapXml(strFromU8(fileContent)));
  }

  return warnings;
}

export function parseCapXml(xml: string): WeatherWarning[] {
  const parsed = CAP_XML_PARSER.parse(xml) as unknown;
  const root = asRecord(parsed);
  const alerts = getRecords(root, 'alert');

  if (alerts.length === 0) {
    const maybeAlert = root ? asRecord(root.alert) : undefined;
    if (maybeAlert) {
      alerts.push(maybeAlert);
    } else if (root && root.info !== undefined) {
      alerts.push(root);
    }
  }

  return alerts.flatMap(parseCapAlert).filter(isWeatherWarning);
}

export function parseWarnWetterWarnings(payload: unknown): WeatherWarning[] {
  const root = asRecord(payload);
  const warningMap = asRecord(root?.warnings);

  if (!warningMap) {
    throw new ParserError('WarnWetter payload does not contain a warnings object.');
  }

  const warnings: WeatherWarning[] = [];

  for (const [warnCellId, rawWarnings] of Object.entries(warningMap)) {
    for (const rawWarning of toArray(rawWarnings)) {
      const warningRecord = asRecord(rawWarning);
      if (!warningRecord) {
        continue;
      }

      const parsed = parseWarnWetterWarning(warnCellId, warningRecord);
      if (parsed) {
        warnings.push(parsed);
      }
    }
  }

  return warnings;
}

export function normalizeWarningLevel(value: unknown): WeatherWarningLevel {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 1) {
      return 'yellow';
    }

    if (value === 2) {
      return 'orange';
    }

    if (value === 3) {
      return 'red';
    }

    return 'purple';
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return normalizeWarningLevel(numeric);
    }
  }

  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  if (normalized.includes('purple') || normalized.includes('extreme') || normalized.includes('violet')) {
    return 'purple';
  }

  if (normalized.includes('red') || normalized.includes('severe')) {
    return 'red';
  }

  if (normalized.includes('orange')) {
    return 'orange';
  }

  return 'yellow';
}

function parseCapAlert(alert: XmlRecord): Array<WeatherWarning | undefined> {
  const identifier = readString(alert.identifier) ?? readString(alert.id) ?? 'dwd-cap-warning';
  const infoRecords = getRecords(alert, 'info');

  return infoRecords.map((info, index) => {
    const parameters = readParameters(info);
    const eventCodes = readNamedValues(info, 'eventCode');
    const areaRecords = getRecords(info, 'area');
    const warnCellIds = uniqueStrings(
      areaRecords.flatMap((area) => readGeocodes(area)).filter((value) => value.length > 0),
    );

    const event = readString(info.event) ?? readString(parameters.EVENT) ?? 'Unknown warning';
    const headline = readString(info.headline);
    const description = readString(info.description);
    const eventCode =
      readString(eventCodes.II) ??
      readString(parameters.EVENT_CODE) ??
      readString(parameters.EC_II) ??
      readString(info.eventCode);
    const eventGroup =
      readString(eventCodes.GROUP) ??
      readString(parameters.EVENT_GROUP) ??
      readString(parameters.EC_GROUP);
    const level = normalizeWarningLevel(
      parameters.SEVERITY_LEVEL ?? parameters.WARNING_LEVEL ?? parameters.LEVEL ?? info.severity,
    );
    const startsAt =
      parseDateValue(info.onset) ??
      parseDateValue(info.effective) ??
      parseDateValue(info.sent) ??
      new Date().toISOString();
    const endsAt = parseDateValue(info.expires) ?? startsAt;

    if (warnCellIds.length === 0) {
      return undefined;
    }

    return {
      id: `${identifier}:${index}`,
      source: 'official',
      warnCellIds,
      event,
      eventCode,
      eventGroup,
      level,
      isPreWarning: isPreWarning(event, headline, description, parameters),
      startsAt,
      endsAt,
      headline,
      description,
      instruction: readString(info.instruction),
    };
  });
}

function parseWarnWetterWarning(
  warnCellId: string,
  warningRecord: XmlRecord,
): WeatherWarning | undefined {
  const event = readString(warningRecord.event) ?? readString(warningRecord.eventName) ?? 'Unknown warning';
  const headline = readString(warningRecord.headline);
  const description = readString(warningRecord.description);
  const startsAt = parseDateValue(warningRecord.start) ?? parseDateValue(warningRecord.onset);
  const endsAt = parseDateValue(warningRecord.end) ?? parseDateValue(warningRecord.expires);

  if (!startsAt || !endsAt) {
    return undefined;
  }

  return {
    id: readString(warningRecord.id) ?? `${warnCellId}:${event}:${startsAt}`,
    source: 'official',
    warnCellIds: [warnCellId],
    event,
    eventCode: readString(warningRecord.eventCode),
    eventGroup: readString(warningRecord.eventGroup),
    level: normalizeWarningLevel(warningRecord.level),
    isPreWarning: isPreWarning(event, headline, description, warningRecord),
    startsAt,
    endsAt,
    headline,
    description,
    instruction: readString(warningRecord.instruction),
  };
}

function readParameters(info: XmlRecord): Record<string, unknown> {
  return readNamedValues(info, 'parameter');
}

function readNamedValues(info: XmlRecord, recordName: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const record of getRecords(info, recordName)) {
    const name = readString(record.valueName);
    if (!name) {
      continue;
    }

    result[name.toUpperCase()] = record.value;
  }

  return result;
}

function readGeocodes(area: XmlRecord): string[] {
  const geocodes = getRecords(area, 'geocode');
  const result: string[] = [];

  for (const geocode of geocodes) {
    const name = readString(geocode.valueName)?.toUpperCase() ?? '';
    const value = readString(geocode.value);

    if (!value) {
      continue;
    }

    if (
      name.includes('WARNCELL') ||
      name.includes('GEOCODE') ||
      name.includes('ARS') ||
      name.includes('AGS')
    ) {
      result.push(value);
    }
  }

  return result;
}

function isPreWarning(
  event: string,
  headline: string | undefined,
  description: string | undefined,
  parameters: Record<string, unknown>,
): boolean {
  const text = [event, headline, description, readString(parameters.MSG_TYPE), readString(parameters.TYPE)]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  return text.includes('vorab') || text.includes('prewarning') || text.includes('advance warning');
}

function parseDateValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return timestampToIso(value);
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const trimmed = value.trim();
  const numeric = Number(trimmed);

  if (Number.isFinite(numeric)) {
    return timestampToIso(numeric);
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function timestampToIso(value: number): string {
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(milliseconds).toISOString();
}

function getRecords(record: XmlRecord | undefined, key: string): XmlRecord[] {
  if (!record) {
    return [];
  }

  return toArray(record[key]).map(asRecord).filter(isRecord);
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function asRecord(value: unknown): XmlRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isWeatherWarning(value: WeatherWarning | undefined): value is WeatherWarning {
  return value !== undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
