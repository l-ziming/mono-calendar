// The /data document the display draws from, built from the explicit fixture through the real server code.
// Writes output/fixture-data.json so scripts/check.sh can render it with the APK's own Page.java.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createApp } from '../../ha-app/server/app.mjs';
import { fixture } from '../fixtures/fixture.mjs';

const base = JSON.parse(await readFile(new URL('../../ha-app/config.example.json', import.meta.url), 'utf8'));
const { config, snapshot } = fixture({ ...base, timezone: 'America/Denver', city: '丹佛', calendars: [] });
const now = new Date('2026-11-06T21:40:00Z');
const app = createApp(
  config,
  { DISPLAY_TOKEN: 'x'.repeat(24) },
  { now: () => now, ha: { states: async () => snapshot.states } },
);
app.setSnapshot(snapshot);
const data = app.data(now);

assert.equal(data.dataTime, Date.parse(snapshot.updated));
assert.equal(data.timezone, 'America/Denver');
assert.deepEqual(Object.keys(data).sort(), [
  'ac',
  'actionSeq',
  'assistant',
  'city',
  'dataTime',
  'devices',
  'indoor',
  'online',
  'requests',
  'schedule',
  'server',
  'timezone',
  'weather',
  'weekStart',
]);
assert.deepEqual(data.requests, []);
assert.equal(data.weather.temp, 15);
assert.equal(data.weather.humidity, 49);
assert.equal(data.weather.aqi, 52);
assert.equal(data.weather.hourly.length, 6);
assert.deepEqual(data.weather.hourly[0], {
  time: '15:00',
  condition: 'cloudy',
  temp: 14,
  pop: 10,
  wind: 2.5,
  bearing: 315,
});
assert.deepEqual(
  data.weather.hourly.map((x) => x.wind),
  [2.5, 4.4, 4.4, 6.4, 6.4, 4.4],
  'km/h converted to m/s',
);
assert.deepEqual(data.weather.tomorrow, { condition: 'snowy-rainy', low: 0, high: 7 });
assert.match(data.weather.sunrise, /^\d\d:\d\d$/);
assert.equal(data.indoor.co2, 584);
assert.equal(data.indoor.co2History.length, 97, '24 hours at 15-minute steps, current reading last');
assert.equal(data.indoor.co2History.at(-1), 584);
assert.deepEqual(
  [data.indoor.pm25, data.indoor.pm10, data.indoor.pm1, data.indoor.hcho, data.indoor.tvoc],
  [5, 8, 4, 0.012, 0.046],
);
assert.deepEqual(data.ac, {
  available: true,
  mode: 'heat',
  modes: ['heat', 'cool', 'heat_cool', 'off'],
  action: 'idle',
  target: 16,
  low: 16,
  high: 24,
  min: 9,
  max: 32,
  gap: 2,
});
assert.deepEqual(
  data.devices.map((d) => [d.id, d.name, d.on, d.available]),
  [
    ['bedroom_light', '卧室落地灯', false, true],
    ['desk_light', '屏幕挂灯', false, true],
    ['fan', '风扇', false, true],
  ],
);
assert.deepEqual(data.assistant, {
  lines: ['傍晚可能有雨，出门请记得带伞。', '明天进入立冬，外出请记得添衣。', '晚餐约定前请留出路上的时间。'],
  image: null,
});
assert.equal(data.schedule.status, 'unconfigured');
assert.equal(JSON.stringify(data).includes('latitude'), false, 'coordinates stay on the server');
// Choose the forecast types the weather entity advertises, including NWS's hourly + twice-daily pair.
for (const [features, dailyType] of [
  [3, 'daily'],
  [6, 'twice_daily'],
]) {
  const states = structuredClone(snapshot.states);
  const calls = [];
  states[config.entities.weather].attributes.supported_features = features;
  const app = createApp(
    config,
    { DISPLAY_TOKEN: 'x'.repeat(24) },
    {
      now: () => now,
      ha: {
        states: async () => states,
        forecast: async (id, type = 'hourly') => {
          calls.push(type);
          return type === 'hourly'
            ? [{ datetime: '2026-11-06T22:00:00Z', temperature: 14, condition: 'cloudy', precipitation_probability: 0 }]
            : [];
        },
      },
    },
  );
  await app.refresh();
  assert.deepEqual(calls, ['hourly', dailyType]);
  assert.equal(app.data(now).weather.hourly[0].pop, 0, 'real zero percent is displayed, not treated as missing');
}
await writeFile(new URL('../../output/fixture-data.json', import.meta.url), JSON.stringify(data, null, 1) + '\n');

