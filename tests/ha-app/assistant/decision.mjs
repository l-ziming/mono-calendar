import assert from 'node:assert/strict';
import {
  decisionTools,
  readDecision,
  estimateTokens,
  historyWindow,
  messageId,
} from '../../../ha-app/server/assistant/decision.mjs';

const frame = (value) => 'data: ' + JSON.stringify(value) + '\n\n';
const tool = (index, name, args) => ({
  choices: [
    { delta: { tool_calls: [{ index, type: 'function', id: 'call_' + index, function: { name, arguments: args } }] } },
  ],
});
const fragment = (index, args) => ({
  choices: [{ delta: { tool_calls: [{ index, function: { arguments: args } }] } }],
});
const finished = (reason) => ({ choices: [{ delta: {}, finish_reason: reason }] });
function streamed(frames, { done = true, size = 7 } = {}) {
  const bytes = new TextEncoder().encode(frames.map(frame).join('') + (done ? 'data: [DONE]\n\n' : ''));
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
        controller.close();
      },
    }),
  );
}
const names = (trigger) => decisionTools(trigger).map((x) => x.function.name);
assert.deepEqual(names('chat'), ['chat', 'memory', 'read_news']);
assert.deepEqual(names('screen'), ['screen']);
assert.throws(() => decisionTools('background'));
const changed = decisionTools('chat');
changed[0].function.parameters.properties.text.type = 'number';
assert.equal(
  decisionTools('chat')[0].function.parameters.properties.text.type,
  'string',
  'Callers cannot mutate shared schemas',
);
const boundSnapshot = {
  current_user_id: 'current-user',
  memory: { long_term: { revision: 'revision-long' }, short_term: { revision: 'revision-short' } },
  screen: { version: 'screen-version', expiry_options: ['2026-11-09T16:00:00Z', '2026-11-09T17:00:00Z'] },
  news: [{ id: 'news-1' }, { id: 'news-2' }],
};
const boundChat = decisionTools('chat', { snapshot: boundSnapshot });
const memoryParameters = boundChat.find((tool) => tool.function.name === 'memory').function.parameters.properties
  .operations.items.properties;
assert.deepEqual(memoryParameters.evidence.items.properties.message_id.enum, ['current-user']);
assert.deepEqual(memoryParameters.base_revision.enum, ['revision-long', 'revision-short']);
assert.deepEqual(
  boundChat.find((tool) => tool.function.name === 'read_news').function.parameters.properties.ids.items.enum,
  ['news-1', 'news-2'],
);
const boundScreen = decisionTools('screen', { snapshot: boundSnapshot })[0].function.parameters.properties;
assert.deepEqual(boundScreen.base_version.enum, ['screen-version']);
assert.deepEqual(boundScreen.expires_at.enum, [null, ...boundSnapshot.screen.expiry_options]);
assert.deepEqual(boundScreen.news_ids.items.enum, ['news-1', 'news-2']);
const explicitUser = decisionTools('chat', { currentUserId: 'explicit-current', snapshot: boundSnapshot });
assert.deepEqual(
  explicitUser.find((tool) => tool.function.name === 'memory').function.parameters.properties.operations.items
    .properties.evidence.items.properties.message_id.enum,
  ['explicit-current'],
);
assert.deepEqual(
  decisionTools('chat', { snapshot: { news: [] } }).map((tool) => tool.function.name),
  ['chat', 'memory'],
  'No unusable read tool for an empty news snapshot',
);
assert.equal(
  decisionTools('screen', { snapshot: { news: [] } })[0].function.parameters.properties.news_ids.maxItems,
  0,
);
assert.equal(
  decisionTools('screen')[0].function.parameters.properties.expires_at.enum,
  undefined,
  'Unbound calls remain unchanged',
);
assert.equal(memoryParameters.id.enum, undefined, 'Binding evidence does not accidentally constrain entry IDs');
assert.equal(
  memoryParameters.context_ids.items.enum,
  undefined,
  'Antecedent IDs remain separate from current user evidence',
);
assert.equal(boundScreen.lines.items.enum, undefined, 'Binding news IDs does not constrain screen text');

const events = [];
let result = await readDecision(
  streamed([
    { choices: [{ delta: { reasoning_content: 'DO_NOT_RETAIN_PRIVATE_REASONING' } }] },
    tool(0, 'chat', '{"text":"白茶'),
    fragment(0, '续水三道。😀"}'),
    tool(1, 'memory', '{broken json}'),
    finished('tool_calls'),
    { choices: [], usage: { prompt_tokens: 42, completion_tokens: 9 } },
  ]),
  { send: (event) => events.push(event) },
);
assert.equal(result.complete, true);
assert.equal(result.chat, '白茶续水三道。😀');
assert.equal(result.action_complete.chat, true);
assert.equal(result.memory, undefined);
assert.ok(result.errors.some((x) => x.action === 'memory' && x.code === 'invalid_json'));
assert.deepEqual(result.usage, { prompt_tokens: 42, completion_tokens: 9 });
assert.deepEqual(events, [{ type: 'delta', text: result.chat }]);
assert.ok(!JSON.stringify(result).includes('PRIVATE_REASONING'));
assert.ok(!JSON.stringify(events).includes('PRIVATE_REASONING'));

