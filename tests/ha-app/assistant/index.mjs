import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { AssistantMemory } from '../../../ha-app/server/assistant/memory.mjs';
import { Assistant, streamReply } from '../../../ha-app/server/assistant/index.mjs';
import { assistantAgenda } from '../../../ha-app/server/sources/agenda.mjs';
import { createApp } from '../../../ha-app/server/app.mjs';

const directory = await mkdtemp(join(tmpdir(), 'mono-calendar-assistant-check-'));
const now = new Date('2026-11-08T17:00:00Z');
const config = { timezone: 'America/Denver', entities: { assistant_text: 'input_text.test_hint' } };
const context = {
  _offline: false,
  now: '2026-11-08 10:00 星期日',
  indoor: { temperature: 21, humidity: 35, co2: 600 },
  schedule_status: 'ok',
  schedule: [],
  newsletter: { summary: 'PRIVATE_NEWSLETTER_SENTINEL' },
  previous: { lines: ['STALE_GENERATED_SCREEN_SENTINEL'], at: now.toISOString() },
};
function chunkedResponse(data, size) {
  const bytes = new TextEncoder().encode(data);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
        controller.close();
      },
    }),
  );
}
function streamed(text = '可以按自己的节奏来。', { finish = 'stop', done = true, size = 5 } = {}) {
  const data =
    ': keep-alive\r\n\r\n' +
    'data: ' +
    JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING_SENTINEL' } }] }) +
    '\r\n\r\n' +
    'data: ' +
    JSON.stringify({ choices: [{ delta: { content: text } }] }) +
    '\r\n\r\n' +
    'data: ' +
    JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }) +
    '\r\n\r\n' +
    (done ? 'data: [DONE]\r\n\r\n' : '');
  return chunkedResponse(data, size);
}
function toolStream(actions, { finish = 'tool_calls', done = true, size = 7, intro = '' } = {}) {
  let data =
    'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING_SENTINEL' } }] }) + '\n\n';
  if (intro) data += 'data: ' + JSON.stringify({ choices: [{ delta: { content: intro } }] }) + '\n\n';
  actions.forEach((action, index) => {
    const args = typeof action.arguments === 'string' ? action.arguments : JSON.stringify(action.arguments);
    data +=
      'data: ' +
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index, id: 'tool_' + index, type: 'function', function: { name: action.name, arguments: args } },
              ],
            },
          },
        ],
      }) +
      '\n\n';
  });
  data +=
    'data: ' +
    JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] }) +
    '\n\n' +
    (done ? 'data: [DONE]\n\n' : '');
  return chunkedResponse(data, size);
}
function requestSnapshot(body) {
  const reference = body.messages.find((x) => x.role === 'system' && x.content.startsWith('[参考资料'));
  assert.ok(reference, 'Every invocation carries a labelled data snapshot');
  return JSON.parse(reference.content.slice(reference.content.indexOf('\n') + 1));
}
function addMemory(body, text = body.messages.at(-1).content, extra = {}) {
  const snapshot = requestSnapshot(body);
  return {
    operations: [
      {
        op: 'add',
        kind: 'long_term',
        base_revision: snapshot.memory.long_term.revision,
        text,
        evidence: [{ message_id: snapshot.current_user_id, quote: body.messages.at(-1).content }],
        ...extra,
      },
    ],
  };
}
function harness(options = {}) {
  const calls = [];
  const events = [];
  const writes = [];
  const ha = options.ha || {
    states: async (ids) =>
      Object.fromEntries(
        ids.map((id) => [
          id,
          {
            state: context.previous.lines.join('\n'),
            last_changed: context.previous.at,
          },
        ]),
      ),
    service: async (...args) => writes.push(args),
  };
  let assistant;
  assistant = new Assistant(
    { ...config, ...options.config },
    { LLM_API_KEY: 'fake-private-model-key' },
    ha,
    options.context || (async () => structuredClone(context)),
    {
      fetch: async (url, request) => {
        const body = JSON.parse(request.body);
        calls.push(body);
        if (options.respond) return options.respond(body, assistant, request);
        if (body.stream) return streamed(options.answer, options.streamOptions);
        throw new Error('Unexpected non-stream model request');
      },
      newsSources: options.newsSources || (async () => []),
    },
  );
  return { assistant, calls, events, writes, send: (value) => events.push(value) };
}
try {
  const memory = new AssistantMemory(join(directory, 'memory'));
  await memory.load();
  const memoryFiles = await readdir(memory.directory);
  assert.ok(['long-term.md', 'short-term.md'].every((name) => memoryFiles.includes(name)));
  let docs = await memory.read();
  const old = docs.long_term;
  await memory.replace('long_term', '😀'.repeat(3000), old.revision);
  docs = await memory.read();
  assert.equal(docs.long_term.length, 3000, 'Unicode code points, not UTF-16 units');
  await assert.rejects(
    memory.replace('long_term', '中'.repeat(3001), docs.long_term.revision),
    (error) => error.status === 413,
  );
  await assert.rejects(memory.replace('long_term', '旧页面的编辑', old.revision), (error) => error.status === 409);
  assert.equal((await memory.read()).long_term.text, docs.long_term.text, 'Rejected edits do not truncate or erase');
  const writes = await Promise.allSettled(
    ['第一份编辑', '第二份编辑'].map((text) => memory.replace('long_term', text, docs.long_term.revision)),
  );
  assert.equal(writes.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(writes.find((x) => x.status === 'rejected').reason.status, 409, 'Concurrent stale writes conflict');
  await writeFile(join(memory.directory, 'short-term.md'), '# 手动编辑\n今天想待在家里。');
  assert.match((await memory.read()).short_term.text, /待在家里/, 'External edits are reloaded');
  await memory.load();
  assert.match((await memory.read()).short_term.text, /待在家里/, 'Restart preserves existing documents');
  await writeFile(join(memory.directory, 'short-term.md'), Buffer.from([0xff]));
  await assert.rejects(memory.read(), /encoded|encoding/i, 'Invalid UTF-8 is never silently rewritten');

  const event = (summary, start, end, extra = {}) => ({
    summary,
    start: { dateTime: start },
    end: { dateTime: end },
    ...extra,
  });
  const source = {
    status: 'ok',
    events: [
      event('已结束', '2026-11-08T15:00:00Z', '2026-11-08T16:00:00Z'),
      event('进行中', '2026-11-08T16:30:00Z', '2026-11-08T17:30:00Z'),
      event('重叠', '2026-11-08T17:15:00Z', '2026-11-08T18:00:00Z'),
      event('下一项', '2026-11-08T19:00:00Z', '2026-11-08T20:00:00Z'),
      event('透明条目', '2026-11-08T18:00:00Z', '2026-11-08T19:00:00Z', { transparency: 'transparent' }),
      event('已取消', '2026-11-08T17:00:00Z', '2026-11-08T23:00:00Z', { status: 'cancelled' }),
      event('浮动时间无时区', '2026-11-08T17:00:00', '2026-11-08T23:00:00'),
      { summary: '全天标签', start: { date: '2026-11-08' }, end: { date: '2026-11-09' } },
      ...Array.from({ length: 8 }, (_, i) =>
        event(
          '明日条目' + i,
          new Date(now.getTime() + 86400000 + i * 1800000).toISOString(),
          new Date(now.getTime() + 86400000 + i * 1800000 + 900000).toISOString(),
        ),
      ),
    ],
  };
  const agenda = assistantAgenda({ ...config, calendars: ['calendar.personal'] }, source, now);
  assert.equal(agenda.availability.status, 'calendar_busy');
  assert.ok(agenda.schedule.length > 6, 'Assistant sees full events, not the six-row display');
  assert.ok(!agenda.schedule.some((x) => ['已结束', '已取消', '浮动时间无时区'].includes(x.title)));
  assert.ok(
    agenda.schedule_today.some((x) => x.title === '已结束'),
    'Today timeline keeps completed context',
  );
  assert.deepEqual(
    agenda.availability.free_windows,
    [
      { start: '2026-11-08T18:00:00.000Z', end: '2026-11-08T19:00:00.000Z' },
      { start: '2026-11-08T20:00:00.000Z', end: '2026-11-08T23:00:00.000Z' },
    ],
    'Overlaps merge and transparent/all-day entries do not consume free intervals',
  );
  for (const status of ['stale', 'loading', 'unavailable']) {
    const result = assistantAgenda(config, { ...source, status }, now);
    assert.equal(result.availability.status, 'unknown');
    assert.deepEqual(result.availability.free_windows, []);
  }
  assert.equal(assistantAgenda(config, undefined, now).schedule_status, 'unconfigured');
  const dst = assistantAgenda(
    config,
    { status: 'ok', events: [event('重复的一点', '2026-11-01T01:30:00-06:00', '2026-11-01T01:15:00-07:00')] },
    new Date('2026-11-01T07:45:00Z'),
  );
  assert.equal(dst.availability.status, 'calendar_busy');
  assert.equal(
    dst.availability.free_windows[0].start,
    '2026-11-01T08:15:00.000Z',
    'DST uses instants, not local clock order',
  );
  const mixedOffsets = assistantAgenda(
    config,
    {
      status: 'ok',
      events: [
        event('晚一些', '2026-11-01T01:15:00-07:00', '2026-11-01T01:25:00-07:00'),
        event('早一些', '2026-11-01T01:50:00-06:00', '2026-11-01T01:55:00-06:00'),
      ],
    },
    new Date('2026-11-01T07:00:00Z'),
  );
  assert.deepEqual(
    mixedOffsets.schedule.map((x) => x.title),
    ['早一些', '晚一些'],
    'Mixed offsets sort by real chronological order',
  );
  const overnight = assistantAgenda(
    config,
    { status: 'ok', events: [event('跨午夜进行中', '2026-11-07T23:30:00-07:00', '2026-11-08T11:00:00-07:00')] },
    now,
  );
  assert.equal(
    overnight.schedule_today[0]?.title,
    '跨午夜进行中',
    'Today context includes ongoing events begun yesterday',
  );

  const output = [];
  assert.equal(await streamReply(streamed('你好，🌱。'), (value) => output.push(value)), '你好，🌱。');
  assert.ok(!JSON.stringify(output).includes('PRIVATE_REASONING_SENTINEL'));
  for (const options of [{ done: false }, { finish: 'length' }])
    await assert.rejects(
      streamReply(streamed('未完成。', options), () => {}),
      /incomplete/,
    );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    streamReply(streamed(), () => {}, cancelled.signal),
    (error) => error.name === 'AbortError',
  );

  const chat = harness({
    config: { assistant_state_file: join(directory, 'chat', 'panel.json') },
    context: async () => ({
      ...structuredClone(context),
      newsletter: {
        id: 'nyt-mail:test',
        title: 'Today’s Morning',
        site: 'The New York Times',
        scope: 'general',
        date: new Date(Date.now() - 1000).toISOString(),
        summary: 'NYT_NEWS_SUMMARY_SENTINEL',
        body: 'PRIVATE_MAIL_BODY_SENTINEL',
        headers: 'PRIVATE_MAIL_HEADERS_SENTINEL',
      },
    }),
    respond: (body) =>
      toolStream([
        { name: 'chat', arguments: { text: '可以按自己的节奏来。' } },
        { name: 'memory', arguments: addMemory(body) },
      ]),
  });
  await chat.assistant.load();
  assert.equal(await chat.assistant.chat('以后周末少安排活动。', chat.send), '可以按自己的节奏来。');
  await chat.assistant.maintenance;
  assert.equal(chat.assistant.memoryStatus, 'saved');
  assert.equal(chat.calls.length, 1, 'Chat and optional memory actions share one model request');
  assert.deepEqual(chat.calls[0].thinking, { type: 'enabled' });
  assert.equal(chat.calls[0].max_tokens, undefined);
  assert.equal(chat.calls[0].stream, true);
  assert.equal(chat.calls[0].response_format, undefined);
  assert.deepEqual(
    chat.calls[0].tools.map((x) => x.function.name),
    ['chat', 'memory', 'read_news'],
  );
  const chatInput = requestSnapshot(chat.calls[0]);
  assert.ok(
    chatInput.news.some((x) => x.summary.includes('NYT_NEWS_SUMMARY_SENTINEL')),
    'Chat receives the shared compact news input',
  );
  assert.ok(!JSON.stringify(chat.calls).includes('PRIVATE_MAIL_BODY_SENTINEL'));
  assert.ok(!JSON.stringify(chat.calls).includes('PRIVATE_MAIL_HEADERS_SENTINEL'));
  assert.equal(chatInput.current_user_id.startsWith('msg_'), true);
  assert.equal(chat.calls[0].messages.at(-1).content, '以后周末少安排活动。');
  assert.match((await chat.assistant.memory.read()).long_term.text, /周末少安排活动/);
  assert.equal(chat.assistant.state.messages.length, 2);
  const restart = harness({ config: { assistant_state_file: join(directory, 'chat', 'panel.json') } });
  await restart.assistant.load();
  assert.deepEqual(restart.assistant.state.messages, chat.assistant.state.messages);

  let memoryOnlyApplyCount = 0;
  const memoryOnlyQuote = '以后早饭时聊新闻就好。';
  const memoryOnly = harness({
    config: { assistant_chat_file: join(directory, 'memory-only', 'assistant-chat.json') },
    respond: async (body, assistant) => {
      const snapshot = requestSnapshot(body);
      if (!snapshot.execution_results) return toolStream([{ name: 'memory', arguments: addMemory(body) }]);
      assert.match(
        (await assistant.memory.read()).long_term.text,
        /以后早饭时聊新闻就好/,
        'The memory operation is committed before the final chat request',
      );
      assert.ok(snapshot.execution_results.memory.some((result) => result.status === 'saved'));
      assert.deepEqual(
        body.tools.map((tool) => tool.function.name),
        ['chat'],
        'Finalization reopens no write or news tools',
      );
      return toolStream([
        { name: 'chat', arguments: { text: '好，已经记下。' } },
        { name: 'memory', arguments: addMemory(body) },
      ]);
    },
  });
  await memoryOnly.assistant.load();
  const originalMemoryOnlyApply = memoryOnly.assistant.memory.apply.bind(memoryOnly.assistant.memory);
  memoryOnly.assistant.memory.apply = (...args) => {
    memoryOnlyApplyCount++;
    return originalMemoryOnlyApply(...args);
  };
  assert.equal(await memoryOnly.assistant.chat(memoryOnlyQuote, memoryOnly.send), '好，已经记下。');
  assert.equal(memoryOnly.calls.length, 2, 'A legitimate memory-only action receives one final chat request');
  assert.equal(memoryOnlyApplyCount, 1, 'Unsolicited memory in the final reply cannot execute a duplicate operation');
  const memoryOnlyDocs = await memoryOnly.assistant.memory.read();
  assert.equal(memoryOnlyDocs.long_term.entries.filter((entry) => entry.text === memoryOnlyQuote).length, 1);
  assert.equal(memoryOnly.assistant.memoryStatus, 'saved');
  assert.equal(memoryOnly.assistant.state.messages.length, 2);
  assert.equal(
    memoryOnly.events
      .filter((event) => event.type === 'delta')
      .map((event) => event.text)
      .join(''),
    '好，已经记下。',
  );
  assert.equal((await readFile(memoryOnly.assistant.historyPath, 'utf8')).trim().split('\n').length, 1);
  assert.ok(memoryOnly.calls.every((call) => call.messages.every((message) => message.role !== 'assistant')));
  assert.ok(
    !JSON.stringify(memoryOnly.calls).includes('PRIVATE_REASONING_SENTINEL'),
    'Tool finalization uses fresh context without reasoning replay',
  );

  const memoryBeforeFailedFinal = harness({
    respond: (body) => {
      if (!requestSnapshot(body).execution_results) return toolStream([{ name: 'memory', arguments: addMemory(body) }]);
      throw new Error('followup unavailable');
    },
  });
  await memoryBeforeFailedFinal.assistant.load();
  await assert.rejects(
    memoryBeforeFailedFinal.assistant.chat('这条记忆不应被回复失败撤销。', () => {}),
    /followup unavailable/,
  );
  assert.equal(memoryBeforeFailedFinal.calls.length, 2);
  assert.match((await memoryBeforeFailedFinal.assistant.memory.read()).long_term.text, /这条记忆不应被回复失败撤销/);
  assert.equal(memoryBeforeFailedFinal.assistant.memoryStatus, 'saved');
  assert.equal(
    memoryBeforeFailedFinal.assistant.state.messages.length,
    0,
    'A failed final reply is not archived as a successful chat',
  );

  const presence = [
    { entity_id: 'binary_sensor.at_home', state: 'unknown', available: false, observed_at: now.toISOString() },
  ];
  const devices = [{ entity_id: 'light.desk', state: 'on', attributes: { friendly_name: '桌灯', brightness: 100 } }];
  const secondary = harness({ context: async () => ({ ...structuredClone(context), presence, devices }) });
  await secondary.assistant.load();
  await secondary.assistant.chat('你好。', () => {});
  const secondaryInput = requestSnapshot(secondary.calls[0]);
  assert.equal(secondaryInput.context.presence, undefined);
  assert.equal(secondaryInput.context.devices, undefined);
  assert.deepEqual(
    secondaryInput.secondary.presence,
    presence,
    'Unknown/offline presence remains labelled secondary data',
  );
  assert.deepEqual(secondaryInput.secondary.devices, devices, 'Device attributes do not enter primary facts');

  const noteHistory = [{ at: new Date(+now - 3600000).toISOString(), lines: ['此前提醒过室温偏低。'] }];
  const notes = harness({
    respond: (body) => {
      const snapshot = requestSnapshot(body);
      assert.deepEqual(snapshot.screen.history, noteHistory, 'All model requests include confirmed note history');
      assert.deepEqual(
        snapshot.screen.lines,
        context.previous.lines,
        'Current screen remains distinct from historical notes',
      );
      return toolStream(
        snapshot.decision.trigger === 'chat'
          ? [{ name: 'chat', arguments: { text: '看到了此前的便条。' } }]
          : [
              {
                name: 'screen',
                arguments: { action: 'keep', lines: [], expires_at: null, base_version: snapshot.screen.version },
              },
            ],
      );
    },
  });
  await notes.assistant.load();
  notes.assistant.writer.state.reminders = structuredClone(noteHistory);
  await notes.assistant.chat('刚才便条说了什么？', () => {});
  for (const trigger of ['manual', 'scheduled']) assert.equal(await notes.assistant.decide(trigger, now), true);
  assert.equal(notes.calls.length, 3);
  assert.equal(notes.writes.length, 0, 'Reading note history does not rewrite the screen');

  const detailArticle = {
    id: 'known-news-item',
    title: '需要正文的报道',
    summary: '一条简短摘要。',
    site: '中新网',
    date: new Date(Date.now() - 1000).toISOString(),
    url: 'https://www.chinanews.com.cn/test-report.html',
    scope: 'general',
  };
  const intro = '我先看一下这条报道。';
  const finalText = '报道正文中的结论是这样。';
  let detailCount = 0;
  let requestedDetail;
  const details = harness({
    context: async () => ({ ...structuredClone(context), timezone: config.timezone }),
    newsSources: async () => [detailArticle],
    respond: (body) => {
      const snapshot = requestSnapshot(body);
      const article = snapshot.news[0];
      if (!snapshot.news_details)
        return toolStream([{ name: 'read_news', arguments: { ids: [article.id] } }], { intro });
      return toolStream([
        { name: 'chat', arguments: { text: finalText } },
        // Even an unsolicited second read request cannot create a third API call.
        { name: 'read_news', arguments: { ids: [article.id] } },
      ]);
    },
  });
  await details.assistant.load();
  await details.assistant.news.snapshot(await details.assistant.rawContext(), new Date());
  details.assistant.news.detail = async (id) => {
    detailCount++;
    requestedDetail = id;
    return { id, text: 'DETAIL_TEXT_SENTINEL', site: '中新网', date: detailArticle.date };
  };
  const detailedAnswer = await details.assistant.chat('请展开这条新闻。', details.send);
  assert.equal(detailedAnswer, intro + '\n\n' + finalText);
  assert.equal(
    details.events
      .filter((x) => x.type === 'delta')
      .map((x) => x.text)
      .join(''),
    detailedAnswer,
    'The complete visible introduction, separator and final answer match the archived content',
  );
  assert.equal(details.assistant.state.messages.at(-1).content, detailedAnswer);
  assert.equal(details.calls.length, 2, 'One optional detail retrieval permits at most one fresh continuation');
  assert.equal(detailCount, 1);
  assert.equal(requestedDetail, requestSnapshot(details.calls[0]).news[0].id);
  const continuation = requestSnapshot(details.calls[1]);
  assert.equal(continuation.news_details[0].id, requestedDetail);
  assert.equal(continuation.news_details[0].text, 'DETAIL_TEXT_SENTINEL');
  assert.deepEqual(
    details.calls[1].tools.map((x) => x.function.name),
    ['chat', 'memory'],
  );
  assert.ok(
    details.calls.every((call) => call.messages.every((message) => message.role !== 'assistant')),
    'Fresh detail continuation does not replay assistant tool history',
  );
  assert.ok(
    !JSON.stringify(details.calls).includes('PRIVATE_REASONING_SENTINEL'),
    'No reasoning is sent back in fresh requests',
  );

  let unknownDetailCalls = 0;
  const unknownDetails = harness({
    respond: (body) =>
      toolStream([
        { name: 'read_news', arguments: { ids: ['news:made-up-source'] } },
        { name: 'memory', arguments: addMemory(body) },
      ]),
  });
  await unknownDetails.assistant.load();
  unknownDetails.assistant.news.detail = async () => {
    unknownDetailCalls++;
    throw new Error('Must not fetch an unknown source');
  };
  await assert.rejects(
    unknownDetails.assistant.chat('我喜欢简单的早报。', () => {}),
    /incomplete/,
  );
  assert.equal(unknownDetailCalls, 0);
  assert.equal(unknownDetails.calls.length, 1);
  assert.match(
    (await unknownDetails.assistant.memory.read()).long_term.text,
    /我喜欢简单的早报/,
    'A rejected news detail request does not discard a separate valid memory action',
  );
  assert.equal(unknownDetails.assistant.state.messages.length, 0);

  const failed = harness({ streamOptions: { finish: 'length' } });
  await failed.assistant.load();
  const before = await failed.assistant.memory.read();
  await assert.rejects(failed.assistant.chat('未完成的请求。', failed.send), /incomplete/);
  assert.equal(failed.calls.length, 1);
  assert.equal(failed.assistant.state.messages.length, 0);
  assert.deepEqual(await failed.assistant.memory.read(), before, 'Incomplete replies never enter memory');
  const aborted = harness();
  await aborted.assistant.load();
  const stop = new AbortController();
  await assert.rejects(
    aborted.assistant.chat(
      '中途停止。',
      (value) => {
        if (value.type === 'delta') stop.abort();
      },
      stop.signal,
    ),
    (error) => error.name === 'AbortError',
  );
  assert.equal(aborted.assistant.state.messages.length, 0);
  const failedMemory = harness({
    config: { assistant_chat_file: join(directory, 'failed-memory', 'assistant-chat.json') },
    respond: () =>
      toolStream([
        { name: 'chat', arguments: { text: '好。' } },
        { name: 'memory', arguments: '{broken-json' },
      ]),
  });
  await failedMemory.assistant.load();
  const retained = await failedMemory.assistant.memory.read();
  await failedMemory.assistant.chat('今天不想出门。', () => {});
  await failedMemory.assistant.maintenance;
  assert.equal(failedMemory.assistant.memoryStatus, 'failed');
  assert.deepEqual(await failedMemory.assistant.memory.read(), retained);
  assert.equal(
    failedMemory.assistant.state.messages.length,
    2,
    'Malformed memory never loses a valid complete chat action',
  );
  assert.equal(failedMemory.calls.length, 1);
  const rejectedDecision = JSON.parse((await readFile(failedMemory.assistant.audit.path, 'utf8')).trim());
  assert.equal(rejectedDecision.trigger, 'chat');
  assert.equal(rejectedDecision.results.chat.status, 'saved');
  assert.ok(rejectedDecision.errors.some((x) => x.action === 'memory' && x.code === 'invalid_json'));
  assert.ok(rejectedDecision.snapshot.hash);
  assert.ok(
    !JSON.stringify(rejectedDecision).includes('PRIVATE_REASONING_SENTINEL'),
    'Decision logs never retain model reasoning',
  );

  const memoryWriteFailure = harness({
    respond: (body) =>
      toolStream([
        { name: 'chat', arguments: { text: '回复已经完整收到。' } },
        { name: 'memory', arguments: addMemory(body) },
      ]),
  });
  await memoryWriteFailure.assistant.load();
  const beforeWriteFailure = await memoryWriteFailure.assistant.memory.read();
  memoryWriteFailure.assistant.memory.apply = async () => {
    throw new Error('simulated memory storage failure');
  };
  assert.equal(await memoryWriteFailure.assistant.chat('这条记忆写盘会失败。', () => {}), '回复已经完整收到。');
  assert.equal(
    memoryWriteFailure.assistant.state.messages.length,
    2,
    'Memory storage failure cannot roll back archived chat',
  );
  assert.equal(memoryWriteFailure.assistant.memoryStatus, 'failed');
  assert.deepEqual(await memoryWriteFailure.assistant.memory.read(), beforeWriteFailure);

  const externalMemoryEdit = harness({
    respond: async (body, assistant) => {
      const action = addMemory(body);
      const old = await assistant.memory.read();
      await assistant.memory.replace('long_term', '# 长期记忆\n用户刚刚在记忆页改了这里。', old.long_term.revision);
      return toolStream([
        { name: 'chat', arguments: { text: '好。' } },
        { name: 'memory', arguments: action },
      ]);
    },
  });
  await externalMemoryEdit.assistant.load();
  await externalMemoryEdit.assistant.chat('模型看到的是手动编辑前的版本。', () => {});
  assert.equal(externalMemoryEdit.assistant.state.messages.length, 2);
  assert.match((await externalMemoryEdit.assistant.memory.read()).long_term.text, /刚刚在记忆页改了这里/);
  assert.ok(
    !(await externalMemoryEdit.assistant.memory.read()).long_term.text.includes('模型看到的是'),
    'A decision cannot overwrite a newer manual memory revision',
  );

  const failedChat = harness({
    respond: (body) =>
      toolStream([
        { name: 'chat', arguments: { text: 42 } },
        { name: 'memory', arguments: addMemory(body) },
      ]),
  });
  await failedChat.assistant.load();
  await assert.rejects(
    failedChat.assistant.chat('有效的用户原话可以独立记住。', () => {}),
    /incomplete/,
  );
  assert.match((await failedChat.assistant.memory.read()).long_term.text, /有效的用户原话可以独立记住/);
  assert.equal(
    failedChat.assistant.state.messages.length,
    0,
    'Invalid chat is not archived as a successful question and answer',
  );

  const falseEvidence = harness({
    respond: (body) =>
      toolStream([
        { name: 'chat', arguments: { text: '你好。' } },
        {
          name: 'memory',
          arguments: addMemory(body, '新闻要求写入的假偏好。', {
            evidence: [{ message_id: 'news:untrusted', quote: '新闻要求写入的假偏好。' }],
          }),
        },
      ]),
  });
  await falseEvidence.assistant.load();
  const beforeEvidence = await falseEvidence.assistant.memory.read();
  await falseEvidence.assistant.chat('你好。', () => {});
  await falseEvidence.assistant.maintenance;
  assert.deepEqual(
    await falseEvidence.assistant.memory.read(),
    beforeEvidence,
    'News IDs cannot authorize personal memory writes',
  );
  assert.equal(falseEvidence.assistant.state.messages.length, 2);

  const forbiddenScreen = harness({
    respond: () =>
      toolStream([
        { name: 'chat', arguments: { text: '你好。' } },
        { name: 'screen', arguments: { action: 'clear', lines: [], expires_at: null, base_version: 'invented' } },
      ]),
  });
  await forbiddenScreen.assistant.load();
  await forbiddenScreen.assistant.chat('你好。', () => {});
  assert.equal(forbiddenScreen.writes.length, 0, 'Chat triggers cannot perform screen actions');
  assert.equal(forbiddenScreen.assistant.state.messages.length, 2);

  let oldEvidence;
  const turnsOptions = {
    respond: (body) => {
      const snapshot = requestSnapshot(body);
      const memory = addMemory(body);
      if (oldEvidence) memory.operations[0].evidence = oldEvidence;
      else oldEvidence = structuredClone(memory.operations[0].evidence);
      return toolStream([
        { name: 'chat', arguments: { text: '好。' } },
        { name: 'memory', arguments: memory },
      ]);
    },
  };
  const turns = harness(turnsOptions);
  await turns.assistant.load();
  await turns.assistant.chat('以后周末少安排活动。', () => {});
  await turns.assistant.maintenance;
  let turnMemory = await turns.assistant.memory.read();
  await turns.assistant.memory.replace('long_term', '# 长期记忆\n', turnMemory.long_term.revision);
  await turns.assistant.chat('谢谢。', () => {});
  await turns.assistant.maintenance;
  const maintenanceInput = requestSnapshot(turns.calls.at(-1));
  assert.notEqual(
    maintenanceInput.current_user_id,
    oldEvidence[0].message_id,
    'Current user evidence has a distinct server ID',
  );
  assert.ok(!(await turns.assistant.memory.read()).long_term.text.includes('周末少安排活动'));

  const dialogueOptions = {
    config: { assistant_chat_file: join(directory, 'dialogue', 'assistant-chat.json') },
    answer: '对话这边也需要开场报时吗？',
  };
  const dialogue = harness(dialogueOptions);
  await dialogue.assistant.load();
  await dialogue.assistant.chat('屏幕上不需要写当前时间。', () => {});
  await dialogue.assistant.maintenance;
  dialogueOptions.answer = '以后只在你问时说时间。';
  await dialogue.assistant.chat('不需要', () => {});
  await dialogue.assistant.maintenance;
  const resolvedInput = requestSnapshot(dialogue.calls.at(-1));
  assert.equal(dialogue.calls.at(-1).messages.at(-1).content, '不需要');
  assert.equal(
    resolvedInput.conversation.at(-1).content,
    '对话这边也需要开场报时吗？',
    'Unified input carries the question needed to resolve a short answer',
  );
  assert.ok(
    !JSON.stringify(resolvedInput).includes('以后只在你问时说时间'),
    'Current assistant answer is not a source for the user preference',
  );
  const requestMessages = dialogue.calls.at(-1).messages;
  assert.equal(requestMessages[1].role, 'system');
  assert.match(requestMessages[1].content, /^\[参考资料/);
  const references = JSON.parse(requestMessages[1].content.slice(requestMessages[1].content.indexOf('\n') + 1));
  assert.equal(references.context.previous, undefined, 'Generated screen text is not presented as a current fact');
  assert.equal(references.screen.lines[0], 'STALE_GENERATED_SCREEN_SENTINEL');
  assert.ok(references.conversation.some((x) => x.role === 'user' && x.content === '屏幕上不需要写当前时间。'));
  assert.deepEqual(
    requestMessages.at(-1),
    { role: 'user', content: '不需要' },
    'The real user message follows history without an intervening fake environment request',
  );
  assert.match(resolvedInput.decision.local_date, /^\d{4}-\d{2}-\d{2}$/);
  for (let i = 0; i < 20; i++) {
    await dialogue.assistant.chat('接着聊第 ' + i + ' 轮。', () => {});
    await dialogue.assistant.maintenance;
  }
  assert.equal(
    dialogue.assistant.state.messages.length,
    44,
    'Short conversations retain more than the old twelve-turn cutoff',
  );
  assert.equal(dialogue.assistant.state.messages[0].content, '屏幕上不需要写当前时间。');
  const archive = dialogue.assistant.historyPath;
  const records = (text) =>
    text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const archived = await readFile(archive, 'utf8');
  assert.equal(records(archived).length, 22, 'Every successful turn is archived once');
  const dialogueRestart = harness(dialogueOptions);
  await dialogueRestart.assistant.load();
  assert.deepEqual(dialogueRestart.assistant.state.messages, dialogue.assistant.state.messages);
  await dialogueRestart.assistant.load();
  assert.equal(await readFile(archive, 'utf8'), archived, 'Repeated restarts do not import or append old turns again');

  const legacyPath = join(directory, 'legacy', 'assistant-chat.json');
  await mkdir(join(directory, 'legacy'));
  const legacyMessages = Array.from({ length: 80 }, (_, i) => [
    { role: 'user', content: '用户 ' + i + '：' + '中'.repeat(1500), at: now.toISOString() },
    { role: 'assistant', content: '答复 ' + i + '：' + '文'.repeat(1500), at: now.toISOString() },
  ]).flat();
  await writeFile(legacyPath, JSON.stringify({ messages: legacyMessages, observations: [] }));
  const legacy = harness({ config: { assistant_chat_file: legacyPath } });
  await legacy.assistant.load();
  assert.ok(legacy.assistant.state.messages.reduce((sum, x) => sum + x.content.length, 0) <= 96000);
  assert.ok(legacy.assistant.state.messages.length > 24);
  assert.equal(legacy.assistant.state.messages.at(-1).content, legacyMessages.at(-1).content);
  assert.ok(
    legacy.assistant.state.messages.every((x, i) => x.role === (i % 2 ? 'assistant' : 'user')),
    'The context budget removes whole turns',
  );
  const migratedArchive = await readFile(legacy.assistant.historyPath, 'utf8');
  assert.deepEqual(
    records(migratedArchive).flatMap((x) => x.messages),
    legacyMessages,
    'Migration archives the full legacy session before applying the context budget',
  );
  await legacy.assistant.load();
  assert.equal(await readFile(legacy.assistant.historyPath, 'utf8'), migratedArchive);

  const deletion = legacy.assistant.chatState();
  const removed = deletion.messages.at(-2);
  const retainedMemory = await legacy.assistant.memory.read();
  const retainedObservations = structuredClone(legacy.assistant.state.observations);
  await assert.rejects(legacy.assistant.deleteChat(null), (error) => error.status === 400);
  await assert.rejects(
    legacy.assistant.deleteChat({ all: true, id: removed.id, revision: deletion.chat_revision }),
    (error) => error.status === 400,
  );
  await assert.rejects(legacy.assistant.deleteChat({ all: true, revision: 'old' }), (error) => error.status === 409);
  await assert.rejects(
    legacy.assistant.deleteChat({ id: 'unknown', revision: deletion.chat_revision }),
    (error) => error.status === 404,
  );
  legacy.assistant.busy = true;
  await assert.rejects(
    legacy.assistant.deleteChat({ all: true, revision: deletion.chat_revision }),
    (error) => error.status === 409,
  );
  legacy.assistant.busy = false;
  const deleted = await legacy.assistant.deleteChat({ id: removed.id, revision: deletion.chat_revision });
  assert.ok(!deleted.messages.some((message) => message.id === removed.id));
  assert.equal(
    records(await readFile(legacy.assistant.historyPath, 'utf8')).length,
    79,
    'Deleting one turn preserves older archive turns outside the display budget',
  );
  assert.deepEqual(
    await legacy.assistant.memory.read(),
    retainedMemory,
    'Chat deletion does not silently change saved memory',
  );
  assert.deepEqual(legacy.assistant.state.observations, retainedObservations);
  const afterDeletion = harness({ config: { assistant_chat_file: legacyPath } });
  await afterDeletion.assistant.load();
  assert.deepEqual(afterDeletion.assistant.chatState(), deleted, 'Deletion survives a restart');
  await afterDeletion.assistant.chat('继续刚才的对话。', () => {});
  assert.ok(
    !requestSnapshot(afterDeletion.calls.at(-1)).conversation.some((message) => message.id === removed.id),
    'Deleted turns leave future model conversation input',
  );
  await assert.rejects(
    afterDeletion.assistant.deleteChat({ all: true, revision: deleted.chat_revision }),
    (error) => error.status === 409,
    'An old page cannot clear a newer turn',
  );
  const clearing = afterDeletion.assistant.deleteChat({
    all: true,
    revision: afterDeletion.assistant.chatState().chat_revision,
  });
  await assert.rejects(
    afterDeletion.assistant.chat('删除期间不能新增问答。', () => {}),
    (error) => error.status === 409,
  );
  await assert.rejects(
    afterDeletion.assistant.deleteChat({ all: true, revision: deleted.chat_revision }),
    (error) => error.status === 409,
  );
  assert.deepEqual((await clearing).messages, []);
  assert.equal(
    await readFile(afterDeletion.assistant.historyPath, 'utf8'),
    '',
    'Clear removes the entire archive, including turns outside the display budget',
  );
  const afterClear = harness({ config: { assistant_chat_file: legacyPath } });
  await afterClear.assistant.load();
  assert.deepEqual(afterClear.assistant.state.messages, []);
  await afterClear.assistant.chat('清空后仍可以聊天。', () => {});
  assert.equal(records(await readFile(afterClear.assistant.historyPath, 'utf8')).length, 1);
  const beforeFailedDelete = afterClear.assistant.chatState();
  await appendFile(afterClear.assistant.historyPath, '{incomplete');
  const damagedArchive = await readFile(afterClear.assistant.historyPath, 'utf8');
  await assert.rejects(afterClear.assistant.deleteChat({ all: true, revision: beforeFailedDelete.chat_revision }));
  assert.equal(
    await readFile(afterClear.assistant.historyPath, 'utf8'),
    damagedArchive,
    'A failed rewrite leaves the original archive untouched',
  );
  assert.deepEqual(afterClear.assistant.chatState(), beforeFailedDelete);
  assert.ok(
    !(await readdir(join(directory, 'legacy'))).some((name) => name.endsWith('.tmp')),
    'Failed deletion cleans its staging file',
  );

  const interrupted = harness({
    config: { assistant_chat_file: join(directory, 'interrupted', 'assistant-chat.json') },
  });
  await interrupted.assistant.load();
  const interrupt = new AbortController();
  await assert.rejects(
    interrupted.assistant.chat(
      '没有完成的一轮。',
      (event) => {
        if (event.type === 'delta') interrupt.abort();
      },
      interrupt.signal,
    ),
    (error) => error.name === 'AbortError',
  );
  assert.equal(
    await readFile(interrupted.assistant.historyPath, 'utf8'),
    '',
    'Cancellation before the archive commit writes no turn',
  );
  const actualPersist = interrupted.assistant.persist.bind(interrupted.assistant);
  const afterCommit = new AbortController();
  interrupted.assistant.persist = async (...args) => {
    const result = await actualPersist(...args);
    if (args[2]) afterCommit.abort();
    return result;
  };
  await interrupted.assistant.chat('已经完整交付的一轮。', () => {}, afterCommit.signal);
  await interrupted.assistant.maintenance;
  assert.equal(
    records(await readFile(interrupted.assistant.historyPath, 'utf8')).length,
    1,
    'Cancellation after a completed archive commit does not erase the turn',
  );

  const cachePath = join(directory, 'cache-failure', 'assistant-chat.json');
  const cacheFailure = harness({ config: { assistant_chat_file: cachePath } });
  await cacheFailure.assistant.load();
  const complete = cacheFailure.assistant.writer.complete.bind(cacheFailure.assistant.writer);
  let beforeCacheFailure;
  cacheFailure.assistant.writer.complete = async (...args) => {
    const result = await complete(...args);
    if (args[1]?.stream) {
      beforeCacheFailure = await readFile(cachePath, 'utf8');
      await mkdir(cachePath + '.tmp');
    }
    return result;
  };
  await cacheFailure.assistant.chat('缓存写入失败也不能丢掉完整对话。', () => {});
  await cacheFailure.assistant.maintenance;
  assert.equal(cacheFailure.assistant.state.messages.length, 2);
  assert.equal(await readFile(cachePath, 'utf8'), beforeCacheFailure);
  const cacheArchive = await readFile(cacheFailure.assistant.historyPath, 'utf8');
  assert.equal(records(cacheArchive).length, 1);
  const recovered = harness({ config: { assistant_chat_file: cachePath } });
  await recovered.assistant.load();
  assert.deepEqual(
    recovered.assistant.state.messages,
    cacheFailure.assistant.state.messages,
    'The archive recovers a turn even when the bounded cache could not be saved',
  );
  assert.equal(
    await readFile(recovered.assistant.historyPath, 'utf8'),
    cacheArchive,
    'Cache recovery never re-appends the committed turn',
  );

  await recovered.assistant.deleteChat({ all: true, revision: recovered.assistant.chatState().chat_revision });
  const deletionRecovery = harness({ config: { assistant_chat_file: cachePath } });
  await deletionRecovery.assistant.load();
  assert.deepEqual(deletionRecovery.assistant.state.messages, [], 'Cache write failure cannot resurrect a deletion');
  // Restore this fixture for the existing damaged-cache recovery checks below.
  await writeFile(recovered.assistant.historyPath, cacheArchive);

  await appendFile(archive, '{incomplete');
  const brokenHistory = harness(dialogueOptions);
  await brokenHistory.assistant.load();
  assert.equal(brokenHistory.assistant.historyError, true);
  const cacheBeforeRepair = await readFile(dialogueOptions.config.assistant_chat_file, 'utf8');
  brokenHistory.assistant.state.observations = [];
  await brokenHistory.assistant.context();
  await assert.rejects(
    brokenHistory.assistant.chat('不要覆盖损坏的历史。', () => {}),
    (error) => error.status === 503,
  );
  await assert.rejects(
    brokenHistory.assistant.deleteChat({ all: true, revision: brokenHistory.assistant.chatState().chat_revision }),
    (error) => error.status === 503,
  );
  assert.equal(
    await readFile(dialogueOptions.config.assistant_chat_file, 'utf8'),
    cacheBeforeRepair,
    'An unreadable archive cannot overwrite the session cache',
  );
  assert.equal(
    await readFile(archive, 'utf8'),
    archived + '{incomplete',
    'Archive corruption is never silently truncated or replaced',
  );

  const unreadableCachePath = join(directory, 'unreadable-cache', 'assistant-chat.json');
  await mkdir(join(directory, 'unreadable-cache'));
  const damagedCache = '{"messages":';
  await writeFile(unreadableCachePath, damagedCache);
  const unreadableCache = harness({ config: { assistant_chat_file: unreadableCachePath } });
  await unreadableCache.assistant.load();
  assert.equal(unreadableCache.assistant.historyError, true);
  await assert.rejects(
    readFile(unreadableCache.assistant.historyPath),
    (error) => error.code === 'ENOENT',
    'A damaged legacy cache is not migrated as an empty canonical history',
  );
  await assert.rejects(
    unreadableCache.assistant.chat('不要覆盖旧文件。', () => {}),
    (error) => error.status === 503,
  );
  await unreadableCache.assistant.context();
  assert.equal(await readFile(unreadableCachePath, 'utf8'), damagedCache);

  await writeFile(cachePath, damagedCache);
  const archiveRecovery = harness({ config: { assistant_chat_file: cachePath } });
  await archiveRecovery.assistant.load();
  assert.equal(
    archiveRecovery.assistant.historyError,
    false,
    'A valid authoritative archive remains usable when the bounded cache is damaged',
  );
  assert.deepEqual(archiveRecovery.assistant.state.messages, cacheFailure.assistant.state.messages);
  assert.equal(
    await readFile(cachePath, 'utf8'),
    damagedCache,
    'Loading recovers in memory without silently replacing the damaged cache',
  );
  assert.equal(await readFile(archiveRecovery.assistant.historyPath, 'utf8'), cacheArchive);

  const background = harness({
    respond: (body) => {
      const snapshot = requestSnapshot(body);
      return toolStream([
        { name: 'chat', arguments: { text: '后台不该主动说这句话。' } },
        { name: 'memory', arguments: { operations: [] } },
        {
          name: 'screen',
          arguments: { action: 'keep', lines: [], expires_at: null, base_version: snapshot.screen.version },
        },
      ]);
    },
  });
  await background.assistant.load();
  const backgroundMemory = await background.assistant.memory.read();
  assert.equal(await background.assistant.decide('manual', new Date()), true);
  assert.deepEqual(
    background.calls[0].tools.map((x) => x.function.name),
    ['screen'],
  );
  assert.equal(
    background.assistant.state.messages.length,
    0,
    'Background model chat output cannot initiate chat or enter history',
  );
  assert.deepEqual(await background.assistant.memory.read(), backgroundMemory, 'Background memory output is rejected');
  assert.equal(background.writes.length, 0, 'A valid keep checks current state without writing the screen');
  assert.deepEqual(await background.assistant.decide('manual', new Date(), { details: true }), {
    ok: true,
    status: 'kept',
  });

  let emptyScreen = { state: '', last_changed: new Date(+now - 3600000).toISOString() };
  const screenWrites = [];
  const emptyHa = {
    states: async (ids) => Object.fromEntries(ids.map((id) => [id, { ...emptyScreen }])),
    service: async (domain, name, payload) => {
      screenWrites.push({ domain, name, payload });
      emptyScreen = { state: payload.value, last_changed: now.toISOString() };
    },
  };
  const emptyContext = () => ({
    ...structuredClone(context),
    previous: emptyScreen.state ? { lines: emptyScreen.state.split('\n'), at: emptyScreen.last_changed } : undefined,
  });
  const firstNote = ['今天暂无后续日程，室内湿度为35%。'];
  const emptyScreenUpdate = harness({
    ha: emptyHa,
    context: emptyContext,
    respond: (body) => {
      const snapshot = requestSnapshot(body);
      assert.deepEqual(snapshot.screen.lines, [], 'An empty HA note reaches the model as an empty screen');
      return toolStream([
        {
          name: 'screen',
          arguments: {
            action: 'update',
            lines: firstNote,
            expires_at: snapshot.screen.suggested_expires_at,
            base_version: snapshot.screen.version,
            news_ids: [],
          },
        },
      ]);
    },
  });
  await emptyScreenUpdate.assistant.load();
  assert.deepEqual(await emptyScreenUpdate.assistant.decide('manual', now, { details: true }), {
    ok: true,
    status: 'updated',
  });
  assert.equal(screenWrites.length, 1);
  assert.equal(screenWrites[0].domain, 'input_text');
  assert.equal(screenWrites[0].name, 'set_value');
  assert.equal(emptyScreen.state, firstNote.join('\n'));
  assert.deepEqual(
    emptyScreenUpdate.assistant.writer.state.previous.lines,
    firstNote,
    'A confirmed first note is retained',
  );
  assert.deepEqual(
    (await emptyScreenUpdate.assistant.context(now)).previous.lines,
    firstNote,
    'The next context read displays the saved note',
  );

  const blockedScreen = harness({
    respond: (body) => {
      const snapshot = requestSnapshot(body);
      return toolStream([
        {
          name: 'screen',
          arguments: {
            action: 'update',
            lines: ['新的便条。'],
            expires_at: snapshot.screen.suggested_expires_at,
            base_version: snapshot.screen.version,
            news_ids: [],
          },
        },
      ]);
    },
  });
  await blockedScreen.assistant.load();
  assert.deepEqual(
    await blockedScreen.assistant.decide('manual', now, { details: true }),
    { ok: false, status: 'rejected', reason: 'minimum_stay' },
    'Manual checks preserve the actual rejection reason',
  );
  assert.equal(blockedScreen.writes.length, 0);

  let enteredBackground;
  let backgroundSignal;
  const backgroundEntered = new Promise((resolve) => {
    enteredBackground = resolve;
  });
  const priority = harness({
    respond: (body, assistant, request) => {
      if (body.tools.some((x) => x.function.name === 'screen')) {
        backgroundSignal = request.signal;
        enteredBackground();
        return new Promise((resolve, reject) => {
          if (request.signal.aborted) reject(request.signal.reason);
          else request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true });
        });
      }
      return toolStream([{ name: 'chat', arguments: { text: '先回复你的消息。' } }]);
    },
  });
  await priority.assistant.load();
  const pendingBackground = priority.assistant.decide('scheduled', new Date());
  await backgroundEntered;
  assert.equal(await priority.assistant.chat('先回复我。', () => {}), '先回复你的消息。');
  await pendingBackground;
  assert.equal(backgroundSignal.aborted, true, 'A user message preempts in-flight background inference');
  assert.equal(priority.calls.length, 2);
  assert.equal(priority.assistant.state.messages.length, 2);
  assert.equal(priority.writes.length, 0, 'A canceled background decision cannot later write the screen');

  const base = JSON.parse(await readFile(new URL('../../../ha-app/config.example.json', import.meta.url), 'utf8'));
  const api = harness({ config: { assistant_settings_file: join(directory, 'web-settings.json') } });
  await api.assistant.load();
  const token = 'test-token-with-at-least-24-characters';
  const app = createApp(
    { ...base, assistant_entities: [], entities: { ...base.entities, weather: '', co2: '' } },
    { DISPLAY_TOKEN: token },
    { assistant: api.assistant, ha: { states: async () => ({}) } },
  );
  const origin = 'http://display.test';
  const headers = { origin, host: 'display.test', 'content-type': 'application/json' };
  async function request(method, url, data, extraHeaders = {}) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    Object.assign(req, { method, url, headers: { ...headers, ...extraHeaders } });
    const res = new EventEmitter();
    Object.assign(res, { destroyed: false, writableEnded: false, headersSent: false });
    const chunks = [];
    const response = new Promise((resolve) => {
      res.writeHead = (code, responseHeaders = {}) =>
        Object.assign(res, { code, headers: responseHeaders, headersSent: true });
      res.write = (value) => {
        chunks.push(Buffer.from(value));
        return true;
      };
      res.end = (value) => {
        if (value) chunks.push(Buffer.from(value));
        res.writableEnded = true;
        resolve({
          code: res.code,
          headers: res.headers,
          text: Buffer.concat(chunks).toString(),
          json() {
            return JSON.parse(this.text);
          },
        });
      };
    });
    app.server.emit('request', req, res);
    return response;
  }
  assert.equal((await request('GET', '/')).code, 200, 'The public shell contains no private data');
  assert.equal((await request('GET', '/assets/markdown.js')).code, 200);
  for (const [method, path] of [
    ['GET', '/data'],
    ['POST', '/action'],
    ['GET', '/health'],
    ['GET', '/image'],
    ['GET', '/assistant/unknown'],
    ['POST', '/assistant/state'],
    ['GET', '/assistant/chat'],
    ['POST', '/assistant/memory'],
    ['GET', '/assistant/panel'],
  ])
    assert.equal((await request(method, path)).code, 401, `${method} ${path} retains display authentication`);
  assert.equal(
    (await request('GET', '/health', undefined, { authorization: 'Bearer ' + token, origin: undefined })).code,
    200,
    'Existing display authentication still works',
  );
  assert.equal((await request('GET', '/assistant/state', undefined, { origin: 'https://other.example' })).code, 403);
  assert.equal(
    (await request('POST', '/assistant/chat', { message: '看看今天。' }, { origin: 'https://other.example' })).code,
    403,
  );
  assert.equal((await request('PUT', '/assistant/settings', {}, { origin: 'https://other.example' })).code, 403);
  assert.equal((await request('DELETE', '/assistant/chat', {}, { origin: 'https://other.example' })).code, 403);
  const response = await request('GET', '/assistant/state');
  assert.equal(response.code, 200);
  const data = response.json();
  assert.ok(data.memory.long_term.revision);
  assert.equal(data.context.newsletter, undefined);
  assert.equal(data.settings.api_key_configured, true);
  assert.equal(JSON.stringify(data).includes('fake-private-model-key'), false);
  const settingsEdit = {
    options: { assistant_screen_times: ['09:00'], llm_model: 'updated-model' },
    revision: data.settings.revision,
  };
  assert.equal((await request('PUT', '/assistant/settings', settingsEdit)).code, 200);
  assert.equal(api.assistant.writer.model, 'updated-model');
  assert.equal((await request('PUT', '/assistant/settings', settingsEdit)).code, 409);
  const edit = { kind: 'short_term', text: '# 短期记忆\n今天想待在家里。', revision: data.memory.short_term.revision };
  assert.equal((await request('PUT', '/assistant/memory', edit)).code, 200);
  assert.equal((await request('PUT', '/assistant/memory', edit)).code, 409);
  const styleEdit = { kind: 'style', text: '请用自然中文表达。', revision: data.memory.style.revision };
  assert.equal((await request('PUT', '/assistant/memory', styleEdit)).code, 200);
  assert.equal((await api.assistant.memory.read()).style.text, styleEdit.text);
  const answer = await request('POST', '/assistant/chat', { message: '看看今天。' });
  assert.match(answer.headers['Content-Type'], /text\/event-stream/);
  assert.match(answer.text, /"type":"done"/);
  assert.ok(!answer.text.includes('PRIVATE_REASONING_SENTINEL'));
  const chatData = (await request('GET', '/assistant/state')).json();
  assert.ok(chatData.messages[0].id.startsWith('msg_'));
  assert.equal(chatData.history_writable, true);
  assert.equal((await request('DELETE', '/assistant/chat', { all: true })).code, 400);
  assert.equal((await request('DELETE', '/assistant/chat', { all: true, revision: 'old' })).code, 409);
  const deletedResponse = await request('DELETE', '/assistant/chat', {
    id: chatData.messages[0].id,
    revision: chatData.chat_revision,
  });
  assert.equal(deletedResponse.code, 200);
  assert.deepEqual(deletedResponse.json().messages, []);
  assert.deepEqual((await request('GET', '/assistant/state')).json().messages, []);
  await api.assistant.maintenance;
  let panelChecks = 0;
  let panelResult = { ok: true, status: 'kept' };
  api.assistant.decide = async (trigger, at, options) => {
    panelChecks++;
    assert.equal(trigger, 'manual');
    assert.equal(options.details, true);
    return panelResult;
  };
  const keptPanel = await request('POST', '/assistant/panel', {});
  assert.equal(keptPanel.code, 200);
  assert.equal(keptPanel.json().status, 'kept');
  assert.match(keptPanel.json().message, /保留/);
  assert.equal(panelChecks, 1, 'The public panel check reaches its handler');
  panelResult = { ok: true, status: 'kept', reason: 'empty' };
  const emptyPanel = await request('POST', '/assistant/panel', {});
  assert.equal(emptyPanel.code, 200);
  assert.equal(emptyPanel.json().reason, 'empty');
  assert.equal(emptyPanel.json().message, '已检查，当前没有需要显示的便条。');
  panelResult = { ok: false, status: 'rejected', reason: 'minimum_stay' };
  const blockedPanel = await request('POST', '/assistant/panel', {});
  assert.equal(blockedPanel.code, 503);
  assert.equal(blockedPanel.json().reason, 'minimum_stay');
  assert.match(blockedPanel.json().error, /15 分钟/);
  panelResult = { ok: true, status: 'updated' };
  assert.match((await request('POST', '/assistant/panel', {})).json().message, /屏幕下次同步/);

  const liveConfig = { ...base, entities: { ...base.entities, weather: '', co2: '' }, calendars: ['calendar.before'] };
  const reads = [];
  const liveHa = {
    states: async (ids) => {
      reads.push(ids);
      return Object.fromEntries(ids.map((id) => [id, { state: 'on', attributes: {} }]));
    },
    calendarEvents: async (id) => [event(id, '2026-11-08T18:00:00Z', '2026-11-08T19:00:00Z')],
  };
  const liveApp = createApp(liveConfig, { DISPLAY_TOKEN: token }, { ha: liveHa, now: () => now });
  const liveAssistant = new Assistant(liveConfig, {}, liveHa, liveApp.assistantContext);
  const beforeSources = await liveApp.assistantContext();
  assert.equal(beforeSources.schedule[0].title, 'calendar.before');
  liveAssistant.writer.applyOptions({
    ...(await liveAssistant.writer.currentOptions()),
    calendars: ['calendar.after'],
    assistant_presence_entities: ['binary_sensor.home'],
    assistant_entities: ['sensor.extra'],
  });
  const afterSources = await liveApp.assistantContext();
  assert.equal(
    afterSources.schedule[0].title,
    'calendar.after',
    'Saving calendar selection invalidates the old calendar cache',
  );
  assert.ok(reads.at(-1).includes('binary_sensor.home'));
  assert.ok(reads.at(-1).includes('sensor.extra'));
  assert.equal(afterSources.presence[0].state, 'on', 'New sources are read on the next request without restarting');
} finally {
  await rm(directory, { recursive: true, force: true });
}
console.log(
  'Assistant: shared news/context, one-call independent actions, evidence rejection, chat/background scope and preemption, archives/recovery/cancellation, calendar/DST and HTTP boundaries checked.',
);
