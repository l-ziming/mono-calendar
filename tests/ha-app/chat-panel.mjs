import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { assistantOptions } from '../../ha-app/server/assistant/settings.mjs';

// Run the real inline client with a small DOM and fake HTTP, without a browser or model.
const html = await readFile(new URL('../../ha-app/server/chat.html', import.meta.url), 'utf8');
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;$/m, '');
function element(tag = '') {
  return {
    tag,
    textContent: '',
    children: [],
    attributes: {},
    classList: { add() {}, toggle() {} },
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {},
  };
}
const elements = new Map();
const document = {
  createElement: element,
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  },
};
const state = {
  enabled: true,
  model: 'fake',
  messages: [],
  chat_revision: 'chat-0',
  history_writable: true,
  memory_status: 'idle',
  settings: { options: assistantOptions(), revision: 'settings-1', api_key_configured: true, writable: true },
  memory: Object.fromEntries(
    ['style', 'long_term', 'short_term'].map((kind) => [
      kind,
      { text: '', revision: '1', limit: 3000, writable: true },
    ]),
  ),
  context: { timezone: 'America/Denver', previous: { lines: ['旧便条。'] }, sources: { ha: 'ok' } },
};
let respond;
let confirmation = true;
const confirmations = [];
const client = await runInNewContext(`(async()=>{${script}\nreturn {renderContext,loadState};})()`, {
  document,
  smd: {
    default_renderer: (root) => ({ nodes: [root], index: 0 }),
    parser: (renderer) => renderer.nodes[0],
    parser_write(root, text) {
      root.textContent += text;
    },
    parser_end() {},
  },
  confirm(message) {
    confirmations.push(message);
    return confirmation;
  },
  clearTimeout() {},
  setTimeout() {},
  fetch: async (path, options) =>
    path === '/assistant/state' ? new Response(JSON.stringify(state)) : respond(path, options),
});
const section = () => elements.get('contextContent').children.find((box) => box.children[0].textContent === '屏幕便条');
const button = () => section().children.find((item) => item.tag === 'button');
const feedback = () => section().children.find((item) => item.attributes.role === 'status').textContent;

let finish;
respond = () =>
  new Promise((resolve) => {
    finish = resolve;
  });
const pending = button().onclick();
client.renderContext();
assert.equal(button().disabled, true, 'A context rerender cannot enable a duplicate manual request');
finish(new Response(JSON.stringify({ error: '尚未达到 15 分钟的更新间隔，请稍后再试。' }), { status: 503 }));
await pending;
assert.match(feedback(), /15 分钟/);
await client.loadState();
assert.match(feedback(), /15 分钟/, 'Polling must not erase a failed check');
assert.equal(button().disabled, false);

for (const message of ['已检查，保留原便条。', '便条已更新；屏幕下次同步时显示。']) {
  respond = async () => new Response(JSON.stringify({ ok: true, message }));
  await button().onclick();
  await client.loadState();
  assert.equal(feedback(), message, 'Success and keep remain distinct after reloading context');
}
respond = async () => {
  throw new Error('网络连接失败');
};
await button().onclick();
assert.equal(feedback(), '网络连接失败');
assert.equal(button().disabled, false);

const style = elements.get('styleMemory');
const saveStyle = elements.get('saveStyle');
style.value = '便条少重复同一个问题。';
style.oninput();
elements.get('longMemory').value = '尚未保存的长期记忆。';
elements.get('longMemory').oninput();
state.memory.style = { text: 'AI 新整理的表达偏好。', revision: '2', limit: 3000, writable: true };
await client.loadState();
assert.equal(style.value, '便条少重复同一个问题。', 'Polling preserves an unsaved style draft');
assert.equal(elements.get('longMemory').value, '尚未保存的长期记忆。');
respond = async (path, options) => {
  assert.equal(path, '/assistant/memory');
  assert.equal(options.method, 'PUT');
  assert.deepEqual(
    JSON.parse(options.body),
    { kind: 'style', text: style.value, revision: '1' },
    'A dirty editor retains its base revision when the server changes',
  );
  return new Response(JSON.stringify({ error: '记忆已更新，请重新载入后再保存。' }), { status: 409 });
};
await saveStyle.onclick();
assert.equal(style.value, '便条少重复同一个问题。', 'A conflict preserves the draft');
assert.match(elements.get('saveStatus').textContent, /重新载入/);

state.memory.style = { text: '', revision: '1', limit: 3000, writable: true };
respond = async (path, options) => {
  const payload = JSON.parse(options.body);
  assert.equal(payload.kind, 'style');
  assert.equal(payload.revision, '1');
  state.memory.style = { ...state.memory.style, text: payload.text, revision: '3' };
  return new Response(JSON.stringify({ memory: state.memory }));
};
await saveStyle.onclick();
await client.loadState();
assert.equal(state.memory.style.text, '便条少重复同一个问题。');
assert.equal(style.value, state.memory.style.text);
assert.equal(elements.get('saveStatus').textContent, '已保存');
state.memory.style = { ...state.memory.style, text: '新的已保存偏好。', revision: '4' };
await client.loadState();
assert.equal(style.value, '新的已保存偏好。', 'A saved editor follows subsequent server updates');
assert.equal(elements.get('longMemory').value, '尚未保存的长期记忆。', 'Saving style does not discard another draft');