result = await readDecision(
  streamed([tool(0, 'chat', '{"text":"已完成的回复"}'), tool(1, 'memory', '{"operations":[')], {
    done: false,
    size: 1,
  }),
);
assert.equal(result.complete, false);
assert.equal(result.chat, '已完成的回复');
assert.equal(result.action_complete.chat, true, 'A closed chat action survives an unfinished memory action');
assert.equal(result.action_complete.memory, false);
const lateArgumentEvents = [];
result = await readDecision(
  streamed([
    tool(0, 'chat', '{"text":"已显示但最终参数不合法"}'),
    fragment(0, ' unexpected trailing arguments'),
    tool(1, 'memory', '{"operations":[]}'),
    finished('tool_calls'),
  ]),
  { send: (event) => lateArgumentEvents.push(event) },
);
assert.equal(
  result.chat,
  undefined,
  'Early previews cannot certify an action whose final full arguments are malformed',
);
assert.equal(result.action_complete.chat, false);
assert.equal(result.action_complete.memory, true);
assert.equal(result.chat_source, 'invalid_tool');
assert.equal(result.visible_text, '已显示但最终参数不合法');
assert.ok(
  lateArgumentEvents.some((event) => event.text.includes('已显示')),
  'A rejected preview is left incomplete rather than archived as a complete answer',
);
result = await readDecision(
  streamed([
    tool(0, 'chat', '{"text":"整个聊天动作已闭合"}'),
    tool(1, 'memory', '{"operations":['),
    finished('length'),
  ]),
);
assert.equal(result.complete, false);
assert.equal(result.action_complete.chat, true);
assert.equal(result.chat, '整个聊天动作已闭合');
assert.equal(result.action_complete.memory, false);
result = await readDecision(streamed([tool(0, 'chat', '{"text":"聊天动作本身未闭合'), finished('length')]));
assert.equal(result.chat, undefined);
assert.equal(result.action_complete.chat, false);

result = await readDecision(
  streamed([
    { choices: [{ delta: { content: '正常' } }] },
    { choices: [{ delta: { content: '聊天。' } }] },
    finished('stop'),
  ]),
);
assert.equal(result.chat, '正常聊天。');
assert.equal(result.action_complete.chat, true);
const mixedEvents = [];
result = await readDecision(
  streamed([
    { choices: [{ delta: { content: '好的，我来处理。' } }] },
    tool(0, 'chat', '{"text":"这是实际回答。"}'),
    tool(1, 'memory', '{broken}'),
    finished('tool_calls'),
  ]),
  { send: (event) => mixedEvents.push(event) },
);
assert.equal(
  result.chat,
  '好的，我来处理。\n\n这是实际回答。',
  'Native content plus a chat tool retains the substantive answer',
);
assert.equal(mixedEvents.map((x) => x.text).join(''), result.chat, 'UI text and archived text are identical');
assert.equal(result.action_complete.chat, true);
assert.equal(result.chat_source, 'tool');
result = await readDecision(
  streamed([tool(0, 'chat', '{"text":"完整回答。"}'), { choices: [{ delta: { content: '未完成的补充' } }] }], {
    done: false,
  }),
);
assert.equal(result.chat, '完整回答。\n\n未完成的补充');
assert.equal(result.action_complete.chat, false);
result = await readDecision(streamed([{ choices: [{ delta: { content: '半截聊天' } }] }], { done: false }));
assert.equal(result.chat, '半截聊天');
assert.equal(result.action_complete.chat, false);

result = await readDecision(
  streamed([
    tool(0, 'memory', '{bad}'),
    tool(1, 'memory', '{"operations":[]}'),
    tool(2, 'memory', '{"operations":[1]}'),
    tool(3, 'screen', '{"action":"keep","lines":[],"expires_at":null,"base_version":"abc"}'),
    finished('tool_calls'),
  ]),
);
assert.deepEqual(result.memory, { operations: [] }, 'The first valid action wins');
assert.ok(result.errors.some((x) => x.action === 'memory' && x.code === 'duplicate_action'));
assert.equal(result.screen.action, 'keep');
assert.equal(result.action_complete.screen, true);
result = await readDecision(
  streamed([tool(0, 'read_news', '{"ids":["news_a","news_b"]}'), tool(1, 'memory', '{bad}'), finished('tool_calls')]),
);
assert.deepEqual(result.read_news, { ids: ['news_a', 'news_b'] });
assert.equal(result.action_complete.read_news, true);
assert.equal(result.chat, undefined);
assert.ok(result.errors.some((x) => x.action === 'memory'));
result = await readDecision(
  streamed([
    { choices: [{ delta: { content: '我看看原文。' } }] },
    tool(0, 'read_news', '{"ids":["news_a"]}'),
    finished('tool_calls'),
  ]),
);
assert.equal(result.chat, '我看看原文。');
assert.equal(result.chat_source, 'content');
assert.equal(
  result.action_complete.chat,
  false,
  'A prefetch introduction must not suppress the requested article read',
);
assert.equal(result.action_complete.read_news, true);
result = await readDecision(
  streamed([
    tool(0, 'chat', '{"text":"已有完整答案。"}'),
    tool(1, 'read_news', '{"ids":["news_a"]}'),
    finished('tool_calls'),
  ]),
);
assert.equal(result.action_complete.chat, true);
assert.equal(result.chat_source, 'tool');

