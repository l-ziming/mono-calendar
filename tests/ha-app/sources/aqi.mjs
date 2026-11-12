import assert from 'node:assert/strict';
import { particulateAQI, cnPrimaryEstimate, outdoorAQI } from '../../../ha-app/server/sources/aqi.mjs';
for (const [concentration, aqi] of [
  [0, 0],
  [9, 50],
  [9.1, 51],
  [35.4, 100],
  [35.5, 101],
  [55.4, 150],
  [55.5, 151],
  [125.4, 200],
  [125.5, 201],
  [225.4, 300],
  [225.5, 301],
  [325.4, 500],
  [325.5, 501],
]) {
  assert.equal(particulateAQI(concentration, 'pm25'), aqi);
}
assert.equal(particulateAQI(9.09, 'pm25'), 50, 'EPA concentration precision is truncated');
assert.equal(particulateAQI(54, 'pm10'), 50);
assert.equal(particulateAQI(55, 'pm10'), 51);
assert.equal(particulateAQI(-1, 'pm25'), null);
assert.equal(particulateAQI(null, 'pm25'), null);
assert.equal(cnPrimaryEstimate(50, 'PM2.5', '24h', 'CN2012'), 99);
assert.equal(cnPrimaryEstimate(50, 'PM10', '24h', 'CN2012'), 46, 'Same Chinese index is not uniquely convertible');
assert.equal(cnPrimaryEstimate(50, 'PM2.5', '1h', 'CN2012'), null);
assert.equal(cnPrimaryEstimate(100, 'PM2.5', '24h', 'CN2026'), 154, 'Use the revised daily PM table for 2026 data');
assert.equal(cnPrimaryEstimate(100, 'PM10', '24h', 'CN2026'), 83);
assert.equal(cnPrimaryEstimate(100, 'PM2.5', '24h', 'CN2012'), 165, 'Legacy and current tables differ');
assert.equal(
  cnPrimaryEstimate(100, 'PM2.5', '1h', 'CN2026'),
  null,
  'The realtime CN average cannot become a US daily average',
);
assert.equal(outdoorAQI({ value: 100, standard: 'CN2026' }).value, null);
assert.deepEqual(outdoorAQI({ value: 100, standard: 'CN2026', pm25: 35.4 }), {
  value: 100,
  estimated: true,
  method: 'particulate_24h',
});
assert.equal(outdoorAQI({ value: 100, standard: 'US' }).value, 100);
console.log(
  'EPA 2024 endpoints/precision, partial concentration estimates and version-qualified Chinese conversion passed.',
);