// Device taps carry the requested state. HA may report the old state for a moment after a switch:
// the service waits for it, and repeating the same request never toggles the light back.
{
  const states = structuredClone(snapshot.states);
  const calls = [];
  const light = config.entities.desk_light;
  let lag = 0;
  const ha = {
    states: async () => {
      if (lag > 0) {
        lag--;
        return structuredClone(states);
      }
      return structuredClone(live);
    },
    service: async (domain, service, payload) => {
      calls.push([domain, service, payload]);
      if (domain === 'nest' || domain === 'climate') {
        live[config.entities.climate].attributes.fan_mode = service === 'set_fan_timer' ? 'on' : 'off';
      } else {
        live[light].state = service === 'turn_on' ? 'on' : 'off';
      }
      lag = 1;
    },
  };
  const live = structuredClone(states);
  const app = createApp(config, { DISPLAY_TOKEN: 'x'.repeat(24) }, { now: () => now, ha, settleMs: 1 });
  app.setSnapshot({ ...snapshot, states: structuredClone(states) });
  await app.perform('device:desk_light:on');
  assert.deepEqual(calls, [['light', 'turn_on', { entity_id: light }]]);
  assert.equal(
    app.data(now).devices.find((d) => d.id === 'desk_light').on,
    true,
    'reply waits for HA to report the new state',
  );
  await app.perform('device:desk_light:on');
  assert.equal(calls.length, 1, 'a repeated on request writes nothing');
  await app.perform('device:desk_light:off');
  assert.deepEqual(calls.at(-1), ['light', 'turn_off', { entity_id: light }]);
  await app.perform('device:fan:on');
  assert.deepEqual(
    calls.at(-1),
    ['nest', 'set_fan_timer', { entity_id: config.entities.climate, duration: '00:15:00' }],
    'the Nest runs its own 15-minute timer, never the 12 hours of set_fan_mode',
  );
  assert.equal(app.data(now).devices.find((d) => d.id === 'fan').minutes, 15);
  await app.perform('device:fan:off');
  assert.deepEqual(calls.at(-1), ['climate', 'set_fan_mode', { entity_id: config.entities.climate, fan_mode: 'off' }]);
  const bare = structuredClone(states);
  delete bare[config.entities.climate].attributes.fan_mode;
  const blind = createApp(
    config,
    { DISPLAY_TOKEN: 'x'.repeat(24) },
    { now: () => now, ha: { ...ha, states: async () => structuredClone(bare) }, settleMs: 1 },
  );
  blind.setSnapshot({ ...snapshot, states: bare });
  assert.equal(blind.data(now).devices.find((d) => d.id === 'fan').available, false);
  await assert.rejects(
    blind.perform('device:fan:on'),
    /风机状态不可用/,
    'a fan the Nest does not report on is refused',
  );
}
// Thermostats can acknowledge a command while still reporting their previous state.
{
  const live = structuredClone(snapshot.states);
  const id = config.entities.climate;
  const calls = [];
  let pending = null;
  let lag = 0;
  let stuck = false;
  let reads = 0;
  const ha = {
    states: async () => {
      reads++;
      if (pending && !stuck && lag-- <= 0) {
        for (const [key, value] of Object.entries(pending)) {
          if (key === 'hvac_mode') {
            live[id].state = value;
          } else if (key !== 'entity_id') {
            live[id].attributes[key] = value;
          }
        }
        pending = null;
      }
      return structuredClone(live);
    },
    service: async (domain, service, payload) => {
      calls.push([domain, service, payload]);
      pending = payload;
      lag = 2;
    },
  };
  const cfg = { ...config, entities: { ...config.entities, weather: '', co2: '' } };
  const app = createApp(cfg, { DISPLAY_TOKEN: 'x'.repeat(24) }, { now: () => now, ha, settleMs: 1 });
  app.setSnapshot(structuredClone(snapshot));
  await app.perform('temp:16.5');
  assert.equal(app.data(now).ac.target, 16.5);
  assert.ok(reads >= 4, 'wait for the actual state, not just a successful service call');
  await app.perform('temp:16.5');
  assert.equal(calls.length, 1, 'repeating a target never increments twice');
  await app.perform('mode:cool');
  assert.equal(app.data(now).ac.mode, 'cool');
  await assert.rejects(
    app.perform('temp:heat:17'),
    /模式已变化/,
    'stale heat controls must not change the cooling target',
  );
  await app.perform('mode:heat_cool');
  await app.perform('range:16.5:24.5');
  assert.deepEqual([app.data(now).ac.low, app.data(now).ac.high], [16.5, 24.5]);
  const count = calls.length;
  await app.perform('range:16.5:24.5');
  assert.equal(calls.length, count);
  await assert.rejects(app.perform('range:24:24.5'), /间隔|范围/);
  await assert.rejects(
    app.perform('range:23:24.5'),
    /至少 2/,
    'Nest silently expands narrower ranges; reject before writing',
  );
  await app.perform('mode:heat');
  stuck = true;
  await assert.rejects(app.perform('temp:17'), (error) => error.status === 503 && /未确认/.test(error.message));
  assert.equal(app.data(now).ac.target, 16.5, 'a timeout never fabricates the requested state');
}
// The interaction model: independent devices in parallel, one budget per write, newer target wins,
// unconfirmed writes keep being checked, and HA's reported state is the only "confirmed" value.
{
  const live = structuredClone(snapshot.states);
  const lamp = config.entities.bedroom_light;
  const light = config.entities.desk_light;
  const calls = [];
  const gates = new Map();
  let apply = true;
  let reject = false;
  const ha = {
    states: async () => structuredClone(live),
    service: async (domain, service, payload) => {
      calls.push([domain, service, payload.entity_id]);
      if (reject) {
        throw new Error('HA HTTP 400');
      }
      if (gates.has(payload.entity_id)) {
        await gates.get(payload.entity_id);
      }
      if (apply) {
        live[payload.entity_id].state = service === 'turn_on' ? 'on' : 'off';
      }
    },
  };
  const app = createApp(
    config,
    { DISPLAY_TOKEN: 'x'.repeat(24) },
    { now: () => now, ha, settleMs: 5, actionBudgetMs: 300, recheckMs: 20, reconcileMs: 400 },
  );
  app.setSnapshot({ ...snapshot, states: structuredClone(live) });
  const status = (id) => app.data(now).requests.find((r) => r.id === id)?.status;

  // A slow light never holds up the other one.
  let release;
  gates.set(
    lamp,
    new Promise((r) => {
      release = r;
    }),
  );
  const slow = app.submit('device:bedroom_light:on', 'slow-lamp-1');
  const fast = app.submit('device:desk_light:on', 'fast-light-1');
  await fast.done;
  assert.equal(status('fast-light-1'), 'confirmed', 'a different device is not blocked by a pending write');
  assert.equal(status('slow-lamp-1'), 'pending');
  // The slow command exceeds its single budget: reported unconfirmed, HA value shown, then confirmed on re-check.
  await assert.rejects(slow.done, (error) => error.status === 503);
  assert.equal(status('slow-lamp-1'), 'unconfirmed');
  assert.equal(
    app.data(now).devices.find((d) => d.id === 'bedroom_light').on,
    false,
    'unconfirmed never shows the requested target as HA state',
  );
  release();
  gates.delete(lamp);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(status('slow-lamp-1'), 'confirmed', 'a late HA report confirms the earlier write');
  assert.equal(app.data(now).devices.find((d) => d.id === 'bedroom_light').on, true);

  // Newer target on the same device supersedes the older one; only the latest decides.
  gates.set(light, new Promise((r) => setTimeout(r, 40)));
  const first = app.submit('device:desk_light:off', 'light-off-1');
  const second = app.submit('device:desk_light:on', 'light-on-2');
  await assert.rejects(first.done, (error) => error.status === 409);
  await second.done;
  gates.delete(light);
  assert.deepEqual([status('light-off-1'), status('light-on-2')], ['superseded', 'confirmed']);
  assert.equal(
    app.data(now).devices.find((d) => d.id === 'desk_light').on,
    true,
    'the last request wins, not the slowest reply',
  );

  // A device that ignores the command: unconfirmed after the budget, failed when re-checks run out.
  apply = false;
  await assert.rejects(app.submit('device:desk_light:off', 'ignored-1').done);
  assert.equal(status('ignored-1'), 'unconfirmed');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(status('ignored-1'), 'failed');
  assert.equal(app.data(now).requests.find((r) => r.id === 'ignored-1').error, '设备未执行或未回报');
  assert.equal(app.data(now).devices.find((d) => d.id === 'desk_light').on, true);

  // HA refusing the call is definite: failed at once, nothing left to re-check.
  apply = true;
  reject = true;
  await assert.rejects(app.submit('device:desk_light:off', 'refused-1').done, (error) => error.status === 502);
  assert.equal(status('refused-1'), 'failed');
  reject = false;
  // The earlier ignored write left the light uncertain, so the next request is sent even though HA shows its target.
  const before = calls.length;
  await app.submit('device:desk_light:on', 'resend-1').done;
  assert.equal(calls.length, before + 1, 'after an uncertain write the target is sent again');
  assert.ok(app.data(now).actionSeq >= 7);
}
// The Nest reports fan "on" tens of seconds after the command: it stays "pending" (waiting), not unconfirmed.
{
  const live = structuredClone(snapshot.states);
  const climate = config.entities.climate;
  live[climate].attributes.fan_mode = 'off';
  live[climate].attributes.fan_modes = ['on', 'off'];
  let reports = 0;
  const ha = {
    states: async () => {
      if (reports > 0 && --reports === 0) {
        live[climate].attributes.fan_mode = 'on';
      }
      return structuredClone(live);
    },
    service: async (domain, service) => {
      if (service === 'set_fan_timer') {
        reports = 30;
      }
    },
  };
  const app = createApp(
    config,
    { DISPLAY_TOKEN: 'x'.repeat(24) },
    { now: () => now, ha, settleMs: 2, actionBudgetMs: 20, fanBudgetMs: 2000 },
  );
  app.setSnapshot({ ...snapshot, states: structuredClone(live) });
  const run = app.submit('device:fan:on', 'fan-on-1');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(
    app.data(now).requests[0].status,
    'pending',
    'command accepted but Nest still off: still waiting, beyond the normal budget',
  );
  assert.equal(
    app.data(now).devices.find((d) => d.id === 'fan').on,
    false,
    'an accepted command alone is never shown as the fan on',
  );
  await run.done;
  assert.equal(app.data(now).requests[0].status, 'confirmed');
  assert.equal(app.data(now).devices.find((d) => d.id === 'fan').on, true);
}
console.log(
  '/data, target-state device writes, thermostat confirmation, parallel devices, superseding, one budget, re-check to confirmed/failed and HA refusals checked.',
);
