import assert from 'node:assert/strict';
import { agendaDays, assistantAgenda, calendarRange, calendarWindow } from '../../../ha-app/server/sources/agenda.mjs';
import { HomeAssistant } from '../../../ha-app/server/sources/ha.mjs';
import { createApp } from '../../../ha-app/server/app.mjs';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

const config = { timezone: 'America/Denver', calendars: ['calendar.example'] };
const now = new Date('2026-11-06T21:40:00Z');
const event = (summary, start, end) => ({ summary, start: { dateTime: start }, end: { dateTime: end } });
const snapshot = {
  agenda: {
    status: 'ok',
    events: [
      { summary: '全天', start: { date: '2026-11-06' }, end: { date: '2026-11-07' } },
      { summary: '昨天结束', start: { date: '2026-11-05' }, end: { date: '2026-11-06' } },
      { summary: '出差', start: { date: '2026-11-06' }, end: { date: '2026-11-09' } },
      event('清晨', '2026-11-06T08:00:00Z', '2026-11-06T09:00:00Z'),
      event('跨午夜', '2026-11-06T06:30:00Z', '2026-11-06T07:30:00Z'),
      event('午夜结束', '2026-11-06T06:00:00Z', '2026-11-06T07:00:00Z'),
      event('下午', '2026-11-06T22:00:00Z', '2026-11-06T23:00:00Z'),
      event('到零点', '2026-11-07T05:00:00Z', '2026-11-07T07:00:00Z'),
      event('通宵', '2026-11-07T04:00:00Z', '2026-11-07T08:00:00Z'),
      event('无时区拒绝', '2026-11-06T10:00:00', '2026-11-06T11:00:00'),
      { ...event('已取消', '2026-11-06T12:00:00Z', '2026-11-06T13:00:00Z'), status: 'cancelled' },
    ],
  },
};
assert.deepEqual(calendarWindow('2026-11-06'), { start: '2026-11-05T00:00:00.000Z', end: '2026-11-08T00:00:00.000Z' });
assert.throws(() => calendarWindow('2026-02-30'), /Invalid calendar day/);
assert.throws(() => calendarWindow('2026-11-06T00:00:00Z'));
assert.deepEqual(calendarRange('2026-11-06', 43), {
  start: '2026-11-05T00:00:00.000Z',
  end: '2026-12-20T00:00:00.000Z',
});
assert.throws(() => calendarRange('2026-11-06', 0));

// One item per covered day: start time and end on a single-day timed event, `until` on multi-day ones.
const days = agendaDays(config, snapshot, '2026-11-06', 2);
const on = (day) => days.filter((x) => x.date === day).map(({ date, ...x }) => x);
assert.deepEqual(on('2026-11-06'), [
  { time: '全天', title: '全天' },
  { time: '全天', until: '2026-11-08', title: '出差' },
  { time: '全天', until: '2026-11-06', title: '跨午夜' },
  { time: '01:00', end: '02:00', title: '清晨' },
  { time: '15:00', end: '16:00', title: '下午' },
  { time: '21:00', until: '2026-11-07', title: '通宵' },
  { time: '22:00', end: '24:00', title: '到零点' },
]);
assert.deepEqual(
  on('2026-11-07'),
  [
    { time: '全天', until: '2026-11-08', title: '出差' },
    { time: '全天', until: '2026-11-07', title: '通宵' },
  ],
  'later days of a multi-day event read 全天; the window ends after two days',
);
assert.equal(
  days.some(
    (x) => x.title === '昨天结束' || x.title === '午夜结束' || x.title === '已取消' || x.title === '无时区拒绝',
  ),
  false,
);
assert.deepEqual(agendaDays(config, { agenda: { status: 'unavailable' } }, '2026-11-06', 2), []);

// Date selection follows the display timezone, including extreme offsets and DST transitions.
for (const [timezone, day, start, end, time] of [
  ['Pacific/Kiritimati', '2026-11-06', '2026-11-05T10:00:00Z', '2026-11-05T11:00:00Z', '00:00'],
  ['America/Denver', '2026-03-08', '2026-03-08T09:00:00Z', '2026-03-08T10:00:00Z', '03:00'],
  ['America/Denver', '2026-11-01', '2026-11-01T08:30:00Z', '2026-11-01T09:30:00Z', '01:30'],
]) {
  assert.deepEqual(
    agendaDays({ ...config, timezone }, { agenda: { status: 'ok', events: [event('事件', start, end)] } }, day, 1).map(
      (x) => x.time,
    ),
    [time],
  );
}

