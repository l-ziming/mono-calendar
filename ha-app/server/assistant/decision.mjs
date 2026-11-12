import { fingerprint } from './audit.mjs';
import { MEMORY_ACTION_LIMITS } from './memory.mjs';

const MAX_BUFFER = 128 * 1024;
const MAX_ARGUMENTS = 64 * 1024;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = { type: 'string' };
const nullableString = { type: ['string', 'null'] };
const schema = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const definitions = {
  chat: {
    description: '回复当前用户。先提供聊天回复；不要把屏幕或记忆动作内容放入回复。',
    parameters: schema({ text: { type: 'string', minLength: 1, maxLength: 32000 } }, ['text']),
  },
  read_news: {
    description:
      '仅在现有新闻短条目不足以回答用户问题时请求正文，使用资料中已有的新闻 ID，最多两条。需要正文时先提出此请求，不先写等待式聊天回复。',
    parameters: schema({ ids: { type: 'array', items: string, minItems: 1, maxItems: 2, uniqueItems: true } }, ['ids']),
  },
  screen: {
    description: '决定是否更新墨水屏；没有必要更新时保持。只提出动作，程序校验版本、频率和有效期后执行。',
    parameters: schema(
      {
        action: { type: 'string', enum: ['keep', 'update', 'clear'] },
        lines: { type: 'array', items: string, maxItems: 4 },
        expires_at: nullableString,
        base_version: string,
        news_ids: { type: 'array', items: string, maxItems: 10 },
        reason: { type: 'string', maxLength: 240 },
      },
      ['action', 'lines', 'expires_at', 'base_version'],
    ),
  },
  memory: {
    description: '可选的记忆增量操作。每项必须引用本轮用户消息及原文证据；不能用新闻、环境或助手建议作为用户事实。',
    parameters: schema(
      {
        operations: {
          type: 'array',
          maxItems: MEMORY_ACTION_LIMITS.operations,
          items: schema(
            {
              op: { type: 'string', enum: ['add', 'update', 'delete'] },
              kind: { type: 'string', enum: ['long_term', 'short_term', 'style'] },
              id: string,
              base_revision: string,
              text: { type: 'string', maxLength: 6000 },
              evidence: {
                type: 'array',
                minItems: 1,
                maxItems: MEMORY_ACTION_LIMITS.evidence,
                items: schema({ message_id: string, quote: { type: 'string', minLength: 1, maxLength: 8000 } }, [
                  'message_id',
                  'quote',
                ]),
              },
              context_ids: { type: 'array', items: string, maxItems: MEMORY_ACTION_LIMITS.contextIds },
              expires_at: nullableString,
            },
            ['op', 'kind', 'base_revision', 'evidence'],
          ),
        },
        reason: { type: 'string', maxLength: 240 },
      },
      ['operations'],
    ),
  },
};

/** Separate terminal actions, not one all-or-nothing generated JSON envelope. */
export function decisionTools(trigger, { currentUserId, snapshot } = {}) {
  if (!['chat', 'screen'].includes(trigger)) throw new Error('Invalid decision trigger');
  const tools = (trigger === 'chat' ? ['chat', 'memory', 'read_news'] : ['screen']).map((name) => ({
    type: 'function',
    function: { name, ...structuredClone(definitions[name]) },
  }));
  const parameters = Object.fromEntries(tools.map((tool) => [tool.function.name, tool.function.parameters.properties]));
  const userId = currentUserId ?? snapshot?.current_user_id;
  if (parameters.memory) {
    const operation = parameters.memory.operations.items.properties;
    if (typeof userId === 'string' && userId) {
      operation.evidence.items.properties.message_id = {
        ...operation.evidence.items.properties.message_id,
        enum: [userId],
        description: '必须复制本轮 current_user_id；不是 decision.id、新闻 ID 或记忆条目 ID。',
      };
    }
    const revisions = [
      ...new Set(
        Object.values(snapshot?.memory || {})
          .map((doc) => doc?.revision)
          .filter((value) => typeof value === 'string' && value),
      ),
    ];
    if (revisions.length) {
      operation.base_revision = {
        ...operation.base_revision,
        enum: revisions,
        description: '从对应 kind 的 memory 文档复制 revision。',
      };
    }
  }
  if (parameters.screen && snapshot?.screen) {
    if (typeof snapshot.screen.version === 'string') {
      parameters.screen.base_version = {
        ...parameters.screen.base_version,
        enum: [snapshot.screen.version],
        description: '必须复制 screen.version，不是 decision.id。',
      };
    }
    if (Array.isArray(snapshot.screen.expiry_options)) {
      parameters.screen.expires_at = {
        ...parameters.screen.expires_at,
        enum: [null, ...new Set(snapshot.screen.expiry_options.filter((value) => typeof value === 'string'))],
        description:
          'update 从 screen.expiry_options 原样选择一个时间；keep 或 clear 填 null。不得自行计算时区或延长时间。',
      };
    }
  }
  if (snapshot && Array.isArray(snapshot.news)) {
    const ids = [
      ...new Set(snapshot.news.map((article) => article?.id).filter((value) => typeof value === 'string' && value)),
    ];
    for (const list of [parameters.screen?.news_ids, parameters.read_news?.ids].filter(Boolean)) {
      if (ids.length) list.items = { ...list.items, enum: ids };
      else {
        list.minItems = 0;
        list.maxItems = 0;
        list.description = '当前无新闻候选，只能为空；不要请求读取新闻。';
      }
    }
    if (!ids.length) {
      const index = tools.findIndex((tool) => tool.function.name === 'read_news');
      if (index >= 0) tools.splice(index, 1);
    }
  }
  return tools;
}

