import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { displaySettings } from '../../ha-app/server/display-config.mjs';
import { addonSettings } from '../../ha-app/server/addon.mjs';
import { createApp } from '../../ha-app/server/app.mjs';
import { fixture } from '../fixtures/fixture.mjs';

const base = JSON.parse(await readFile(new URL('../../ha-app/config.example.json', import.meta.url), 'utf8'));
const { config, snapshot } = fixture({ ...base, timezone: 'America/Denver' });
const legacy = displaySettings(config);
assert.deepEqual(
  legacy.rooms.map((room) => room.name),
  ['客厅', '卧室'],
);
assert.deepEqual(
  legacy.devices.map((device) => device.id),
  ['bedroom_light', 'desk_light', 'fan'],
);

const rooms = [
  { id: 'study', name: '书房', temperature: 'sensor.study#temperature', humidity: 'sensor.study#humidity' },
  { id: 'nursery', name: '儿童房', temperature: 'sensor.nursery' },
  { id: 'balcony', name: '阳台', temperature: 'sensor.balcony', humidity: 'sensor.absent' },
];
const devices = [
  { id: 'fan', name: '循环扇', entity: 'fan.study', type: 'toggle' },
  { id: 'central_fan', name: '空调风扇', entity: config.entities.climate, type: 'nest_fan' },
  { id: 'study_light', name: '书房灯', entity: 'light.study', type: 'toggle' },
  { id: 'socket', name: '插座', entity: 'switch.study', type: 'toggle' },
];
const custom = { ...config, rooms, devices };
const adapted = addonSettings(
  { display_token: 'display-test-token-0123456789', rooms, devices },
  base,
  'supervisor-test-token',
).config;
assert.equal(adapted.rooms[0].temperature, 'sensor.study#temperature');
assert.equal(displaySettings(adapted).rooms[1].humidity, '');
assert.deepEqual(adapted.devices, devices);
assert.doesNotThrow(
  () =>
    createApp(
      addonSettings({ display_token: 'display-test-token-0123456789' }, base, 'supervisor-test-token').config,
      {},
    ),
  'A fresh HA installation may leave the legacy light entities blank',
);

for (const patch of [
  { rooms: null },
  { rooms: 'study' },
  { rooms: Array(7).fill(rooms[0]) },
  { rooms: [rooms[0], rooms[0]] },
  { rooms: [{ ...rooms[0], temperature: '../private' }] },
  { rooms: [{ ...rooms[0], name: ' ' }] },
  { devices: null },
  { devices: Array(9).fill(devices[0]) },
  { devices: [devices[0], devices[0]] },
  { devices: [devices[0], { ...devices[0], id: 'second' }] },
  { devices: [{ ...devices[0], id: 'room:on' }] },
  { devices: [{ ...devices[0], entity: '' }] },
  { devices: [{ ...devices[0], entity: 'lock.door' }] },
  { devices: [{ ...devices[0], entity: 'light.study#state' }] },
  { devices: [{ ...devices[0], type: 'service' }] },
  { devices: [{ ...devices[1], entity: 'fan.study' }] },
]) {
  assert.throws(() => createApp({ ...config, ...patch }, {}));
  assert.throws(() => addonSettings({ display_token: 'display-test-token-0123456789', ...patch }, base, 'token'));
}

Object.assign(snapshot.states, {
  'sensor.study': { state: 'ok', attributes: { temperature: 68, humidity: 35, unit_of_measurement: '°F' } },
  'sensor.nursery': { state: '24', attributes: { unit_of_measurement: '°C' } },
  'sensor.balcony': { state: 'unavailable', attributes: {} },
  'fan.study': { state: 'off', attributes: {} },
  'light.study': { state: 'off', attributes: {} },
  'switch.study': { state: 'off', attributes: {} },
});
const calls = [];
let requested = [];
const app = createApp(
  custom,
  { DISPLAY_TOKEN: 'x'.repeat(24) },
  {
    now: () => new Date('2026-11-06T21:40:00Z'),
    settleMs: 1,
    actionBudgetMs: 100,
    fanBudgetMs: 200,
    ha: {
      states: async (ids) => {
        requested = ids;
        return snapshot.states;
      },
      forecast: async () => [],
      service: async (domain, action, payload) => {
        calls.push([domain, action, payload]);
        const state = snapshot.states[payload.entity_id];
        if (domain === 'nest' || domain === 'climate') {
          state.attributes.fan_mode = action === 'set_fan_timer' ? 'on' : 'off';
        } else {
          state.state = action === 'turn_on' ? 'on' : 'off';
        }
      },
    },
  },
);
app.setSnapshot(snapshot);
assert.deepEqual(app.data().rooms, [
  { id: 'study', name: '书房', temp: 20, humidity: 35 },
  { id: 'nursery', name: '儿童房', temp: 24, humidity: null },
  { id: 'balcony', name: '阳台', temp: null, humidity: null },
]);
const context = await app.assistantContext();
for (const entity of ['sensor.study', 'sensor.nursery', 'sensor.balcony', 'fan.study', 'light.study', 'switch.study']) {
  assert.ok(requested.includes(entity), 'Configured sensors and devices must be fetched');
}
assert.equal(context.indoor.temperature, 22);
assert.equal(context.indoor.humidity, 35);
assert.ok(context.devices.some((device) => device.entity_id === 'fan.study'));
assert.equal(JSON.stringify(app.data().rooms).includes('sensor.'), false, 'Sensor mappings stay on the server');
await app.perform('device:fan:on');
assert.deepEqual(calls.at(-1), ['fan', 'turn_on', { entity_id: 'fan.study' }]);
assert.equal(app.data().devices.find((device) => device.id === 'fan').minutes, undefined);
await app.perform('device:central_fan:on');
assert.deepEqual(calls.at(-1), ['nest', 'set_fan_timer', { entity_id: config.entities.climate, duration: '00:15:00' }]);
assert.equal(app.data().devices.find((device) => device.id === 'central_fan').minutes, 15);
await app.perform('device:central_fan:off');
assert.deepEqual(calls.at(-1), ['climate', 'set_fan_mode', { entity_id: config.entities.climate, fan_mode: 'off' }]);
await app.perform('device:study_light:on');
await app.perform('device:socket:on');
assert.equal(
  app.data().devices.every((device) => device.available),
  true,
);
assert.throws(
  () => app.submit('device:bedroom_light:on'),
  (error) => error.status === 400,
);
assert.throws(
  () => app.submit('device:unknown:on'),
  (error) => error.status === 400,
);
snapshot.states['switch.study'].state = 'unavailable';
await assert.rejects(app.perform('device:socket:off'), (error) => error.status === 409);

console.log(
  'Room/device configuration: legacy defaults, selectors, units, averages, whitelist, independent Nest timer and unavailable devices checked.',
);