// Absent, failed, and cached sources must not look like a successful empty list.
assert.equal(assistantAgenda({ ...config, calendars: [] }, undefined, now).schedule_status, 'unconfigured');
assert.equal(
  assistantAgenda({ ...config, calendars: [] }, snapshot.agenda, now).schedule_status,
  'ok',
  'explicit fixture snapshots remain usable',
);
assert.equal(assistantAgenda(config, undefined, now).schedule_status, 'loading');
assert.equal(assistantAgenda(config, { ...snapshot.agenda, status: 'stale' }, now).schedule_status, 'stale');

// The calendar cache never keeps notes; the image client only accepts a bounded picture.
const originalFetch = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return {
      ok: true,
      json: async () => [{ ...snapshot.agenda.events[0], description: 'private note', location: 'private place' }],
    };
  };
  const api = new HomeAssistant('http://ha.test', 'test-token');
  const window = calendarWindow('2026-11-06');
  const events = await api.calendarEvents('calendar.example', window.start, window.end);
  assert.equal(calls[0].url.pathname, '/api/calendars/calendar.example');
  assert.equal(calls[0].url.searchParams.get('start'), window.start);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(JSON.stringify(events).includes('private note'), false);
  assert.equal(events[0].location, 'private place'); // Schedule context includes location; notes remain excluded.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(api.calendarEvents('calendar.example', window.start, window.end), /Invalid calendar response/);
  const picture = (type, size) => async (url) => {
    calls.push({ url: new URL(url) });
    return {
      ok: true,
      headers: new Headers({ 'content-type': type }),
      arrayBuffer: async () => new Uint8Array(size).buffer,
    };
  };
  globalThis.fetch = picture('image/png; charset=binary', 10);
  assert.deepEqual(await api.image('image.hint'), { type: 'image/png', body: Buffer.alloc(10) });
  assert.equal(calls.at(-1).url.pathname, '/api/image_proxy/image.hint');
  globalThis.fetch = picture('text/html', 10);
  await assert.rejects(api.image('image.hint'), /Not an image/);
  globalThis.fetch = picture('image/jpeg', 2000001);
  await assert.rejects(api.image('image.hint'), /too large/);
} finally {
  globalThis.fetch = originalFetch;
}

