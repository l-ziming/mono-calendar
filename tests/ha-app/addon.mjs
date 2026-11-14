import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addonSettings } from '../../ha-app/server/addon.mjs';
import { assistantSettings, assistantOptions } from '../../ha-app/server/assistant/settings.mjs';

const defaults = JSON.parse(await readFile(new URL('../../ha-app/config.example.json', import.meta.url), 'utf8'));
const options = {
  display_token: 'display-test-token-01234567890123456789',
  timezone: 'America/Denver',
  entities: { co2: 'sensor.test_co2', living_temperature: 'climate.test#current_temperature' },
  calendars: ['calendar.personal', 'calendar.family', 'calendar.personal'],
  assistant_prompt: '自定义提示词。',
  assistant_news_mode: 'morning',
  assistant_news_interval_hours: 12,
  llm_api_key: 'private-model-test-key',
  llm_model: 'test-model',
  llm_thinking: false,
  llm_reasoning_effort: 'max',
  llm_max_tokens: 8192,
  llm_base_url: 'https://example.test/v1',
};
const result = addonSettings(options, defaults, 'private-supervisor-test-token');
assert.equal(result.config.ha_url, 'http://supervisor/core');
assert.equal(result.config.port, 8080);
assert.equal(result.config.assistant_prompt_file, '/config/assistant-prompt.txt');
assert.equal(result.config.assistant_prompt, options.assistant_prompt);
assert.equal(result.config.assistant_news_mode, 'morning');
assert.equal(result.config.assistant_news_interval_hours, 12);
assert.equal(result.config.entities.co2, 'sensor.test_co2');
assert.equal(result.config.entities.living_temperature, 'climate.test#current_temperature');
assert.equal(result.config.entities.climate, defaults.entities.climate);
assert.equal(defaults.entities.co2, '');
assert.deepEqual(result.config.calendars, ['calendar.personal', 'calendar.family']);
assert.equal('todo_lists' in result.config, false, 'to-do lists are no longer read');
assert.equal(defaults.entities.assistant_image, '');
assert.deepEqual(defaults.calendars, []);
assert.equal(result.env.HA_TOKEN, 'private-supervisor-test-token');
assert.equal(result.env.DISPLAY_TOKEN, options.display_token);
assert.equal(result.env.LLM_BASE_URL, 'https://example.test/v1');
assert.equal(result.config.llm_thinking, false);
assert.equal(result.config.llm_reasoning_effort, 'max');
assert.equal(result.config.llm_max_tokens, 8192);
for (const secret of [result.env.HA_TOKEN, result.env.DISPLAY_TOKEN, result.env.LLM_API_KEY]) {
  assert.equal(JSON.stringify(result.config).includes(secret), false);
}
const local = addonSettings({ display_token: options.display_token }, defaults, 'supervisor-test-token');
assert.equal(local.env.LLM_API_KEY, '');
assert.equal(local.env.LLM_MODEL, '');
assert.equal(local.config.llm_thinking, true);
assert.equal(local.config.llm_reasoning_effort, 'high');
assert.equal(local.config.llm_max_tokens, 0);
assert.equal(local.config.assistant_prompt, '');
assert.deepEqual(local.config.assistant_presence_entities, []);
assert.deepEqual(
  addonSettings(
    {
      ...options,
      assistant_presence_entities: [
        'person.user',
        'device_tracker.phone',
        'binary_sensor.home_reference',
        'person.user',
      ],
    },
    defaults,
    'supervisor-test-token',
  ).config.assistant_presence_entities,
  ['person.user', 'device_tracker.phone', 'binary_sensor.home_reference'],
);
assert.deepEqual(local.config.assistant_screen_times, ['06:30', '11:30', '16:30', '21:00']);
assert.equal('assistant_screen_min_minutes' in local.config, false);
assert.equal('assistant_screen_max_per_hour' in local.config, false);
assert.equal(local.config.assistant_screen_quiet_start, '23:00');
assert.equal(local.config.assistant_screen_quiet_end, '06:00');
assert.equal(local.config.assistant_context_tokens, 32768);
assert.equal(local.config.assistant_memory_ttl_days, 14);
const customized = addonSettings(
  {
    ...options,
    assistant_screen_times: ['21:05', '00:00', '21:05'],
    assistant_screen_min_minutes: 0,
    assistant_screen_max_per_hour: 60,
    assistant_screen_quiet_start: '08:00',
    assistant_screen_quiet_end: '08:00',
    assistant_context_tokens: 131072,
    assistant_memory_ttl_days: 365,
  },
  defaults,
  'supervisor-test-token',
);
assert.deepEqual(customized.config.assistant_screen_times, ['00:00', '21:05']);
assert.equal('assistant_screen_min_minutes' in customized.config, false);
assert.equal('assistant_screen_max_per_hour' in customized.config, false);
const migrated = assistantOptions({
  assistant_screen_min_minutes: 1440,
  assistant_screen_max_per_hour: 1,
  llm_api_key: 'preserved-test-key',
  assistant_prompt: '保留原提示词。',
});
assert.equal('assistant_screen_min_minutes' in migrated, false);
assert.equal('assistant_screen_max_per_hour' in migrated, false);
assert.equal(migrated.llm_api_key, 'preserved-test-key');
assert.equal(migrated.assistant_prompt, '保留原提示词。');
assert.throws(() => assistantOptions({ unsupported_setting: true }));
assert.equal(customized.config.assistant_screen_quiet_start, customized.config.assistant_screen_quiet_end);
assert.equal(customized.config.assistant_context_tokens, 131072);
assert.equal(customized.config.assistant_memory_ttl_days, 365);
assert.deepEqual(assistantSettings({ assistant_screen_times: [] }).assistant_screen_times, []);
assert.deepEqual(assistantSettings({}, { assistant_screen_times: ['23:59'] }).assistant_screen_times, ['23:59']);
const detached = assistantSettings();
detached.assistant_screen_times.push('22:00');
assert.equal(assistantSettings().assistant_screen_times.includes('22:00'), false);
detached.assistant_presence_entities.push('person.user');
assert.deepEqual(assistantSettings().assistant_presence_entities, []);
for (const invalid of [
  { assistant_presence_entities: null },
  { assistant_presence_entities: 'person.user' },
  { assistant_presence_entities: ['light.room'] },
  { assistant_presence_entities: ['person.User'] },
  { assistant_presence_entities: ['person.user#state'] },
  { assistant_presence_entities: ['../secret'] },
  { assistant_presence_entities: [123] },
  { assistant_presence_entities: Array(9).fill('person.user') },
  { assistant_screen_times: null },
  { assistant_screen_times: '06:30' },
  { assistant_screen_times: ['6:30'] },
  { assistant_screen_times: ['24:00'] },
  { assistant_screen_times: ['23:60'] },
  { assistant_screen_times: [630] },
  { assistant_screen_times: Array(25).fill('06:30') },
  { assistant_screen_quiet_start: '12:60' },
  { assistant_screen_quiet_end: '25:00' },
  { assistant_context_tokens: 16383 },
  { assistant_context_tokens: 131073 },
  { assistant_memory_ttl_days: 0 },
  { assistant_memory_ttl_days: 366 },
  { assistant_memory_ttl_days: 1.5 },
]) {
  assert.throws(() => assistantSettings(invalid));
  assert.throws(() => addonSettings({ ...options, ...invalid }, defaults, 'supervisor-test-token'));
}
assert.equal(
  addonSettings({ ...options, assistant_prompt: '中'.repeat(20000) }, defaults, 'supervisor-test-token').config
    .assistant_prompt.length,
  20000,
);
assert.deepEqual(local.config.calendars, []);
for (const patch of [
  { display_token: '' },
  { timezone: 'Invalid/Zone' },
  { temperature_unit: 'K' },
  { entities: { co2: '../secret' } },
  { llm_base_url: 'http://example.test' },
  { llm_base_url: 'https://user:password@example.test' },
  { calendars: 'calendar.personal' },
  { llm_thinking: 'enabled' },
  { llm_reasoning_effort: 'medium' },
  { llm_max_tokens: -1 },
  { llm_max_tokens: 393217 },
  { llm_max_tokens: 1.5 },
  { calendars: ['todo.reminders'] },
  { assistant_news_mode: 'always' },
  { assistant_news_interval_hours: 0 },
  { assistant_news_interval_hours: 169 },
  { assistant_news_interval_hours: 1.5 },
  { assistant_prompt: null },
  { assistant_prompt: [] },
  { assistant_prompt: 3 },
  { assistant_prompt: '中'.repeat(20001) },
  { calendars: Array.from({ length: 9 }, (_, i) => `calendar.test_${i}`) },
]) {
  assert.throws(() => addonSettings({ ...options, ...patch }, defaults, 'supervisor-test-token'));
}
assert.throws(() => addonSettings(options, defaults, options.display_token));
assert.throws(() => addonSettings(options, defaults, ''));
console.log(
  'Add-on option mapping, Supervisor proxy, secret separation and invalid settings checked; no network calls.',
);
