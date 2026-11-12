const initial = {
  assistant_presence_entities: [],
  assistant_screen_times: ['06:30', '11:30', '16:30', '21:00'],
  assistant_screen_min_minutes: 15,
  assistant_screen_max_per_hour: 4,
  assistant_screen_quiet_start: '23:00',
  assistant_screen_quiet_end: '06:00',
  assistant_context_tokens: 32768,
  assistant_memory_ttl_days: 14,
};
const validClockTime = (value) => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function settingValue(options, defaults, key, fallback) {
  if (Object.hasOwn(options, key)) return options[key];
  if (Object.hasOwn(defaults, key)) return defaults[key];
  return fallback;
}

/** Validate the same small settings set for standalone, Supervisor startup and hot reload. */
export function assistantSettings(options = {}, defaults = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !defaults ||
    typeof defaults !== 'object' ||
    Array.isArray(defaults)
  )
    throw new Error('Invalid assistant settings');
  const result = Object.fromEntries(
    Object.entries(initial).map(([key, fallback]) => [key, settingValue(options, defaults, key, fallback)]),
  );
  const times = result.assistant_screen_times;
  if (!Array.isArray(times) || times.length > 24 || times.some((value) => !validClockTime(value)))
    throw new Error('Invalid assistant screen times: use up to 24 HH:MM times');
  result.assistant_screen_times = [...new Set(times)].sort();
  const presence = result.assistant_presence_entities;
  if (
    !Array.isArray(presence) ||
    presence.length > 8 ||
    presence.some(
      (value) => typeof value !== 'string' || !/^(?:person|device_tracker|binary_sensor)\.[a-z0-9_]+$/.test(value),
    )
  )
    throw new Error('Invalid assistant presence entities: use up to eight person, device_tracker or binary_sensor IDs');
  result.assistant_presence_entities = [...new Set(presence)];
  if (!validClockTime(result.assistant_screen_quiet_start) || !validClockTime(result.assistant_screen_quiet_end))
    throw new Error('Invalid assistant quiet hours: use HH:MM');
  for (const [key, min, max] of [
    ['assistant_screen_min_minutes', 0, 1440],
    ['assistant_screen_max_per_hour', 1, 60],
    ['assistant_context_tokens', 16384, 131072],
    ['assistant_memory_ttl_days', 1, 365],
  ])
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) throw new Error('Invalid ' + key);
  return result;
}

const runtime = {
  assistant_prompt: '',
  assistant_news_mode: 'morning_and_major',
  assistant_news_interval_hours: 6,
  llm_model: 'deepseek-flash',
  llm_api_key: '',
  llm_base_url: 'https://api.deepseek.com',
  llm_thinking: true,
  llm_reasoning_effort: 'high',
  llm_max_tokens: 0,
  assistant_entities: [],
  calendars: [],
  assistant_text_entity: '',
  assistant_image_entity: '',
  assistant_newsletter_entity: '',
};

/** One validated, persistent set of assistant preferences for the web settings page. */
export function assistantOptions(options = {}, defaults = {}) {
  const result = { ...assistantSettings(options, defaults) };
  for (const [key, fallback] of Object.entries(runtime)) result[key] = settingValue(options, defaults, key, fallback);
  if (Object.keys(options).some((key) => !Object.hasOwn(result, key))) throw new Error('存在不支持的助手设置。');
  if (typeof result.assistant_prompt !== 'string' || result.assistant_prompt.length > 20000)
    throw new Error('提示词最多 20000 字符。');
  for (const [key, max] of [
    ['llm_model', 120],
    ['llm_api_key', 1024],
    ['llm_base_url', 2048],
  ])
    if (typeof result[key] !== 'string' || result[key].length > max || (key !== 'llm_api_key' && !result[key].trim()))
      throw new Error('模型设置无效。');
  let url;
  try {
    url = new URL(result.llm_base_url);
  } catch {}
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('API 地址须为不含凭据或查询参数的 HTTPS 地址。');
  if (
    typeof result.llm_thinking !== 'boolean' ||
    !['low', 'high', 'max'].includes(result.llm_reasoning_effort) ||
    !Number.isInteger(result.llm_max_tokens) ||
    result.llm_max_tokens < 0 ||
    result.llm_max_tokens > 393216
  )
    throw new Error('生成参数无效。');
  if (
    !['off', 'morning', 'morning_and_major'].includes(result.assistant_news_mode) ||
    !Number.isInteger(result.assistant_news_interval_hours) ||
    result.assistant_news_interval_hours < 1 ||
    result.assistant_news_interval_hours > 168
  )
    throw new Error('新闻播报设置无效。');
  for (const [key, max, pattern] of [
    ['assistant_entities', 24, /^[a-z_]+\.[a-z0-9_]+$/],
    ['calendars', 8, /^calendar\.[a-z0-9_]+$/],
  ]) {
    const list = result[key];
    if (!Array.isArray(list) || list.length > max || list.some((id) => typeof id !== 'string' || !pattern.test(id)))
      throw new Error('资料来源实体无效。');
    result[key] = [...new Set(list)];
  }
  for (const [key, pattern] of [
    ['assistant_text_entity', /^(input_text|text)\.[a-z0-9_]+$/],
    ['assistant_image_entity', /^image\.[a-z0-9_]+$/],
    ['assistant_newsletter_entity', /^[a-z_]+\.[a-z0-9_]+$/],
  ])
    if (typeof result[key] !== 'string' || (result[key] && !pattern.test(result[key])))
      throw new Error('屏幕或新闻实体无效。');
  return result;
}