const prompt = elements.get('assistant_prompt');
prompt.value = '网页编辑的提示词。';
prompt.oninput();
state.settings.options.assistant_prompt = '另一页修改的提示词。';
state.settings.revision = 'settings-2';
await client.loadState();
assert.equal(prompt.value, '网页编辑的提示词。', 'Polling preserves a settings draft');
respond = async (path, options) => {
  assert.equal(path, '/assistant/settings');
  assert.equal(options.method, 'PUT');
  const payload = JSON.parse(options.body);
  assert.equal(payload.revision, 'settings-1', 'An unsaved settings draft retains its base revision');
  assert.equal(payload.options.llm_api_key, undefined, 'A blank key editor retains the stored key');
  return new Response(JSON.stringify({ error: '设置已更新，请重新载入后再保存。' }), { status: 409 });
};
await elements.get('settingsForm').onsubmit({ preventDefault() {} });
assert.equal(prompt.value, '网页编辑的提示词。');
assert.match(elements.get('settingsStatus').textContent, /重新载入/);
state.settings.revision = 'settings-1';
respond = async (path, options) => {
  const payload = JSON.parse(options.body);
  state.settings = { ...state.settings, options: payload.options, revision: 'settings-3' };
  return new Response(JSON.stringify({ settings: state.settings }));
};
await elements.get('settingsForm').onsubmit({ preventDefault() {} });
assert.equal(state.settings.options.assistant_prompt, '网页编辑的提示词。');
assert.match(elements.get('settingsStatus').textContent, /已保存/);
state.settings.options.assistant_prompt = '之后保存的新提示词。';
state.settings.revision = 'settings-4';
await client.loadState();
assert.equal(prompt.value, '之后保存的新提示词。');
assert.equal(elements.get('longMemory').value, '尚未保存的长期记忆。');

state.messages = [
  { id: 'user-1', role: 'user', content: '第一轮问题' },
  { id: 'answer-1', role: 'assistant', content: '第一轮回复' },
  { id: 'user-2', role: 'user', content: '第二轮问题' },
  { id: 'answer-2', role: 'assistant', content: '第二轮回复' },
];
state.chat_revision = 'chat-1';
await client.loadState(true);
const messages = () => elements.get('messages').children;
const deleteButton = () => messages()[0].children.at(-1).children[0];
assert.equal(messages().length, 4);
assert.equal(deleteButton().textContent, '删除这一轮');
assert.equal(elements.get('clearChat').disabled, false);
confirmation = false;
respond = async () => {
  throw new Error('A canceled deletion must not make an HTTP request');
};
await deleteButton().onclick();
assert.equal(messages().length, 4);
assert.match(confirmations.at(-1), /记忆/);
confirmation = true;
respond = async () => new Response(JSON.stringify({ error: '对话已更新，请刷新后再删除。' }), { status: 409 });
await deleteButton().onclick();
assert.equal(messages().length, 4);
assert.match(elements.get('chatStatus').textContent, /刷新/);
assert.equal(deleteButton().disabled, false);

let finishDelete;
respond = (path, options) => {
  assert.equal(path, '/assistant/chat');
  assert.equal(options.method, 'DELETE');
  assert.deepEqual(JSON.parse(options.body), { id: 'user-1', revision: 'chat-1' });
  return new Promise((resolve) => {
    finishDelete = resolve;
  });
};
const pendingDelete = deleteButton().onclick();
assert.equal(deleteButton().disabled, true);
assert.equal(elements.get('clearChat').disabled, true);
assert.equal(elements.get('sendButton').disabled, true);
state.messages = state.messages.slice(2);
state.chat_revision = 'chat-2';
finishDelete(
  new Response(
    JSON.stringify({ messages: state.messages, chat_revision: state.chat_revision, history_writable: true }),
  ),
);
await pendingDelete;
assert.equal(messages().length, 2);
assert.equal(messages()[0].children[1].textContent, '第二轮问题');
assert.match(elements.get('chatStatus').textContent, /已删除/);
assert.equal(elements.get('longMemory').value, '尚未保存的长期记忆。');

state.enabled = false;
await client.loadState();
assert.equal(elements.get('clearChat').disabled, false, 'Deleting history does not need a model API key');
respond = async (path, options) => {
  assert.deepEqual(JSON.parse(options.body), { all: true, revision: 'chat-2' });
  state.messages = [];
  state.chat_revision = 'chat-3';
  return new Response(JSON.stringify({ messages: [], chat_revision: state.chat_revision, history_writable: true }));
};
await elements.get('clearChat').onclick();
assert.equal(messages().length, 0);
assert.equal(elements.get('clearChat').disabled, true);
await client.loadState(true);
assert.equal(messages().length, 0, 'An empty history clears previously rendered messages');
assert.equal(elements.get('longMemory').value, '尚未保存的长期记忆。');
state.messages = [
  { id: 'user-3', role: 'user', content: '另一页新消息' },
  { role: 'assistant', content: '回复' },
];
state.chat_revision = 'chat-4';
state.enabled = true;
state.busy = true;
await client.loadState();
assert.equal(deleteButton().disabled, true);
assert.equal(elements.get('clearChat').disabled, true);
state.busy = false;
state.history_writable = false;
await client.loadState();
assert.equal(deleteButton().disabled, true);
console.log(
  'Chat panel: deletion/clear, confirmation, conflicts, busy controls, feedback and unsaved editor preservation checked.',
);
