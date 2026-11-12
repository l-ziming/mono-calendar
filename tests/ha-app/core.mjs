import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildView, dayInfo, planAction, upcoming } from '../../ha-app/server/core.mjs';
import { sunHours, co2Trend, airGrades } from '../../ha-app/server/metrics.mjs';
import { HomeAssistant } from '../../ha-app/server/sources/ha.mjs';
import { fixture } from '../fixtures/fixture.mjs';

const { config, snapshot } = fixture({
  ...JSON.parse(await readFile(new URL('../../ha-app/config.example.json', import.meta.url), 'utf8')),
  timezone: 'America/Denver',
});
const now = new Date('2026-11-06T21:30:00Z');
const at = now.getTime();
assert.equal(dayInfo('2026-11-06').meta, '开日 冲虎 煞南');
assert.match(dayInfo('2026-11-06').ganzhi, /甲申日/);
// The assistant and panel must use the same festival names, including holidays absent from the library's default list.
for (const [date, names] of [
  ['2026-01-01', ['元旦']],
  ['2026-03-08', ['妇女节']],
  ['2026-10-31', ['万圣夜']],
  ['2026-02-10', ['小年']],
  ['2026-08-19', ['七夕']],
  ['2026-08-27', ['中元节']],
  ['2026-06-19', ['端午节']],
  ['2009-05-28', ['端午节']],
  ['2009-06-27', []],
  ['2027-02-05', ['除夕']],
  ['2027-02-06', ['春节']],
  ['2024-02-09', ['除夕']],
  ['2026-05-10', ['母亲节']],
  ['2026-06-21', ['父亲节']],
  ['2026-11-26', ['感恩节']],
  ['2026-05-03', []],
  ['2026-05-17', []],
  ['2026-06-14', []],
  ['2026-06-28', []],
  ['2026-11-19', []],
  ['2026-03-12', []],
  ['2020-10-01', ['国庆节', '中秋节']],
]) {
  assert.deepEqual(dayInfo(date).events, names, date);
}
assert.equal(dayInfo('2027-02-05').lunar, '腊月廿九', '除夕 also occurs in a 29-day lunar month');
assert.equal(dayInfo('2024-02-09').lunar, '腊月三十');
assert.equal(dayInfo('2009-06-27').lunar, '闰五月初五', 'a leap month does not repeat 端午节');
assert.deepEqual(dayInfo('2026-03-20').events, ['龙抬头']);
assert.equal(dayInfo('2026-03-20').term, '春分');
assert.equal(dayInfo('2026-03-20').label, '龙抬头', 'festival and solar term coexist; the festival is the cell label');
assert.equal(dayInfo('2026-06-21').term, '夏至');
assert.equal(dayInfo('2026-11-07').term, '立冬');
assert.deepEqual(
  upcoming('2026-03-19')
    .slice(0, 2)
    .map((x) => [x.name, x.days]),
  [
    ['龙抬头', 1],
    ['春分', 1],
  ],
);
assert.deepEqual(upcoming('2026-12-31')[0], { name: '元旦', date: '01/01', days: 1, countdown: '明天' });
const view = buildView(config, snapshot, now);
assert.equal(view.sunrise, '06:34');
assert.equal(view.sunset, '16:53');
assert.deepEqual(view.tomorrow, { condition: 'snowy-rainy', low: 0, high: 7 });
// NWS supplies day/night periods rather than a daily low/high object. Respect local dates and units.
const nws = structuredClone(snapshot);
nws.forecastUnit = '°F';
nws.dailyForecast = [
  { datetime: '2026-11-07T01:00:00Z', is_daytime: false, temperature: 40, condition: 'clear-night' }, // still today in Denver
  { datetime: '2026-11-07T13:00:00-07:00', is_daytime: true, temperature: 59, condition: 'sunny' },
  { datetime: '2026-11-07T18:00:00-07:00', is_daytime: false, temperature: 32, condition: 'clear-night' },
];
assert.deepEqual(buildView(config, nws, now).tomorrow, { condition: 'sunny', low: 0, high: 15 });
nws.dailyForecast.pop();
assert.deepEqual(
  buildView(config, nws, now).tomorrow,
  { condition: 'sunny', low: null, high: 15 },
  'missing night temperature stays unknown',
);
assert.deepEqual(view.upcoming[0], { name: '立冬', date: '11/07', days: 1, countdown: '明天' });
assert.equal(view.co2History.at(-1).value, 584);
assert.equal(view.co2History.length, 97);
const airnow = structuredClone(snapshot);
const aqiState = airnow.states[config.entities.outdoor_aqi];
aqiState.state = '60';
const observed = buildView(config, airnow, now);
assert.equal(observed.aqi, 60);
assert.equal(observed.grades.aqi.label, '良');
aqiState.state = 'unavailable';
assert.equal(buildView(config, airnow, now).aqi, null);
assert.equal(buildView(config, airnow, now).grades.aqi.label, '—');
assert.equal(buildView(config, snapshot, now).header.iso, '2026-11-06');
assert.deepEqual(sunHours('2026-11-06', null, null), { rise: null, set: null });
assert.deepEqual(sunHours('2026-11-06', 89, 0), { rise: null, set: null });
const points = co2Trend(
  [
    { time: new Date(at - 1800000).toISOString(), value: 1200 },
    { time: new Date(at - 900000).toISOString(), value: null },
  ],
  584,
  at,
);
assert.equal(points.at(-3).value, 1200);
assert.equal(points.at(-2).value, null);
assert.equal(points.at(-1).value, 584);
assert.equal(co2Trend([], null, at).filter((x) => x.value !== null).length, 0);
const stale = co2Trend([{ time: new Date(at - 3600000).toISOString(), value: 1200 }], 584, at, at, at - 1800000);
assert.equal(stale.at(-2).value, null);
assert.equal(stale.at(-1).value, 584);
assert.equal(airGrades({ co2: 1000, aqi: 50 }).co2.label, '良好');
assert.equal(airGrades({ co2: 1501, aqi: 201 }).co2.level, 2);
assert.equal(airGrades({ co2: 1001, aqi: 201 }).aqi.label, '重度污染');
for (const [aqi, label] of [
  [50, '优'],
  [51, '良'],
  [100, '良'],
  [101, '轻度污染'],
  [150, '轻度污染'],
  [151, '中度污染'],
  [200, '中度污染'],
  [201, '重度污染'],
  [300, '重度污染'],
  [301, '严重污染'],
]) {
  assert.equal(airGrades({ aqi }).aqi.label, label);
}
for (const [key, threshold] of [
  ['pm25', 50],
  ['pm10', 100],
  ['pm1', 15],
  ['hcho', 0.08],
  ['tvoc', 0.6],
]) {
  for (const [value, grade] of [
    [threshold, '正常'],
    [threshold + 0.01, '偏高'],
    [null, '—'],
  ]) {
    assert.equal(airGrades({ [key]: value }).metrics.find((metric) => metric.key === key).grade, grade, key);
  }
}
assert.deepEqual(planAction('mode:heat_cool', config, snapshot), [
  ['climate', 'set_hvac_mode', { entity_id: config.entities.climate, hvac_mode: 'heat_cool' }],
]);
assert.throws(() => planAction('mode:dry', config, snapshot));
const range = structuredClone(snapshot);
range.states[config.entities.climate].state = 'heat_cool';
assert.equal(planAction('range_low_up', config, range)[0][2].target_temp_low, 16.5);
range.states[config.entities.climate].attributes.target_temp_low = 23;
assert.equal(planAction('range_low_up', config, range)[0][2].target_temp_low, 22);
range.states[config.entities.climate].attributes.target_temp_high = 32;
assert.equal(planAction('range_high_up', config, range)[0][2].target_temp_high, 32);
// The two original Fahrenheit formulas round decimal step ties differently.
const fahrenheitSnapshot = structuredClone(snapshot);
const fahrenheitClimate = fahrenheitSnapshot.states[config.entities.climate];
Object.assign(fahrenheitClimate.attributes, {
  temperature_unit: '°F',
  target_temp_step: 0.1,
  min_temp: 41,
  max_temp: 89.6,
});
fahrenheitClimate.state = 'heat_cool';
assert.equal(planAction('range:9.25:20', config, fahrenheitSnapshot)[0][2].target_temp_low, 48.7);
fahrenheitClimate.state = 'heat';
assert.equal(planAction('temp:9.25', config, fahrenheitSnapshot)[0][2].temperature, 48.6);
const originalFetch = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/history/')) {
      return {
        ok: true,
        json: async () => [
          [
            { state: '584', last_changed: now.toISOString() },
            { state: 'unavailable', last_changed: new Date(at - 60000).toISOString() },
          ],
        ],
      };
    }
    return {
      ok: true,
      json: async () => ({ location_name: '测试城市', latitude: 40, longitude: -111, secret: 'never forward' }),
    };
  };
  const ha = new HomeAssistant('http://ha.test', 'test-key');
  assert.deepEqual(await ha.location(), { name: '测试城市', latitude: 40, longitude: -111 });
  assert.deepEqual(await ha.history('sensor.co2', new Date(at - 86400000).toISOString(), now.toISOString()), [
    { time: now.toISOString(), value: 584 },
    { time: new Date(at - 60000).toISOString(), value: null },
  ]);
  const url = new URL(calls[1].url);
  assert.equal(url.searchParams.get('filter_entity_id'), 'sensor.co2');
  assert.equal(url.searchParams.get('minimal_response'), '1');
  assert.equal(url.searchParams.get('significant_changes_only'), '0');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('Panel data: almanac, sun, weather, air grades, real-history gaps and HVAC limits passed.');