// Real HTTP /data and /image against a fake HA.
const TOKEN = 'test-token-test-token-24';
function harness(entities = {}, display = {}) {
  const state = {
    online: true,
    forecast: [],
    states: {
      'image.hint': {
        state: '2026-11-06T20:00:00Z',
        attributes: { entity_picture: '/api/image_proxy/image.hint?token=a' },
      },
      'input_text.mono_calendar_assistant': { state: '第一行。\n第二行。\n第三行。' },
    },
  };
  const app = createApp(
    { ...config, ...display, entities },
    { DISPLAY_TOKEN: TOKEN },
    {
      now: () => now,
      ha: {
        states: async () => state.states,
        calendarEvents: async () => snapshot.agenda.events.slice(0, 1),
        image: async () => ({ type: 'image/png', body: Buffer.from('png-bytes') }),
      },
    },
  );
  app.setSnapshot(state);
  async function request(method, url, data, headers = {}) {
    const req = Readable.from(data ? [Buffer.from(JSON.stringify(data))] : []);
    Object.assign(req, { method, url, headers: { authorization: 'Bearer ' + TOKEN, ...headers } });
    const res = new EventEmitter();
    res.destroyed = false;
    const response = new Promise((resolve) => {
      res.writeHead = (code, headers = {}) => Object.assign(res, { code, headers });
      res.end = (body) => {
        let parsedBody = null;
        if (body) {
          parsedBody = body;
          if (/json/.test(res.headers['Content-Type'] || '')) {
            parsedBody = JSON.parse(body);
          }
        }
        resolve({ code: res.code, headers: res.headers, body: parsedBody });
      };
    });
    app.server.emit('request', req, res);
    return response;
  }
  return { app, request, state };
}
{
  // Only the hint writer receives room averages; the panel keeps each sensor's own reading.
  const entities = {
    living_temperature: 'sensor.living_temp',
    bedroom_temperature: 'sensor.bedroom_temp',
    living_humidity: 'sensor.living_humidity',
    bedroom_humidity: 'sensor.bedroom_humidity',
  };
  for (const { label, readings, average, panel } of [
    {
      label: 'both readings, mixed temperature units',
      readings: ['68', '23.5', '33.3', '45.6'],
      average: [21.8, 39.5],
      panel: [
        [20, 33.3],
        [23.5, 45.6],
      ],
    },
    {
      label: 'only bedroom readings',
      readings: ['unavailable', '23.5', 'unknown', '45.67'],
      average: [23.5, 45.7],
      panel: [
        [null, null],
        [23.5, 45.67],
      ],
    },
    {
      label: 'each metric uses its own available readings',
      readings: ['68', 'unknown', 'unavailable', '0'],
      average: [20, 0],
      panel: [
        [20, null],
        [null, 0],
      ],
    },
    {
      label: 'unavailable and invalid readings',
      readings: ['unknown', 'unavailable', 'NaN', 'Infinity'],
      average: [null, null],
      panel: [
        [null, null],
        [null, null],
      ],
    },
    {
      label: 'no configured states',
      readings: [],
      average: [null, null],
      panel: [
        [null, null],
        [null, null],
      ],
    },
  ]) {
    const h = harness(entities, { temperature_unit: '°F' });
    Object.values(entities).forEach((id, index) => {
      if (readings[index] !== undefined) {
        h.state.states[id] = { state: readings[index], attributes: index === 1 ? { unit_of_measurement: '°C' } : {} };
      }
    });
    const { indoor } = await h.app.assistantContext();
    assert.deepEqual([indoor.temperature, indoor.humidity], average, label);
    assert.equal(indoor.temperature_unit, '°C', 'Temperatures are converted before averaging');
    for (const key of ['rooms', 'living', 'bedroom']) {
      assert.equal(key in indoor, false, 'The model receives no separate room readings');
    }
    const data = (await h.request('GET', '/data')).body;
    assert.deepEqual(
      [data.indoor.living, data.indoor.bedroom],
      panel.map(([temp, humidity]) => ({ temp, humidity })),
      'The display still receives its individual sensor readings',
    );
    assert.equal('temperature' in data.indoor, false, 'The average is not added to the panel payload');
  }
}
{
  for (const city of ['Seattle', '杭州']) {
    const h = harness({}, { city });
    const context = await h.app.assistantContext();
    const data = (await h.request('GET', '/data')).body;
    assert.equal(context.weather.city, city, 'News context follows the configured display city');
    assert.equal(data.city, city, 'The model and panel use the same city');
    assert.equal(context.newsletter, null, 'No configured newsletter means no mail context');
  }
}
{
  const h = harness({ newsletter: 'sensor.nyt_newsletter' });
  h.state.states['sensor.nyt_newsletter'] = {
    state: 'received',
    attributes: {
      date: '2026-11-06T17:00:00Z',
      subject: 'Morning briefing for reader@example.test',
      sender: 'The New York Times <nytdirect@nytimes.com>',
      body: 'Public newsletter briefing: a new community exhibition opens today.\nContact reader@example.test.',
      body_html: '<p>PRIVATE_HTML_SENTINEL</p>',
      recipients: ['private-recipient@example.test'],
      headers: 'PRIVATE_HEADERS_SENTINEL',
    },
  };
  const context = await h.app.assistantContext();
  assert.ok(context.newsletter, 'Only the configured mail state supplies the cleaned newsletter candidate');
  assert.equal(context.newsletter.site, 'The New York Times');
  assert.match(context.newsletter.summary, /Public newsletter briefing/);
  const modelContext = JSON.stringify(context);
  for (const privateValue of [
    'reader@example.test',
    'nytdirect@nytimes.com',
    'private-recipient@example.test',
    'PRIVATE_HTML_SENTINEL',
    'PRIVATE_HEADERS_SENTINEL',
  ]) {
    assert.equal(modelContext.includes(privateValue), false, 'Mail metadata and addresses stay out of model context');
  }
  const data = (await h.request('GET', '/data')).body;
  assert.equal('newsletter' in data, false, 'The display payload does not expose the mail candidate');
  const panelPayload = JSON.stringify(data);
  for (const mailValue of [
    'Public newsletter briefing',
    'Morning briefing',
    'nyt-mail:',
    'example.test',
    'nytdirect',
    'PRIVATE_',
  ]) {
    assert.equal(
      panelPayload.includes(mailValue),
      false,
      'The display payload contains no newsletter body or metadata',
    );
  }
  h.state.states['sensor.nyt_newsletter'].attributes.date = '2026-11-05T17:00:00Z';
  assert.equal(
    (await h.app.assistantContext()).newsletter,
    null,
    'A stale mail state is excluded before model generation',
  );
}
{
  const { app } = harness();
  for (const [instant, calendar] of [
    ['2026-11-07T06:59:59Z', { date: '2026-11-06', solar_term: null, festivals: [] }],
    ['2026-11-07T07:00:00Z', { date: '2026-11-07', solar_term: '立冬', festivals: [] }],
    ['2026-02-17T19:00:00Z', { date: '2026-02-17', solar_term: null, festivals: ['春节'] }],
    ['2026-10-31T18:00:00Z', { date: '2026-10-31', solar_term: null, festivals: ['万圣夜'] }],
  ]) {
    const context = await app.assistantContext(new Date(instant));
    assert.deepEqual(context.calendar, calendar, 'Today’s terms/festivals follow the panel timezone');
    assert.ok(
      context.terms.every((x) => x.date > calendar.date && x.in_days > 0),
      'Today is separate from upcoming dates',
    );
  }
  const yearEnd = await app.assistantContext(new Date('2026-12-31T19:00:00Z'));
  assert.deepEqual(
    yearEnd.terms[0],
    { name: '元旦', date: '2027-01-01', in_days: 1 },
    'Upcoming dates include the new year',
  );
}
{
  const h = harness({ assistant_text: 'input_text.mono_calendar_assistant', assistant_image: 'image.hint' });
  assert.equal((await h.request('GET', '/data', null, { authorization: 'Bearer wrong' })).code, 401);
  const first = await h.request('GET', '/data');
  assert.equal(first.code, 200);
  assert.match(first.headers.ETag, /^"[a-f0-9]{32}"$/);
  assert.equal(first.headers['X-Data-Time'], String(first.body.dataTime));
  assert.equal('reminders' in first.body, false);
  assert.equal(first.body.schedule.status, 'ok');
  assert.deepEqual(first.body.schedule.items, [{ date: '2026-11-06', time: '全天', title: '全天' }]);
  assert.deepEqual(first.body.assistant.lines, ['第一行。', '第二行。', '第三行。']);
  assert.match(first.body.assistant.image, /^[a-f0-9]{16}$/);
  assert.equal(
    (await h.request('GET', '/data', null, { 'if-none-match': first.headers.ETag })).code,
    304,
    'unchanged data is not resent',
  );
  const image = await h.request('GET', '/image');
  assert.equal(image.code, 200);
  assert.equal(image.headers['Content-Type'], 'image/png');
  assert.equal(String(image.body), 'png-bytes');
  assert.equal((await h.request('GET', '/image', null, { authorization: 'Bearer wrong' })).code, 401);
  h.state.states['image.hint'] = { state: '2026-11-06T21:00:00Z', attributes: {} };
  assert.notEqual(
    (await h.request('GET', '/data')).body.assistant.image,
    first.body.assistant.image,
    'a new picture is a new version',
  );
  h.state.states['image.hint'] = { state: 'unavailable', attributes: {} };
  assert.equal((await h.request('GET', '/data')).body.assistant.image, null);
  assert.equal((await h.request('GET', '/image')).code, 404);
}
{
  const h = harness();
  assert.equal((await h.request('GET', '/data')).body.assistant.image, null, 'no image entity configured');
  assert.equal((await h.request('GET', '/image')).code, 404);
  for (const bad of [
    'todo:' + 'a'.repeat(32) + ':done',
    'device:garage:on',
    'device:desk_light',
    'mode:auto',
    'turn_on',
    42,
  ]) {
    assert.equal((await h.request('POST', '/action', { action: bad })).code, 400, String(bad));
  }
  assert.equal((await h.request('POST', '/action', { action: 'device:fan:on', id: 'bad id!' })).code, 400);
  assert.equal((await h.request('GET', '/v1/frame')).code, 404, 'the PNG frame API is gone');
  assert.equal(
    (await h.request('POST', '/action', { action: 'assistant' })).code,
    409,
    'no writer, no 更新 button action',
  );
  // The 更新 button: confirmed when the writer wrote new text, failed (prior text kept) when it did not.
  for (const [result, status] of [
    [true, 'confirmed'],
    [false, 'failed'],
  ]) {
    h.app.setRewrite(async () => result);
    const { request, done } = h.app.submit('assistant');
    await done.catch(() => {});
    assert.equal(request.status, status);
  }
  // Detailed screen checks keep their feedback all the way through POST /action and GET /data.
  for (const [id, result, status, message] of [
    [
      'assistant-kept',
      { ok: true, status: 'kept', message: '已检查，保留原便条。' },
      'confirmed',
      '已检查，保留原便条。',
    ],
    ['assistant-updated', { ok: true, status: 'updated', message: '便条已更新。' }, 'confirmed', '便条已更新。'],
    [
      'assistant-rejected',
      { ok: false, status: 'rejected', error: '当前为屏幕静默时段。' },
      'failed',
      '当前为屏幕静默时段。',
    ],
    ['assistant-thrown', new Error('正在保存助手设置，请稍后再试。'), 'failed', '正在保存助手设置，请稍后再试。'],
  ]) {
    h.app.setRewrite(async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    const accepted = await h.request('POST', '/action', { action: 'assistant', id });
    assert.equal(accepted.code, 202);
    await h.app.submit('assistant', id).done.catch(() => {});
    const entry = (await h.request('GET', '/data')).body.requests.find((item) => item.id === id);
    assert.equal(entry.status, status);
    assert.equal(status === 'confirmed' ? entry.message : entry.error, message);
  }
}
console.log(
  'Calendar ranges/DST, per-day items with end/until, note privacy, image client, /data ETag, hint lines and /image, rejected to-do actions checked.',
);
