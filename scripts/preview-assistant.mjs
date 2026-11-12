// Build an offline interactive copy of the production chat UI. No server, credentials or model calls.
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { assistantOptions } from '../ha-app/server/assistant/settings.mjs';

function installPreviewMock(defaults, prompt) {
  const timezone = 'America/Denver';
  const started = Date.now();
  const iso = (minutes) => new Date(started + minutes * 60000).toISOString();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  const day = parts.year + '-' + parts.month + '-' + parts.day;
  const memory = {
    style: { text: '表达自然具体，不重复提醒。', revision: 'preview-style-0', limit: 3000 },
    long_term: {
      text: '# 长期记忆\n\n- 用户明确的目标：结合日历、天气、时间和家中环境，帮助关注生活节奏与舒适度。\n- 提醒自然、具体，给出选择，不反复叮嘱。\n- 日历没有安排不代表用户一定有空；空档不需要填满。\n- 新闻优先早间，只讲事实。\n',
      revision: 'preview-long-0',
      limit: 3000,
    },
    short_term: {
      text: '# 短期记忆\n\n这是离线演示，暂时没有保存的临时安排。\n',
      revision: 'preview-short-0',
      limit: 6000,
    },
  };
  const mock = {
    enabled: true,
    model: 'deepseek-flash（模拟）',
    busy: false,
    demo: true,
    memory_status: 'idle',
    messages: [],
    chat_revision: 'preview-chat-0',
    history_writable: true,
    memory,
    settings: {
      options: { ...defaults, assistant_prompt: prompt },
      revision: 'preview-settings-0',
      writable: true,
      api_key_configured: true,
    },
    context: {
      timezone,
      instant: new Date().toISOString(),
      now: '',
      observed_at: new Date().toISOString(),
      sources: { ha: 'ok', calendar: 'ok', forecast: 'ok' },
      schedule_status: 'ok',
      availability: {
        status: 'no_calendar_event',
        horizon_end: iso(360),
        free_windows: [
          { start: iso(0), end: iso(90) },
          { start: iso(150), end: iso(240) },
        ],
        note: '空档只代表演示日历中没有占用，不能证明用户有空或想外出。',
      },
      schedule: [
        { title: '演示 · 项目讨论', start: iso(90), end: iso(150), all_day: false, status: 'upcoming' },
        { title: '演示 · 晚餐约定', start: iso(240), end: iso(300), all_day: false, status: 'upcoming' },
      ],
      weather: {
        city: '丹佛',
        now: { temp: 15, text: '多云', humidity: 42, aqi: 38 },
        hourly: [14, 13, 12, 11, 10, 9].map((temp, i) => ({
          datetime: iso((i + 1) * 60),
          temp,
          text: '多云',
          pop: 10,
        })),
      },
      indoor: { temperature: 19.6, temperature_unit: '°C', humidity: 29, co2: 610 },
      devices: [
        {
          entity_id: 'humidifier.preview',
          available: true,
          state: 'on',
          recorded_state_minutes: 45,
          last_changed: iso(-45),
          attributes: { friendly_name: '加湿器', target_humidity: 45, current_humidity: 29 },
        },
        {
          entity_id: 'light.preview_desk',
          available: true,
          state: 'on',
          recorded_state_minutes: 80,
          attributes: { friendly_name: '屏幕挂灯' },
        },
        {
          entity_id: 'light.preview_floor',
          available: true,
          state: 'off',
          recorded_state_minutes: 120,
          attributes: { friendly_name: '落地灯' },
        },
      ],
      previous: { lines: [], generated_at: null, expires_at: null },
    },
  };
  let revision = 0;
  function json(value, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  }
  function clock() {
    mock.context.instant = new Date().toISOString();
    mock.context.now = new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
    mock.context.devices[0].recorded_state_minutes = 45 + Math.floor((Date.now() - started) / 60000);
    for (const doc of Object.values(memory)) doc.length = [...doc.text].length;
  }
  function remember(message, expected) {
    const isQuestion = /[？?]|吗|么|如何|怎样|看看|是否|什么/.test(message);
    let kind = null;
    if (!isQuestion && /今天想|今天不想|今晚|明天想|这周想|我准备/.test(message)) kind = 'short_term';
    else if (!isQuestion && /以后|平时|一直|每次|习惯|通常|记住/.test(message)) kind = 'long_term';
    if (!kind) {
      mock.memory_status = 'saved';
      return;
    }
    if (memory[kind].revision !== expected[kind]) {
      mock.memory_status = 'failed';
      return;
    }
    const temporary = kind === 'short_term' ? '；有效期：本次临时安排结束，未明确时待确认' : '；有效期：用户修订前';
    const text =
      memory[kind].text.trimEnd() +
      '\n- ' +
      day +
      '｜用户明确表达（演示记录）' +
      temporary +
      '：' +
      message.replace(/\s+/g, ' ') +
      '\n';
    if ([...text].length > memory[kind].limit) {
      mock.memory_status = 'failed';
      return;
    }
    memory[kind].text = text;
    memory[kind].revision = 'preview-' + ++revision;
    mock.memory_status = 'saved';
    clock();
  }
  function answerFor(message) {
    const temporary = memory.short_term.text;
    if (/记住|以后|今天想|今天不想|平时|习惯/.test(message))
      return '了解。我会把你明确表达的偏好或临时安排交给记忆整理步骤。\n\n你可以打开左侧的 **记忆** 页面查看、修改保存结果。这里是离线演示，记录仅在本页有效，刷新后重置。';
    if (/安排|忙|空/.test(message))
      return '从这份 **演示日历** 看，下一项安排大约在一个半小时后，是项目讨论；之后还有晚餐约定。现在没有日历占用，不过这并不能证明你一定有空。\n\n如果还有没记在日历上的事情，可以直接告诉我；也不用为了有空档就安排更多活动。';
    if (/出门|走走|天气/.test(message)) {
      if (/不想出门|想待在家|不出门/.test(temporary))
        return '你刚才表达了今天想待在家里，我先按这个临时安排理解。\n\n演示天气显示外面 **15 °C、多云**，稍后逐渐变凉；现在没有需要你为了天气改变安排的明显理由。想休息就照自己的节奏来。';
      return '演示数据里，外面现在 **15 °C、多云**，接下来几小时逐渐变凉，降雨概率较低；日历上下一项安排大约在一个半小时后。\n\n如果你想走走，可以考虑短一点的散步；如果还有没记在日历里的事情，也可以先处理自己的安排。';
    }
    if (/灯|清醒|睡/.test(message))
      return '演示里屏幕挂灯开着，落地灯关着。这只能说明设备的当前状态，**不能据此判断你在工作、清醒或者已经睡了**。\n\n可以结合你自己说的安排来理解，不用让灯光替你决定现在该做什么。';
    return '屋里目前约 **19.6 °C、湿度 29%**，CO₂ 读数没有明显偏高。加湿器已经开启，HA 的演示记录显示这个状态持续约 45 分钟。\n\n湿度现在仍偏低，可以先观察接下来有没有上升。这里只提供了当前读数，历史点还不够，我还不能判断加湿效果。\n\n如果你觉得冷，也可以告诉我偏好的温度，之后的建议就有更具体的依据。';
  }
  globalThis.fetch = async (path, options = {}) => {
    const pathname = typeof path === 'string' ? path.split('?')[0] : '';
    clock();
    if (pathname === '/assistant/state' && (!options.method || options.method === 'GET')) return json(mock);
    if (pathname === '/assistant/chat' && options.method === 'DELETE') {
      if (mock.busy) return json({ error: '上一条消息仍在处理中。' }, 409);
      const { id, all, revision: expected } = JSON.parse(options.body);
      if (expected !== mock.chat_revision) return json({ error: '对话已更新，请刷新后再删除。' }, 409);
      const index = mock.messages.findIndex((message) => message.role === 'user' && message.id === id);
      if (all === true && id === undefined) mock.messages = [];
      else if (typeof id === 'string' && all === undefined && index >= 0) mock.messages.splice(index, 2);
      else return json({ error: '请选择要删除的对话。' }, 400);
      mock.chat_revision = 'preview-chat-' + ++revision;
      return json({ messages: mock.messages, chat_revision: mock.chat_revision, history_writable: true });
    }
    if (pathname === '/assistant/settings' && options.method === 'PUT') {
      const body = JSON.parse(options.body);
      if (body.revision !== mock.settings.revision) return json({ error: '设置已更新，请重新载入。' }, 409);
      const { llm_api_key, ...visible } = body.options;
      mock.settings = {
        ...mock.settings,
        options: { ...mock.settings.options, ...visible },
        revision: 'preview-settings-' + ++revision,
        api_key_configured: llm_api_key === undefined ? mock.settings.api_key_configured : Boolean(llm_api_key),
      };
      return json({ settings: mock.settings });
    }
    if (pathname === '/assistant/memory' && options.method === 'PUT') {
      let body;
      try {
        body = JSON.parse(options.body);
      } catch {
        return json({ error: '请求格式不正确。' }, 400);
      }
      if (!Object.hasOwn(memory, body.kind) || typeof body.text !== 'string')
        return json({ error: '无效的记忆文档。' }, 400);
      const doc = memory[body.kind];
      if (body.revision !== doc.revision) return json({ error: '记忆已被更新，请重新载入后再保存。' }, 409);
      if ([...body.text].length > doc.limit) return json({ error: '记忆超过长度上限，请精简后保存。' }, 413);
      doc.text = body.text;
      doc.revision = 'preview-' + ++revision;
      clock();
      return json({ memory });
    }
    if (pathname === '/assistant/panel' && options.method === 'POST') {
      mock.context.previous = {
        lines: ['湿度偏低，加湿器已经开启，可以先观察接下来的变化。'],
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 2 * 3600000).toISOString(),
      };
      return json({ ok: true });
    }
    if (pathname === '/assistant/chat' && options.method === 'POST') {
      if (mock.busy) return json({ error: '上一条消息仍在处理中。' }, 409);
      let message;
      try {
        message = JSON.parse(options.body).message;
      } catch {
        return json({ error: '无效消息。' }, 400);
      }
      if (typeof message !== 'string' || !message.trim() || [...message].length > 8000)
        return json({ error: '消息须为 1～8000 字符。' }, 400);
      message = message.trim();
      mock.busy = true;
      const expected = Object.fromEntries(Object.entries(memory).map(([kind, value]) => [kind, value.revision]));
      const answer = answerFor(message);
      const characters = [...answer];
      const encoder = new TextEncoder();
      let offset = 0;
      let ended = false;
      let abort;
      const stream = new ReadableStream({
        start(controller) {
          abort = () => {
            if (!ended) {
              ended = true;
              mock.busy = false;
              controller.error(new DOMException('已停止', 'AbortError'));
            }
          };
          options.signal?.addEventListener('abort', abort, { once: true });
          controller.enqueue(
            encoder.encode('data: ' + JSON.stringify({ type: 'status', status: 'thinking' }) + '\n\n'),
          );
        },
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, offset ? 30 : 200));
          if (ended) return;
          if (options.signal?.aborted) return abort();
          if (offset < characters.length) {
            const text = characters.slice(offset, offset + 9).join('');
            offset += 9;
            controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'delta', text }) + '\n\n'));
            return;
          }
          ended = true;
          options.signal?.removeEventListener('abort', abort);
          mock.busy = false;
          const turn = ++revision;
          mock.messages.push(
            { id: 'preview-user-' + turn, role: 'user', content: message, at: new Date().toISOString() },
            { id: 'preview-answer-' + turn, role: 'assistant', content: answer, at: new Date().toISOString() },
          );
          mock.chat_revision = 'preview-chat-' + turn;
          mock.messages = mock.messages.slice(-24);
          mock.memory_status = 'pending';
          setTimeout(() => remember(message, expected), 650);
          controller.enqueue(
            encoder.encode('data: ' + JSON.stringify({ type: 'done', memory_status: 'pending' }) + '\n\n'),
          );
          controller.close();
        },
        cancel() {
          ended = true;
          mock.busy = false;
          options.signal?.removeEventListener('abort', abort);
        },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return json({ error: '离线预览不会访问外部服务。' }, 404);
  };
}

