import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { buildView, localDay, planAction, reading, celsius } from './core.mjs';
import { HomeAssistant } from './sources/ha.mjs';
import { Assistant } from './assistant/index.mjs';
import { agendaDays, calendarRange, assistantAgenda } from './sources/agenda.mjs';
import { clock } from './metrics.mjs';
import { readLines } from './assistant/text.mjs';
import { newsletterCandidate } from './sources/newsletter.mjs';
import { gzipSync } from 'node:zlib';

const chatAssets = new Map();
async function chatAsset(res, req, file, type) {
  if (!chatAssets.has(file)) {
    const body = await readFile(new URL(file, import.meta.url));
    chatAssets.set(file, { body, compressed: gzipSync(body) });
  }
  const asset = chatAssets.get(file);
  const compressed = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    Vary: 'Accept-Encoding',
    ...(compressed ? { 'Content-Encoding': 'gzip' } : {}),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'",
  });
  res.end(compressed ? asset.compressed : asset.body);
}

// The display draws the page and handles every tap itself. This service only summarises Home Assistant
// as one JSON document (GET /data) and forwards the writes the panel offers (POST /action).
const AGENDA_DAYS = 43; // today .. six weeks ahead, enough for the month the panel can show without a fetch.
const DEVICES = [
  ['bedroom_light', '卧室落地灯'],
  ['desk_light', '屏幕挂灯'],
  ['fan', '风扇'],
];
// One write = send + read back until HA reports the target, all inside one budget. After that the
// request is "unconfirmed" (it may still have reached the device) and is re-checked in the background.
const ASSISTANT_BUDGET_MS = 390000;
const ACTION_BUDGET_MS = 10000;
const RECONCILE_MS = 120000;
const RECHECK_MS = 5000;
const REQUEST_MEMORY_MS = 120000;
// The Nest (Google SDM cloud) reports fan "on" 30-50 s after the command (observed 32 s and 48 s; "off" in ~1 s),
// so the fan gets a longer budget; until then it is "waiting", never mistaken for done by the timer alone.
const FAN_BUDGET_MS = 60000;
const FAN_RUN = '00:15:00';
const FAN_RUN_MS = 15 * 60000;

export function authorized(header, token) {
  if (typeof header !== 'string') {
    return false;
  }
  const providedHeader = Buffer.from(header);
  const expectedHeader = Buffer.from('Bearer ' + token);
  return providedHeader.length === expectedHeader.length && timingSafeEqual(providedHeader, expectedHeader);
}
function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) {
    return null;
  }
  return Number(value);
}
function mean(...values) {
  const validValues = values
    .map((value) => {
      if (typeof value === 'string' && !value.trim()) {
        return null;
      }
      return finiteNumber(value);
    })
    .filter((value) => value !== null);
  if (!validValues.length) {
    return null;
  }
  const total = validValues.reduce((sum, value) => sum + value, 0);
  return Number((total / validValues.length).toFixed(1));
}