result = await readDecision(
  streamed([
    tool(0, 'chat', '{"text":3}'),
    tool(1, 'chat', '{"text":"合法回复"}'),
    tool(2, 'chat', '{"text":"重复回复"}'),
    tool(3, 'system_command', '{"do":"bad"}'),
    finished('tool_calls'),
  ]),
);
assert.equal(result.chat, '合法回复');
assert.ok(result.errors.some((x) => x.code === 'duplicate_action'));
assert.ok(result.errors.some((x) => x.code === 'unknown_action'));

result = await readDecision(
  streamed([tool(0, 'chat', '{"text":"仍然保留"}'), tool(1, 'memory', 'x'.repeat(65537)), finished('tool_calls')], {
    size: 2048,
  }),
);
assert.equal(result.chat, '仍然保留');
assert.equal(result.memory, undefined);
assert.ok(result.errors.some((x) => x.code === 'arguments_limit'));
result = await readDecision(
  streamed(
    [
      tool(0, 'memory', 'x'.repeat(60000)),
      fragment(0, 'x'.repeat(60000)),
      fragment(0, 'x'.repeat(60000)),
      tool(1, 'chat', '{"text":"畸形记忆后仍能交付回复"}'),
      finished('tool_calls'),
    ],
    { size: 2048 },
  ),
);
assert.equal(result.complete, true);
assert.equal(result.chat, '畸形记忆后仍能交付回复');

result = await readDecision(
  streamed(
    [
      tool(0, 'chat', '{"text":"缓冲限制前完成"}'),
      tool(1, 'memory', 'x'.repeat(65536)),
      tool(2, 'screen', 'x'.repeat(65536)),
      finished('tool_calls'),
    ],
    { size: 2048 },
  ),
);
assert.equal(result.transportError, 'buffer_limit');
assert.equal(result.chat, '缓冲限制前完成');

result = await readDecision(
  new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame(tool(0, 'chat', '{"text":"传输损坏前完成"}'))));
        controller.enqueue(new TextEncoder().encode('data: {not-json}\n\n'));
        controller.close();
      },
    }),
  ),
);
assert.equal(result.transportError, 'stream_error');
assert.equal(result.chat, '传输损坏前完成');

result = await readDecision({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: '1', type: 'function', function: { name: 'chat', arguments: '{"text":"非流式兼容"}' } }],
      },
    },
  ],
});
assert.equal(result.chat, '非流式兼容');
assert.equal(result.complete, true);

const controller = new AbortController();
controller.abort();
result = await readDecision(streamed([tool(0, 'chat', '{"text":"不会提交"}')]), { signal: controller.signal });
assert.equal(result.transportError, 'aborted');
assert.equal(result.chat, undefined);

const message = { role: 'user', at: '2026-11-09T00:00:00Z', content: '你好' };
assert.equal(messageId(message), messageId(structuredClone(message)));
assert.notEqual(messageId(message), messageId({ ...message, role: 'assistant' }));
assert.equal(messageId({ ...message, id: 'server-id' }), 'server-id');
assert.equal(estimateTokens('中😀'), 7);
const history = Array.from({ length: 12 }, (_, index) => ({
  role: index % 2 ? 'assistant' : 'user',
  at: String(index),
  content: '第' + index + '条',
}));
const lastCost = estimateTokens(JSON.stringify(history.slice(-2))) + 16;
assert.deepEqual(historyWindow(history, lastCost), history.slice(-2));
assert.deepEqual(historyWindow(history, lastCost - 1), [], 'An oversized latest turn is not silently admitted');
assert.deepEqual(historyWindow(history, 0), []);
assert.equal(historyWindow(history, 20000).length, 12);
assert.deepEqual(historyWindow([...history, { role: 'user', content: '未完成' }], lastCost), history.slice(-2));
assert.throws(() => historyWindow(history, -1));
console.log(
  'Independent decision actions, bounded SSE/UTF-8, malformed/partial responses, secret-free reasoning, stable message IDs and full-turn token budgets checked.',
);