const root = new URL('../', import.meta.url);
const [template, markdown, prompt] = await Promise.all([
  readFile(new URL('ha-app/server/chat.html', root), 'utf8'),
  readFile(new URL('ha-app/server/vendor/streaming-markdown.mjs', root), 'utf8'),
  readFile(new URL('ha-app/server/assistant/default-prompt.txt', root), 'utf8').catch(() => ''),
]);
const namespace =
  'const smd = (() => {\n' +
  markdown.replace(/^export\s+/gm, '') +
  '\nreturn {parser, parser_write, parser_end, default_renderer};\n})();\n';
let html = template.replace(
  "import * as smd from '/assets/markdown.js?v=0.2.15';",
  () =>
    namespace +
    '\n(' +
    installPreviewMock.toString() +
    ')(' +
    JSON.stringify(assistantOptions()).replace(/</g, '\\u003c') +
    ',' +
    JSON.stringify(prompt).replace(/</g, '\\u003c') +
    ');',
);
if (html === template) throw new Error('Production Markdown import changed; update preview generator.');
html = html
  .replace('id="demoNotice" class="notice hidden"', 'id="demoNotice" class="notice"')
  .replace(
    '本地演示 · 环境数据与回答均为模拟，未调用真实模型。',
    '离线演示 · HA 数据与模型回答均为模拟；记忆仅在本页有效，刷新后重置。',
  );
const output = new URL('output/assistant-preview.html', root);
await mkdir(new URL('output/', root), { recursive: true });
await writeFile(output, html);
const temporary = await mkdtemp(join(tmpdir(), 'mono-calendar-preview-'));
try {
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  if (!script || /\bimport\s+.*from\s+["'](?:https?:|\/)/.test(script))
    throw new Error('Preview still has external imports.');
  const path = join(temporary, 'preview.mjs');
  await writeFile(path, script);
  execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log('Offline interactive preview generated: ' + fileURLToPath(output));
console.log('Production interface + local streaming-markdown; mocked HA/model; no server or network requests.');