export function createApp(config, env, options = {}) {
  function entityList(key, domain) {
    const values = config[key] ?? [];
    if (
      !Array.isArray(values) ||
      values.length > 8 ||
      values.some((id) => typeof id !== 'string' || !new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(id))
    ) {
      throw new Error(`Invalid ${key}: use up to eight ${domain} entity IDs`);
    }
    return [...new Set(values)];
  }
  config.calendars = entityList('calendars', 'calendar');
  const extraEntities = config.assistant_entities ?? [];
  if (
    !Array.isArray(extraEntities) ||
    extraEntities.length > 24 ||
    extraEntities.some((id) => typeof id !== 'string' || !/^[a-z_]+\.[a-z0-9_]+$/.test(id))
  ) {
    throw new Error('Invalid assistant entities');
  }
  const presenceEntities = config.assistant_presence_entities ?? [];
  if (
    !Array.isArray(presenceEntities) ||
    presenceEntities.length > 8 ||
    presenceEntities.some(
      (id) => typeof id !== 'string' || !/^(?:person|device_tracker|binary_sensor)\.[a-z0-9_]+$/.test(id),
    )
  ) {
    throw new Error('Invalid assistant presence entities');
  }
  const ha = options.ha || new HomeAssistant(config.ha_url, env.HA_TOKEN);
  const now = options.now || (() => new Date());
  let snapshot = { states: {}, forecast: [], online: false, updated: null, forecastStale: true };
  const agenda = { data: { status: 'loading', events: [] }, next: 0, busy: false, from: null };
  let fanUntil = 0; // end of the Nest fan timer this server started; only shown as minutes left, lost on restart
  const uncertain = new Set(); // a timed-out write may still have reached the device
  const requests = new Map();
  const chains = new Map();
  const boot = randomBytes(4).toString('hex');
  const budget = options.actionBudgetMs ?? ACTION_BUDGET_MS;
  const fanBudget = options.fanBudgetMs ?? FAN_BUDGET_MS;
  const recheck = options.recheckMs ?? RECHECK_MS;
  const reconcileFor = options.reconcileMs ?? RECONCILE_MS;
  const clockMs = () => Date.now();
  let refreshing = null;
  let stateReading = null;
  let stateStarted = 0;
  let statesAt = 0;
  let statesSource = '';
  let lastForecast = 0;
  let lastHistory = 0;
  let lastLocation = 0;
  let actionSeq = 0;
  let rewrite = options.rewrite || null;
  let assistant = options.assistant || null;

  /** A read that started after `after`: confirmation must never reuse a read begun before the command. */
  async function statesSince(after) {
    await refreshStates();
    if (stateStarted < after) {
      await refreshStates();
    }
  }
  /** maxAge lets the panel's 1 s read-backs reuse a read the action worker just made. */
  async function refreshStates(maxAge = 0) {
    if (stateReading) {
      return stateReading;
    }
    const ids = [
      ...new Set([
        ...Object.values(config.entities)
          .filter(Boolean)
          .map((x) => x.split('#')[0]),
        ...(config.assistant_entities || []),
        ...(config.assistant_presence_entities || []),
      ]),
    ];
    const source = JSON.stringify(ids);
    if (maxAge && clockMs() - statesAt < maxAge && source === statesSource) {
      return;
    }
    stateStarted = clockMs();
    stateReading = (async () => {
      try {
        const states = await ha.states(ids);
        snapshot = { ...snapshot, states, online: true, updated: now().toISOString() };
        statesAt = clockMs();
        statesSource = source;
      } catch {
        snapshot = { ...snapshot, online: false };
      }
    })();
    try {
      await stateReading;
    } finally {
      stateReading = null;
    }
  }
  async function refresh() {
    if (refreshing) {
      return refreshing;
    }
    refreshing = (async () => {
      try {
        await refreshStates(1000);
        if (!snapshot.online) {
          return;
        }
        const states = snapshot.states;
        const weather = config.entities.weather;
        const at = now().getTime();
        const extra = [];
        if (weather && at - lastForecast >= 900000) {
          lastForecast = at;
          extra.push(
            ha.forecast(weather).then(
              (forecast) => {
                snapshot = {
                  ...snapshot,
                  forecast,
                  forecastUnit: states[weather]?.attributes?.temperature_unit,
                  windUnit: states[weather]?.attributes?.wind_speed_unit,
                  forecastStale: false,
                };
              },
              () => {
                snapshot = { ...snapshot, forecastStale: true };
                lastForecast = at - 840000;
              },
            ),
          );
          const dailyType = Number(states[weather]?.attributes?.supported_features) & 1 ? 'daily' : 'twice_daily';
          extra.push(
            ha.forecast(weather, dailyType).then(
              (dailyForecast) => {
                snapshot = { ...snapshot, dailyForecast };
              },
              () => {},
            ),
          );
        }
        if (ha.location && at - lastLocation >= 86400000) {
          lastLocation = at;
          extra.push(
            ha.location().then(
              (location) => {
                snapshot = { ...snapshot, location };
              },
              () => {
                lastLocation = at - 85500000;
              },
            ),
          );
        }
        if (config.entities.co2 && ha.history && at - lastHistory >= 900000) {
          lastHistory = at;
          const end = new Date(at);
          const start = new Date(at - 86400000);
          extra.push(
            ha.history(config.entities.co2.split('#')[0], start.toISOString(), end.toISOString()).then(
              (co2History) => {
                snapshot = { ...snapshot, co2History, historyStale: false, historyUpdated: end.toISOString() };
              },
              () => {
                snapshot = { ...snapshot, historyStale: true };
                lastHistory = at - 840000;
              },
            ),
          );
        }
        await Promise.all(extra);
      } catch {
        snapshot = { ...snapshot, online: false };
      }
    })();
    try {
      await refreshing;
    } finally {
      refreshing = null;
    }
  }
  function poll(entry, field, read, force = false) {
    const at = now().getTime();
    if (entry.busy) {
      return entry.pending;
    }
    if (!force && at < entry.next) {
      return;
    }
    entry.busy = true;
    entry.pending = (async () => {
      try {
        entry.data = { status: 'ok', [field]: (await read()).flat() };
        entry.next = now().getTime() + 900000;
      } catch {
        entry.data = { ...entry.data, status: ['ok', 'stale'].includes(entry.data.status) ? 'stale' : 'unavailable' };
        entry.next = now().getTime() + 60000;
      } finally {
        entry.busy = false;
      }
    })();
    return entry.pending;
  }
  async function ready(force = false) {
    await agenda.pending;
    const today = localDay(now(), config.timezone);
    if (config.calendars.length) {
      const source = today + ':' + config.calendars.join(',');
      if (agenda.from !== source) {
        agenda.from = source;
        agenda.data = { status: 'loading', events: [] };
        agenda.next = 0;
      }
      poll(
        agenda,
        'events',
        () => {
          const { start, end } = calendarRange(today, AGENDA_DAYS);
          return Promise.all(config.calendars.map((id) => ha.calendarEvents(id, start, end)));
        },
        force,
      );
    }
    await agenda.pending;
  }

  /** The panel's whole data set: no layout, no calendar maths (the display computes those offline). */
  function data(time = now()) {
    const at = time.getTime();
    const today = localDay(time, config.timezone);
    const view = buildView(config, snapshot, time);
    const states = snapshot.states;
    const entities = config.entities;
    const climate = states[entities.climate]?.attributes || {};
    const climateUnit = climate.temperature_unit || config.temperature_unit;
    const light = (id) => {
      const state = states[entities[id]]?.state;
      return { on: state === 'on', available: snapshot.online && (state === 'on' || state === 'off') };
    };
    // The fan is the Nest's own fan, run by its built-in timer; without a reported fan_mode the button reads 不可用.
    const fan = { on: fanOn(), available: snapshot.online && fanKnown() };
    const fanLeft = Math.ceil((fanUntil - at) / 60000);
    const history = view.co2History || [];
    return {
      dataTime: Date.parse(snapshot.updated) || 0,
      online: snapshot.online,
      timezone: config.timezone,
      weekStart: config.week_start ?? 1,
      city: view.city || '',
      weather: {
        temp: view.outside,
        humidity: finiteNumber(view.outdoorHumidity),
        condition: view.condition,
        aqi: view.aqi,
        sunrise: view.sunrise,
        sunset: view.sunset,
        tomorrow: view.tomorrow,
        hourly: view.forecast.map((x) => ({
          time: x.time,
          condition: x.condition,
          temp: finiteNumber(x.temperature),
          pop: finiteNumber(x.precipitation_probability),
          wind: x.wind,
          bearing: x.bearing,
        })),
      },
      indoor: {
        living: { temp: view.living, humidity: finiteNumber(view.livingHumidity) },
        bedroom: { temp: view.bedroom, humidity: finiteNumber(view.bedroomHumidity) },
        co2: view.co2,
        co2History: history.map((p) => p.value),
        co2End: history.at(-1)?.at ?? at,
        pm25: view.pm25,
        pm10: view.pm10,
        pm1: view.pm1,
        hcho: view.hcho,
        tvoc: view.tvoc,
      },
      schedule: {
        status: config.calendars.length ? agenda.data.status : 'unconfigured',
        until: new Date(Date.parse(today) + (AGENDA_DAYS - 1) * 86400000).toISOString().slice(0, 10),
        items:
          config.calendars.length && ['ok', 'stale'].includes(agenda.data.status)
            ? agendaDays(config, { agenda: agenda.data }, today, AGENDA_DAYS)
            : [],
      },
      ac: {
        available: snapshot.online && view.mode !== null,
        mode: view.mode,
        modes: view.modes,
        action: view.action,
        target: view.setpoint,
        low: view.targetLow,
        high: view.targetHigh,
        min: celsius(climate.min_temp ?? (climateUnit === '°F' ? 41 : 5), climateUnit),
        max: celsius(climate.max_temp ?? (climateUnit === '°F' ? 89.6 : 32), climateUnit),
        gap: 2,
      },
      devices: DEVICES.map(([id, name]) => ({
        id,
        name,
        ...(id === 'fan' ? fan : light(id)),
        ...(id === 'fan' && fan.on && fanLeft > 0 ? { minutes: Math.min(15, fanLeft) } : {}),
      })),
      assistant: { lines: assistant ? assistant.writer.panelLines(view.hint, time) : view.hint, image: imageVersion() },
      // Write progress for the panel: it shows waiting/unconfirmed marks from this, never from its own guesses.
      server: boot,
      actionSeq,
      requests: [...requests.values()]
        .filter((r) => !r.settled || clockMs() - r.settled < REQUEST_MEMORY_MS)
        .map((r) => ({ id: r.id, key: r.key, status: r.status, ...(r.error ? { error: r.error } : {}) })),
    };
  }
  /** The hint icon's version: HA's image entity state changes whenever its picture does. */
  function imageVersion() {
    const id = config.entities.assistant_image;
    const state = snapshot.states[id];
    if (!id || !state || ['unknown', 'unavailable'].includes(state.state)) {
      return null;
    }
    return createHash('sha256')
      .update(id + '\n' + state.state + '\n' + (state.attributes?.entity_picture || ''))
      .digest('hex')
      .slice(0, 16);
  }
  function etag(body) {
    const { dataTime, ...visible } = body;
    return '"' + createHash('sha256').update(JSON.stringify(visible)).digest('hex').slice(0, 32) + '"';
  }
  function reply(res, status, body, extra = {}) {
    if (res.destroyed) {
      return;
    }
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(text),
      ...extra,
    });
    res.end(text);
  }
  function dataReply(res, req, body = data()) {
    const tag = etag(body);
    const headers = { ETag: tag, 'X-Data-Time': String(body.dataTime) };
    if (req.method === 'GET' && req.headers['if-none-match'] === tag) {
      res.writeHead(304, headers);
      return res.end();
    }
    reply(res, 200, body, headers);
  }
  async function readBody(req, limit = 2048) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) {
        throw fail(413, '请求内容过长。');
      }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  }

  const fail = (status, message) => Object.assign(new Error(message), { status });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Background re-checks must not keep a finished process alive (the HTTP server does that in production).
  const idle = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());
  async function withinBudget(promise, until) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timer = setTimeout(resolve, Math.max(0, until - clockMs()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function parse(action) {
    if (typeof action !== 'string' || action.length > 80) {
      throw fail(400, 'invalid action');
    }
    if (action === 'assistant') {
      if (!rewrite) {
        throw fail(409, '提示未配置');
      }
      return { key: 'assistant' };
    }
    const device = /^device:(bedroom_light|desk_light|fan):(on|off)$/.exec(action);
    if (
      !device &&
      !/^(mode:(heat|cool|heat_cool|off)|temp_(up|down)|temp:(?:(?:heat|cool):)?\d+(?:\.\d+)?|range_(low|high)_(up|down)|range:\d+(?:\.\d+)?:\d+(?:\.\d+)?)$/.test(
        action,
      )
    ) {
      throw fail(400, 'unknown action');
    }
    return { device, key: device ? 'device:' + device[1] : 'climate' };
  }
  function settle(request, status, error) {
    request.status = status;
    request.settled = clockMs();
    if (error) {
      request.error = error;
    } else {
      delete request.error;
    }
  }
  function prune() {
    for (const [id, r] of requests) {
      if (r.settled && clockMs() - r.settled > 5 * REQUEST_MEMORY_MS) {
        requests.delete(id);
      }
    }
    while (requests.size > 64) {
      requests.delete(requests.keys().next().value);
    }
  }
  /**
   * Registers a write and starts it in the background. Writes to different devices run side by side;
   * a newer write to the same device supersedes the older one, which stops waiting.
   * Returns the request record at once and `done`, which settles when the write is confirmed or not.
   */
  function submit(action, id = randomBytes(8).toString('hex')) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
      throw fail(400, 'invalid request id');
    }
    const existing = requests.get(id);
    // A retried POST never writes twice.
    if (existing) {
      return { request: existing, done: existing.done };
    }
    const parsed = parse(action);
    for (const other of requests.values()) {
      if (other.key === parsed.key && ['pending', 'unconfirmed'].includes(other.status)) {
        settle(other, 'superseded');
      }
    }
    actionSeq++;
    const request = { id, key: parsed.key, action, seq: actionSeq, status: 'pending', accepted: clockMs() };
    request.budget = budget;
    if (parsed.key === 'device:fan') {
      request.budget = fanBudget;
    } else if (parsed.key === 'assistant') {
      request.budget = ASSISTANT_BUDGET_MS;
    }
    request.deadline = request.accepted + request.budget;
    requests.set(id, request);
    prune();
    const run = (chains.get(parsed.key) || Promise.resolve()).then(() => execute(request, parsed));
    chains.set(
      parsed.key,
      run.catch(() => {}),
    );
    request.done = run;
    run.catch(() => {}); // HTTP callers read the outcome from /data; tests await `done`
    return { request, done: run };
  }
  /** Sends one write and reads HA back until it reports the target, within the request's single budget. */
  async function execute(request, { device, key }) {
    if (request.status === 'superseded') {
      throw fail(409, '已被新的操作取代');
    }
    if (key === 'assistant') {
      // A late reply still lands in HA and shows on the next /data; only the 更新中 mark stops here.
      const ok = await withinBudget(rewrite(), request.deadline);
      await refreshStates().catch(() => {});
      if (ok) {
        settle(request, 'confirmed');
        return data();
      }
      settle(request, 'failed', '提示未更新');
      throw fail(503, '提示未更新');
    }
    try {
      const plan = await prepare(request, device);
      if (!plan) {
        settle(request, 'confirmed');
        return data();
      }
      const { key, confirmed, send, read, message } = plan;
      // Only reads made after send() returns count, so a target HA already showed is re-confirmed after the
      // re-send; an earlier unconfirmed (possibly opposite) write cannot be mistaken for this one's result.
      const wasUncertain = uncertain.has(key);
      let sent = clockMs(); // a timed-out send still counts from now: later reads may see its effect
      uncertain.add(key);
      try {
        await withinBudget(send(), request.deadline);
        sent = clockMs();
      } catch (error) {
        if (/^HA HTTP 4\d\d$/.test(error.message)) {
          // An earlier unconfirmed write may still land.
          if (!wasUncertain) {
            uncertain.delete(key);
          }
          settle(request, 'failed', '设备拒绝了该操作');
          throw fail(502, '设备拒绝了该操作');
        }
        // Anything else (timeout, dropped connection) may still have reached the device: keep checking.
      }
      while (request.status === 'pending') {
        try {
          await read(sent);
        } catch {}
        // Long waits (the fan) are polled gently: every 2 s after the first 10 s.
        if (request.status !== 'pending') {
          break;
        }
        if (confirmed()) {
          uncertain.delete(key);
          settle(request, 'confirmed');
          return data();
        }
        if (clockMs() >= request.deadline) {
          break;
        }
        const step =
          clockMs() - request.accepted > ACTION_BUDGET_MS ? 4 * (options.settleMs ?? 500) : (options.settleMs ?? 500);
        await sleep(Math.min(step, Math.max(0, request.deadline - clockMs())));
      }
      if (request.status === 'superseded') {
        throw fail(409, '已被新的操作取代');
      }
      settle(request, 'unconfirmed', message);
      void reconcile(request, confirmed, () => read(sent), key);
      throw fail(503, message);
    } catch (error) {
      if (request.status === 'pending') {
        settle(request, 'failed', error.message || '操作未确认');
      }
      throw error;
    }
  }
  /** An unconfirmed write is re-checked every few seconds; it becomes confirmed or, at the end, failed. */
  async function reconcile(request, confirmed, read, key) {
    while (request.status === 'unconfirmed' && clockMs() < request.accepted + reconcileFor) {
      await idle(recheck);
      if (request.status !== 'unconfirmed') {
        return;
      }
      try {
        await read();
      } catch {}
      if (confirmed()) {
        uncertain.delete(key);
        settle(request, 'confirmed');
        return;
      }
    }
    if (request.status === 'unconfirmed') {
      settle(request, 'failed', '设备未执行或未回报');
    }
  }
  /** Validates against fresh HA state and returns how to send and confirm the write, or null if already there. */
  async function prepare(request, device) {
    await refreshStates();
    if (!snapshot.online) {
      throw fail(503, 'HA 暂不可用');
    }
    if (device) {
      return deviceWrite(device[1], device[2] === 'on');
    }
    let commands;
    try {
      commands = planAction(request.action, config, snapshot);
    } catch (error) {
      throw fail(409, error.message);
    }
    const climateMode = snapshot.states[config.entities.climate]?.state;
    const confirmed = () => {
      if (!snapshot.online) {
        return false;
      }
      return commands.every(([, , payload]) => {
        const state = snapshot.states[payload.entity_id];
        if (!state || state.state !== (payload.hvac_mode ?? climateMode)) {
          return false;
        }
        return Object.entries(payload).every(([key, value]) => {
          if (key === 'entity_id') {
            return true;
          }
          if (key === 'hvac_mode') {
            return state.state === value;
          }
          return state.attributes?.[key] != null && Math.abs(Number(state.attributes[key]) - value) < 0.05;
        });
      });
    };
    if (confirmed() && !uncertain.has('climate')) {
      return null;
    }
    return {
      key: 'climate',
      confirmed,
      message: '空调操作未确认',
      read: (since) => statesSince(since),
      send: async () => {
        for (const [domain, service, payload] of commands) {
          await ha.service(domain, service, payload);
        }
      },
    };
  }
  function fanMode() {
    return snapshot.states[config.entities.climate]?.attributes?.fan_mode;
  }
  function fanKnown() {
    const state = snapshot.states[config.entities.climate]?.state;
    return Boolean(state) && !['unknown', 'unavailable'].includes(state) && ['on', 'off', 'auto'].includes(fanMode());
  }
  /** The fan is on only when the Nest reports fan_mode "on". */
  function fanOn() {
    return fanKnown() && fanMode() === 'on';
  }
  /** Drives a device to the requested state (no blind toggles); confirmation needs HA's own report. */
  function deviceWrite(id, on) {
    const entities = config.entities;
    const usable = (entity) =>
      snapshot.states[entity] && !['unknown', 'unavailable'].includes(snapshot.states[entity].state);
    const key = 'device:' + id;
    const confirmed = () => {
      if (!snapshot.online) {
        return false;
      }
      if (id === 'fan') {
        return fanKnown() && fanOn() === on;
      }
      return usable(entities[id]) && snapshot.states[entities[id]].state === (on ? 'on' : 'off');
    };
    let send;
    if (id === 'fan') {
      if (!fanKnown()) {
        throw fail(409, '风机状态不可用');
      }
      // The Nest's own 15-minute timer stops the fan, so a restarted HA or a lost off command cannot leave it
      // running for the 12 hours a plain set_fan_mode asks for.
      if (on) {
        send = async () => {
          await ha.service('nest', 'set_fan_timer', { entity_id: entities.climate, duration: FAN_RUN });
          fanUntil = now().getTime() + FAN_RUN_MS;
        };
      } else {
        send = async () => {
          await ha.service('climate', 'set_fan_mode', { entity_id: entities.climate, fan_mode: 'off' });
          fanUntil = 0;
        };
      }
    } else {
      const entity = entities[id];
      const domain = entity?.split('.')[0];
      if (!usable(entity) || !['light', 'switch'].includes(domain)) {
        throw fail(409, '设备不可用');
      }
      if (!['on', 'off'].includes(snapshot.states[entity].state)) {
        throw fail(409, '设备状态不可用');
      }
      send = () => ha.service(domain, on ? 'turn_on' : 'turn_off', { entity_id: entity });
    }
    if (confirmed() && !uncertain.has(key)) {
      return null;
    }
    let message = '设备操作未确认';
    if (id === 'fan') {
      message = on ? '风机未回报开启状态' : '风机未回报关闭状态';
    }
    return {
      key,
      confirmed,
      send,
      read: (since) => statesSince(since),
      message,
    };
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://display.invalid');
      if (url.pathname === '/' && req.method === 'GET') {
        return await chatAsset(res, req, './chat.html', 'text/html; charset=utf-8');
      }
      if (url.pathname === '/assets/markdown.js' && req.method === 'GET') {
        return await chatAsset(res, req, './vendor/streaming-markdown.mjs', 'text/javascript; charset=utf-8');
      }
      const chatRequest =
        (url.pathname === '/assistant/chat' && req.method === 'DELETE') ||
        {
          '/assistant/state': 'GET',
          '/assistant/chat': 'POST',
          '/assistant/memory': 'PUT',
          '/assistant/settings': 'PUT',
          '/assistant/panel': 'POST',
        }[url.pathname] === req.method;
      if (!chatRequest && !authorized(req.headers.authorization, env.DISPLAY_TOKEN)) {
        return reply(res, 401, { error: 'unauthorized' });
      }
      if (url.pathname.startsWith('/assistant/')) {
        if (req.headers.origin) {
          let origin;
          try {
            origin = new URL(req.headers.origin);
          } catch {}
          if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== req.headers.host) {
            return reply(res, 403, { error: 'origin rejected' });
          }
        }
        if (!assistant) {
          return reply(res, 503, { error: '助理尚未启动。' });
        }
        return await assistant.handle(req, res, url.pathname, readBody, reply);
      }
      if (req.headers.origin) {
        return reply(res, 403, { error: 'origin rejected' });
      } // no browser clients
      if (url.pathname === '/health' && req.method === 'GET') {
        return reply(res, 200, { ha: snapshot.online, version: 2 });
      }
      if (url.pathname === '/data' && req.method === 'GET') {
        await refresh();
        await ready();
        return dataReply(res, req);
      }
      if (url.pathname === '/image' && req.method === 'GET') {
        // The hint icon, proxied from HA's image entity as is; the display decodes, crops and greys it.
        await refreshStates(1000);
        if (!imageVersion()) {
          return reply(res, 404, { error: 'no image' });
        }
        let image;
        try {
          image = await ha.image(config.entities.assistant_image);
        } catch {
          return reply(res, 502, { error: 'image unavailable' });
        }
        if (res.destroyed) {
          return;
        }
        res.writeHead(200, {
          'Content-Type': image.type,
          'Content-Length': image.body.length,
          'Cache-Control': 'no-store',
        });
        return res.end(image.body);
      }
      if (url.pathname === '/action' && req.method === 'POST') {
        // Accepted at once; the panel follows progress through /data's `requests` instead of a long-held reply.
        const { action, id } = await readBody(req);
        let request;
        try {
          ({ request } = submit(action, id));
        } catch (error) {
          return reply(res, error.status || 400, { error: error.message });
        }
        return reply(res, 202, {
          id: request.id,
          seq: request.seq,
          status: request.status,
          server: boot,
          budgetMs: request.budget,
        });
      }
      reply(res, 404, { error: 'not found' });
    } catch (cause) {
      if (!res.headersSent) {
        reply(res, cause.status || 400, { error: cause.status ? cause.message : 'invalid request' });
      }
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 10000;

  /** Facts for the hint writer: what the panel shows today, plus HA-provided transit context. */
  async function assistantContext(time = now(), { forceAgenda = false } = {}) {
    await refresh();
    await ready(forceAgenda);
    const day = localDay(time, config.timezone);
    const view = buildView(config, snapshot, time);
    const agendaContext = assistantAgenda(config, config.calendars.length ? agenda.data : snapshot.agenda, time);
    const deviceIds = [
      ...new Set(
        ['humidifier', 'bedroom_light', 'desk_light', 'climate']
          .map((key) => config.entities[key])
          .filter(Boolean)
          .concat(config.assistant_entities || []),
      ),
    ];
    const attributes = [
      'friendly_name',
      'unit_of_measurement',
      'temperature_unit',
      'humidity',
      'target_humidity',
      'current_humidity',
      'temperature',
      'current_temperature',
      'brightness',
      'color_temp_kelvin',
      'hvac_action',
      'fan_mode',
      'mode',
    ];
    const devices = deviceIds.map((id) => {
      const state = snapshot.states[id];
      const changed = Date.parse(state?.last_changed);
      return {
        entity_id: id,
        available: snapshot.online && Boolean(state) && !['unknown', 'unavailable'].includes(state.state),
        state: state?.state ?? null,
        last_changed: state?.last_changed ?? null,
        last_updated: state?.last_updated ?? null,
        recorded_state_minutes:
          Number.isFinite(changed) && changed <= time.getTime() ? Math.floor((time.getTime() - changed) / 60000) : null,
        attributes: Object.fromEntries(
          attributes
            .filter((key) => ['string', 'number', 'boolean'].includes(typeof state?.attributes?.[key]))
            .map((key) => [
              key,
              typeof state.attributes[key] === 'string' ? state.attributes[key].slice(0, 160) : state.attributes[key],
            ]),
        ),
      };
    });
    const presence = (config.assistant_presence_entities || []).map((id) => {
      const state = snapshot.states[id];
      const changed = Date.parse(state?.last_updated || state?.last_changed);
      return {
        entity_id: id,
        state: state?.state ?? 'unknown',
        available: snapshot.online && Boolean(state) && !['unknown', 'unavailable'].includes(state.state),
        observed_at: snapshot.updated,
        last_changed: state?.last_changed ?? null,
        last_updated: state?.last_updated ?? null,
        age_minutes: Number.isFinite(changed) && changed <= +time ? Math.floor((+time - changed) / 60000) : null,
        source: typeof state?.attributes?.source === 'string' ? state.attributes.source.slice(0, 160) : null,
        note: '仅为在家状态的辅助线索；未知或离线时不能判断人在家或离家。',
      };
    });
    const previous = readLines(snapshot.states[config.entities.assistant_text]?.state);
    const alert = reading(snapshot.states, config.entities.weather_alert);
    return {
      _offline: !snapshot.online,
      now: day + ' ' + clock(time.getTime(), config.timezone) + ' 星期' + view.header.weekday,
      now_iso: time.toISOString(),
      timezone: config.timezone,
      observed_at: snapshot.updated,
      sources: {
        ha: snapshot.online ? 'ok' : 'offline',
        forecast: snapshot.forecastStale ? 'stale' : 'ok',
        calendar: agendaContext.schedule_status,
      },
      lunar: '农历' + view.header.lunar,
      calendar: { date: day, solar_term: view.header.term || null, festivals: view.header.events },
      terms: view.upcoming.map((x) => ({
        name: x.name,
        date: new Date(Date.parse(day) + x.days * 86400000).toISOString().slice(0, 10),
        in_days: x.days,
      })),
      weather: {
        city: view.city,
        now: {
          temp: view.outside,
          humidity: view.outdoorHumidity,
          text: view.condition,
          aqi: view.aqi,
          aqi_level: view.grades.aqi.label,
        },
        hourly: view.forecast.map((x) => ({
          time: x.time,
          datetime: x.datetime,
          temp: x.temperature,
          text: x.condition,
          pop: x.precipitation_probability,
          wind: x.wind,
        })),
        sunset: view.sunset,
        tomorrow: view.tomorrow,
        ...(alert && !['unknown', 'unavailable', 'off', 'none', '无'].includes(alert) ? { alert } : {}),
      },
      ...agendaContext,
      devices,
      presence,
      newsletter: newsletterCandidate(snapshot.states[config.entities.newsletter], {
        now: time,
        timezone: config.timezone,
      }),
      indoor: {
        temperature: mean(view.living, view.bedroom),
        temperature_unit: '°C',
        humidity: mean(view.livingHumidity, view.bedroomHumidity),
        co2: view.co2,
        co2_level: view.grades.co2.label,
        pm25: view.pm25,
        hcho: view.hcho,
        tvoc: view.tvoc,
      },
      ac: { mode: view.mode, low: view.targetLow, high: view.targetHigh, target: view.setpoint, status: view.action },
      ...(previous.length
        ? {
            previous: {
              lines: previous,
              at:
                snapshot.states[config.entities.assistant_text]?.last_changed ||
                snapshot.states[config.entities.assistant_text]?.last_updated ||
                null,
            },
          }
        : {}),
    };
  }
  /** Awaitable write for scripts and tests: resolves with /data once confirmed, rejects otherwise. */
  const perform = (action, id) => submit(action, id).done;
  return {
    server,
    refresh,
    ready,
    data,
    perform,
    submit,
    assistantContext,
    ha,
    setSnapshot: (value) => {
      snapshot = value;
    },
    setRewrite: (fn) => {
      rewrite = fn;
    },
    setAssistant: (value) => {
      assistant = value;
    },
  };
}

export async function start(configPath, env) {
  if (!env.HA_TOKEN || !env.DISPLAY_TOKEN || env.DISPLAY_TOKEN.length < 24) {
    throw new Error('Set HA_TOKEN and DISPLAY_TOKEN (24+ characters)');
  }
  if (env.HA_TOKEN === env.DISPLAY_TOKEN) {
    throw new Error('HA_TOKEN and DISPLAY_TOKEN must be different');
  }
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  localDay(new Date(), config.timezone); // reject an invalid timezone at startup
  const app = createApp(config, env);
  await app.refresh();
  const assistant = new Assistant(config, env, app.ha, app.assistantContext);
  const writer = assistant.writer;
  await assistant.load();
  app.setAssistant(assistant);
  void assistant.warm();
  if (writer.enabled) {
    app.setRewrite(() => writer.refresh());
  }
  const interval = setInterval(() => {
    void app.refresh();
    void assistant.warm();
    if (writer.enabled) {
      void writer.tick();
    }
  }, 30000);
  app.server.on('close', () => clearInterval(interval));
  app.server.listen(config.port || 8080, config.bind || '127.0.0.1');
  return app;
}
