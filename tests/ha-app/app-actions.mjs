import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../../ha-app/server/app.mjs';
import { fixture } from '../fixtures/fixture.mjs';

const base = JSON.parse(await readFile(new URL('../../ha-app/config.example.json', import.meta.url), 'utf8'));
const { config, snapshot } = fixture({ ...base, calendars: [] });
config.entities.weather = '';
config.entities.co2 = '';
const now = () => new Date('2026-11-06T21:40:00Z');
const env = { DISPLAY_TOKEN: 'x'.repeat(24) };
// Short budgets keep the ignored-write cases fast; background re-checks are pushed past the test's end.
const quick = { settleMs: 1, actionBudgetMs: 60, fanBudgetMs: 60, recheckMs: 60000, reconcileMs: 0 };
for (const device of ['bedroom_light', 'desk_light', 'fan']) {
  const live = structuredClone(snapshot.states);
  const entities = config.entities;
  const calls = [];
  live[entities.climate].attributes.fan_mode = 'off';
  let pending = null;
  let reads = 0;
  let stuck = false;
  let offline = false;
  const ha = {
    states: async () => {
      if (offline) {
        throw new Error('HA offline');
      }
      reads++;
      if (pending && !stuck) {
        if (--pending.lag <= 0) {
          if (device === 'fan') {
            live[entities.climate].attributes.fan_mode = pending.on ? 'on' : 'off';
          } else {
            live[entities[device]].state = pending.on ? 'on' : 'off';
          }
          pending = null;
        }
      }
      return structuredClone(live);
    },
    service: async (domain, service) => {
      calls.push([domain, service]);
      pending = { on: service === 'set_fan_timer' || service === 'turn_on', lag: 3 };
    },
  };
  const app = createApp(config, env, { now, ha, ...quick });
  app.setSnapshot(structuredClone(snapshot));
  const on = await app.perform(`device:${device}:on`);
  assert.equal(on.devices.find((x) => x.id === device).on, true);
  assert.ok(reads >= 4, device + ' waits for the entity, not just the service/timer');
  await app.perform(`device:${device}:on`);
  assert.equal(calls.length, 1, 'duplicate on is idempotent');
  await app.perform(`device:${device}:off`);
  assert.equal(app.data().devices.find((x) => x.id === device).on, false);
  // The app's cached off state must not hide a later external on state.
  if (device === 'fan') {
    live[entities.climate].attributes.fan_mode = 'on';
  } else {
    live[entities[device]].state = 'on';
  }
  await app.perform(`device:${device}:off`);
  assert.equal(calls.length, 3, 'read current HA state before deciding to skip');
  stuck = true;
  await assert.rejects(app.perform(`device:${device}:on`), (x) => x.status === 503, 'ignored writes never succeed');
  assert.equal(app.data().devices.find((x) => x.id === device).on, false);
  offline = true;
  await assert.rejects(
    app.perform(`device:${device}:off`),
    (x) => x.status === 503,
    'cached matching states cannot confirm offline writes',
  );
  assert.ok(app.data().devices.every((x) => !x.available));
  assert.equal(app.data().ac.available, false);
}
// A newer, opposing write supersedes the pending one: the last request decides, never the slowest reply.
{
  const live = structuredClone(snapshot.states);
  const light = config.entities.desk_light;
  let entered;
  let release;
  const serviceEntered = new Promise((r) => (entered = r));
  const continueService = new Promise((r) => (release = r));
  const app = createApp(config, env, {
    now,
    settleMs: 1,
    ha: {
      states: async () => structuredClone(live),
      service: async (domain, service) => {
        if (service === 'turn_on') {
          entered();
          await continueService;
        }
        live[light].state = service === 'turn_on' ? 'on' : 'off';
      },
    },
  });
  app.setSnapshot(structuredClone(snapshot));
  const first = app.perform('device:desk_light:on');
  await serviceEntered;
  const second = app.perform('device:desk_light:off');
  release();
  await assert.rejects(first, (x) => x.status === 409 && /取代/.test(x.message));
  assert.equal((await second).devices.find((x) => x.id === 'desk_light').on, false);
}
// A timed-out on may have reached the device even when HA still says off.
{
  const live = structuredClone(snapshot.states);
  const light = config.entities.desk_light;
  let calls = 0;
  const app = createApp(config, env, {
    now,
    ...quick,
    ha: {
      states: async () => structuredClone(live),
      service: async () => {
        if (++calls === 2) {
          live[light].last_updated = '2026-11-06T21:40:02Z';
        }
      },
    },
  });
  app.setSnapshot(structuredClone(snapshot));
  await assert.rejects(app.perform('device:desk_light:on'), (x) => x.status === 503);
  await app.perform('device:desk_light:off');
  assert.equal(calls, 2, 'corrective off is sent instead of skipped against an uncertain cached off');
}
{
  const live = structuredClone(snapshot.states);
  const entities = config.entities;
  live[entities.climate].attributes.fan_mode = 'off';
  const app = createApp(config, env, {
    now,
    ...quick,
    ha: {
      states: async () => structuredClone(live),
      service: async () => {
        live[entities.climate].state = 'unavailable';
        delete live[entities.climate].attributes.fan_mode;
      },
    },
  });
  app.setSnapshot(structuredClone(snapshot));
  await assert.rejects(app.perform('device:fan:on'), (x) => x.status === 503);
  assert.equal(
    app.data().devices.find((x) => x.id === 'fan').available,
    false,
    'lost fan telemetry cannot fall back to the accepted command',
  );
}
console.log(
  'All remote controls: lag, ignored writes, external changes, offline state, and superseding requests checked.',
);