/** Conservative byte-based token budget, not a model-specific tokenizer count. */
export function estimateTokens(text) {
  return Buffer.byteLength(String(text ?? ''), 'utf8');
}
export function messageId(message) {
  if (typeof message?.id === 'string' && message.id) return message.id;
  return 'msg_' + fingerprint([message?.role, message?.at, message?.content]).slice(0, 24);
}
export function historyWindow(messages, tokenBudget) {
  if (!Number.isInteger(tokenBudget) || tokenBudget < 0) throw new Error('Invalid context budget');
  const pairs = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const user = messages[i];
    const assistant = messages[i + 1];
    if (
      user?.role === 'user' &&
      assistant?.role === 'assistant' &&
      typeof user.content === 'string' &&
      typeof assistant.content === 'string'
    ) {
      pairs.push([user, assistant]);
      i++;
    }
  }
  let used = 0;
  let start = pairs.length;
  for (let i = pairs.length - 1; i >= 0; i--) {
    const cost = estimateTokens(JSON.stringify(pairs[i])) + 16;
    if (used + cost > tokenBudget) break;
    used += cost;
    start = i;
  }
  return pairs.slice(start).flat();
}

/** Parse independent tool calls. Completed actions survive a later truncated stream. */
export async function readDecision(response, { send = () => {}, signal } = {}) {
  const result = {
    errors: [],
    complete: false,
    action_complete: { chat: false, screen: false, memory: false, read_news: false },
  };
  const calls = new Map();
  let content = '';
  let contentBytes = 0;
  let buffered = 0;
  let done = false;
  let finish = null;
  let chatChannel = '';
  let visibleChat = '';
  let lastVisibleChannel = '';
  const error = (action, code) => result.errors.push({ action, code });
  const reserve = (length) => {
    if ((buffered += length) > MAX_BUFFER) throw new Error('buffer_limit');
  };
  const publish = (text, channel) => {
    if (!text) return;
    if (channel !== 'content') {
      if (chatChannel && chatChannel !== channel) return;
      chatChannel = channel;
    }
    if (visibleChat && lastVisibleChannel && lastVisibleChannel !== channel) {
      visibleChat += '\n\n';
      send({ type: 'delta', text: '\n\n' });
    }
    visibleChat += text;
    lastVisibleChannel = channel;
    send({ type: 'delta', text });
  };
  const validChat = (value) =>
    object(value) &&
    Object.keys(value).every((key) => key === 'text') &&
    typeof value.text === 'string' &&
    Boolean(value.text.trim()) &&
    [...value.text].length <= 32000;
  const accept = (name, value, channel, previewed) => {
    if (!Object.hasOwn(definitions, name)) {
      error('unknown', 'unknown_action');
      return;
    }
    if (!object(value)) {
      error(name, 'invalid_arguments');
      return;
    }
    if (name === 'chat' && !validChat(value)) {
      error(name, 'invalid_arguments');
      return;
    }
    if (Object.hasOwn(result, name)) {
      error(name, 'duplicate_action');
      return;
    }
    if (name === 'chat') {
      if (chatChannel && chatChannel !== channel) {
        error('chat', 'duplicate_action');
        return;
      }
      if (previewed !== value.text) publish(value.text, channel);
      result.chat = visibleChat;
      result.chat_source = 'tool';
    } else result[name] = value;
    result.action_complete[name] = true;
  };
  const updateCall = (part, fallbackIndex) => {
    const index = part.index ?? fallbackIndex;
    if (!Number.isInteger(index) || index < 0 || index > 31) {
      error('unknown', 'invalid_tool_index');
      return;
    }
    if (!calls.has(index)) calls.set(index, { name: '', args: '', bytes: 0, invalid: false });
    const call = calls.get(index);
    const fn = part.function;
    if (!object(fn)) return;
    if (typeof fn.name === 'string') {
      if (call.name && call.name !== fn.name) call.invalid = true;
      else call.name = fn.name.slice(0, 128);
    }
    if (typeof fn.arguments === 'string') {
      if (call.invalid) return;
      const bytes = Buffer.byteLength(fn.arguments);
      if (call.bytes + bytes > MAX_ARGUMENTS) {
        buffered -= call.bytes;
        call.args = '';
        call.bytes = 0;
        call.invalid = true;
        error(Object.hasOwn(definitions, call.name) ? call.name : 'unknown', 'arguments_limit');
        return;
      }
      reserve(bytes);
      call.bytes += bytes;
      call.args += fn.arguments;
      // Deliver a completed chat action without waiting for optional memory arguments.
      // Partial JSON strings are deliberately not guessed into visible text.
      if (!call.invalid && call.name === 'chat' && call.previewed === undefined && call.args.trimEnd().endsWith('}')) {
        try {
          const value = JSON.parse(call.args);
          if (validChat(value)) {
            call.previewed = value.text;
            publish(value.text, 'tool_' + index);
          }
        } catch {
          /* A later argument fragment may finish this JSON object. */
        }
      }
    }
  };
  const chunk = (value) => {
    if (!object(value)) throw new Error('invalid_chunk');
    if (value.error) throw new Error('upstream_error');
    if (object(value.usage)) result.usage = value.usage;
    const choice = value.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta ?? choice.message;
    if (!object(delta)) return;
    if (typeof delta.content === 'string' && delta.content) {
      const bytes = Buffer.byteLength(delta.content);
      reserve(bytes);
      contentBytes += bytes;
      if (contentBytes > MAX_ARGUMENTS) throw new Error('content_limit');
      content += delta.content;
      publish(delta.content, 'content');
    }
    if (Array.isArray(delta.tool_calls)) delta.tool_calls.forEach(updateCall);
    // reasoning_content is deliberately ignored and never retained.
  };
  const finalizeCalls = () => {
    for (const [index, call] of calls) {
      const name = Object.hasOwn(definitions, call.name) ? call.name : 'unknown';
      if (call.invalid) {
        error(name, 'invalid_arguments');
        continue;
      }
      let value;
      try {
        value = JSON.parse(call.args);
      } catch {
        error(name, 'invalid_json');
        continue;
      }
      accept(call.name, value, 'tool_' + index, call.previewed);
    }
    if (Object.hasOwn(result, 'chat')) {
      result.chat = visibleChat;
      if (lastVisibleChannel === 'content' && !result.complete) result.action_complete.chat = false;
    } else if (content) {
      result.chat = visibleChat;
      result.chat_source = 'content';
      // Native content alongside a read request is an introduction, not the final answer.
      result.action_complete.chat = result.complete && !chatChannel && !result.read_news;
    }
  };
  try {
    if (response?.body) {
      let pending = '';
      let frames = 0;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const line = (value) => {
        if (!value.startsWith('data:')) return;
        const data = value.slice(5).trim();
        if (!data) return;
        if (++frames > 16384) throw new Error('frame_limit');
        if (data === '[DONE]') {
          done = true;
          return;
        }
        if (done) return;
        chunk(JSON.parse(data));
      };
      for await (const bytes of response.body) {
        signal?.throwIfAborted();
        if (bytes.byteLength > MAX_BUFFER) throw new Error('buffer_limit');
        pending += decoder.decode(bytes, { stream: true });
        let end;
        while ((end = pending.indexOf('\n')) !== -1) {
          line(pending.slice(0, end).replace(/\r$/, ''));
          pending = pending.slice(end + 1);
        }
        if (Buffer.byteLength(pending) > MAX_BUFFER) throw new Error('buffer_limit');
      }
      pending += decoder.decode();
      if (pending.trim()) line(pending.replace(/\r$/, ''));
      signal?.throwIfAborted();
    } else {
      chunk(typeof response?.json === 'function' ? await response.json() : response);
      done = true;
      signal?.throwIfAborted();
    }
    result.complete = done && ['stop', 'tool_calls'].includes(finish);
    if (!result.complete) error('transport', 'incomplete_response');
  } catch (cause) {
    let code = 'stream_error';
    if (signal?.aborted) code = 'aborted';
    else if (
      ['buffer_limit', 'frame_limit', 'content_limit', 'upstream_error', 'invalid_chunk'].includes(cause.message)
    )
      code = cause.message;
    result.transportError = code;
    error('transport', code);
  }
  finalizeCalls();
  if (visibleChat) result.visible_text = visibleChat;
  if (chatChannel && !result.action_complete.chat && result.chat_source !== 'tool') result.chat_source = 'invalid_tool';
  result.finish_reason = finish;
  if (typeof result.screen?.reason === 'string') result.reason = result.screen.reason.slice(0, 240);
  else if (typeof result.memory?.reason === 'string') result.reason = result.memory.reason.slice(0, 240);
  return result;
}
