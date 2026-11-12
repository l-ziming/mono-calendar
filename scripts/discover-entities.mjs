// Run on the server: HA_TOKEN=... node scripts/discover-entities.mjs [HA_URL]
// Lists the entities worth mapping in the app options, by domain and sensor type rather than by name.
// Emits IDs, friendly names, units and attribute names only, never states or secrets.
import { HomeAssistant } from '../ha-app/server/sources/ha.mjs';

const DOMAINS = new Set([
  'calendar',
  'image',
  'weather',
  'climate',
  'light',
  'switch',
  'fan',
  'humidifier',
  'input_text',
]);
const SENSOR_CLASSES = new Set([
  'temperature',
  'humidity',
  'carbon_dioxide',
  'aqi',
  'pm1',
  'pm25',
  'pm10',
  'volatile_organic_compounds',
  'volatile_organic_compounds_parts',
]);
const SENSOR_UNITS = new Set(['°C', '°F', '%', 'ppm', 'µg/m³', 'μg/m³', 'mg/m³']);

if (!process.env.HA_TOKEN) throw new Error('Set HA_TOKEN in the server environment');
const ha = new HomeAssistant(process.argv[2] || 'http://homeassistant.local:8123', process.env.HA_TOKEN);
const states = await ha.request('/api/states');
const wanted = (state) => {
  const domain = state.entity_id.split('.')[0];
  if (DOMAINS.has(domain)) return true;
  if (domain !== 'sensor') return false;
  // Sensors without a device class (formaldehyde, many air purifiers) are still found by their unit.
  return SENSOR_CLASSES.has(state.attributes.device_class) || SENSOR_UNITS.has(state.attributes.unit_of_measurement);
};
console.log(
  JSON.stringify(
    states.filter(wanted).map((state) => ({
      entity_id: state.entity_id,
      name: state.attributes.friendly_name,
      unit: state.attributes.unit_of_measurement || state.attributes.temperature_unit,
      attributes: Object.keys(state.attributes),
    })),
    null,
    2,
  ),
);
