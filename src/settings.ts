export const PLATFORM_NAME = 'DwdSevereWeather';
export const PLUGIN_NAME = 'homebridge-dwd-severe-weather';

export const DEFAULT_POLL_INTERVAL_MINUTES = 5;
export const MIN_POLL_INTERVAL_MINUTES = 5;
export const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;
export const DEFAULT_RETRIES = 2;
export const WARNCELL_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const DWD_CAP_DIRECTORY_URL =
  'https://opendata.dwd.de/weather/alerts/cap/COMMUNEUNION_DWD_STAT/';
export const DWD_CAP_DEFAULT_ZIP_URL =
  'https://opendata.dwd.de/weather/alerts/cap/COMMUNEUNION_DWD_STAT/COMMUNEUNION_DWD_STAT.zip';
export const DWD_WARNWETTER_WARNINGS_URL =
  'https://www.dwd.de/DWD/warnungen/warnapp/json/warnings.json';
export const DWD_WARNCELL_GEOJSON_URL =
  'https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=dwd:Warngebiete_Gemeinden&outputFormat=application/json';
