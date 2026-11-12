import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from './app.mjs';
import { assistantSettings } from './assistant/settings.mjs';

// Adapt Supervisor options without exposing HA credentials to the display client.
export function addonSettings(options, defaults, supervisorToken) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Invalid app options');
  }
  if (typeof supervisorToken !== 'string' || !supervisorToken) {
    throw new Error('Missing Supervisor token');
  }
  if (
    typeof options.display_token !== 'string' ||
    options.display_token.length < 24 ||
    options.display_token === supervisorToken
  ) {
    throw new Error('Set a separate display token of at least 24 characters');
  }
  const timezone = options.timezone ?? defaults.timezone;
  if (typeof timezone !== 'string' || !timezone) {
    throw new Error('Invalid timezone');
  }
  new Intl.DateTimeFormat('en', { timeZone: timezone });
  const temperatureUnit = options.temperature_unit ?? defaults.temperature_unit;
  if (!['°C', '°F'].includes(temperatureUnit)) {
    throw new Error('Invalid temperature unit');
  }
  if (options.entities != null && (typeof options.entities !== 'object' || Array.isArray(options.entities))) {
    throw new Error('Invalid entities');
  }
  const entities = { ...defaults.entities };
  for (const entityKey of Object.keys(entities)) {
    const value = options.entities?.[entityKey] ?? entities[entityKey];
    if (typeof value !== 'string' || (value && !/^[a-z_]+\.[a-z0-9_]+(?:#[A-Za-z0-9_]+)?$/.test(value))) {
      throw new Error('Invalid entity selector');
    }
    entities[entityKey] = value;
  }
  function entityList(name, domain) {
    const values = options[name] ?? defaults[name] ?? [];
    const pattern = new RegExp(`^${domain}\\.[a-z0-9_]+$`);
    if (
      !Array.isArray(values) ||
      values.length > 8 ||
      values.some((id) => typeof id !== 'string' || !pattern.test(id))
    ) {
      throw new Error(`Invalid ${name}: use at most eight ${domain} entity IDs`);
    }
    return [...new Set(values)];
  }
  const calendars = entityList('calendars', 'calendar');
  const assistantEntities = options.assistant_entities ?? defaults.assistant_entities ?? [];
  if (
    !Array.isArray(assistantEntities) ||
    assistantEntities.length > 24 ||
    assistantEntities.some((id) => typeof id !== 'string' || !/^[a-z_]+\.[a-z0-9_]+$/.test(id))
  ) {
    throw new Error('Invalid assistant entities');
  }
  const newsMode = options.assistant_news_mode ?? defaults.assistant_news_mode ?? 'morning_and_major';
  const newsInterval = options.assistant_news_interval_hours ?? defaults.assistant_news_interval_hours ?? 6;
  if (
    !['off', 'morning', 'morning_and_major'].includes(newsMode) ||
    !Number.isInteger(newsInterval) ||
    newsInterval < 1 ||
    newsInterval > 168
  ) {
    throw new Error('Invalid assistant news policy');
  }
  const city = options.city ?? defaults.city ?? '';
  const weekStart = options.week_start ?? defaults.week_start ?? 1;
  const aqiStandard = 'US';
  if (typeof city !== 'string' || city.length > 80 || ![0, 1].includes(weekStart)) {
    throw new Error('Invalid display options');
  }
  const aqiInputStandard = options.aqi_input_standard ?? defaults.aqi_input_standard ?? 'US';
  const aqiAveragePeriod = options.aqi_cn_period ?? defaults.aqi_cn_period ?? '';
  if (!['US', 'CN2012', 'CN2026'].includes(aqiInputStandard) || !['', '24h'].includes(aqiAveragePeriod)) {
    throw new Error('Invalid AQI source standard');
  }
  const apiKey = options.llm_api_key ?? '';
  const modelName = options.llm_model ?? '';
  const apiBaseUrl = options.llm_base_url ?? 'https://api.deepseek.com';
  if (![apiKey, modelName, apiBaseUrl].every((value) => typeof value === 'string')) {
    throw new Error('Invalid LLM settings');
  }
  const thinkingEnabled = options.llm_thinking ?? true;
  const reasoningEffort = options.llm_reasoning_effort ?? 'high';
  const maxOutputTokens = options.llm_max_tokens ?? 0;
  if (
    typeof thinkingEnabled !== 'boolean' ||
    !['low', 'high', 'max'].includes(reasoningEffort) ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 0 ||
    maxOutputTokens > 393216
  ) {
    throw new Error('Invalid LLM generation settings');
  }
  const endpoint = new URL(apiBaseUrl);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('LLM requires an HTTPS API root');
  }
  const prompt = options.assistant_prompt === undefined ? '' : options.assistant_prompt;
  if (typeof prompt !== 'string' || prompt.length > 20000) {
    throw new Error('Invalid assistant prompt');
  }
  const assistant = assistantSettings(options, defaults);
  return {
    config: {
      ...defaults,
      ...assistant,
      ha_url: 'http://supervisor/core',
      bind: '0.0.0.0',
      port: 8080,
      timezone,
      temperature_unit: temperatureUnit,
      entities,
      calendars,
      assistant_entities: [...new Set(assistantEntities)],
      assistant_news_mode: newsMode,
      assistant_news_interval_hours: newsInterval,
      city,
      week_start: weekStart,
      aqi_standard: aqiStandard,
      aqi_input_standard: aqiInputStandard,
      aqi_cn_period: aqiAveragePeriod,
      llm_thinking: thinkingEnabled,
      llm_reasoning_effort: reasoningEffort,
      llm_max_tokens: maxOutputTokens,
      assistant_state_file: '/data/assistant-state.json',
      assistant_memory_dir: '/config/assistant-memory',
      assistant_prompt_file: '/config/assistant-prompt.txt',
      assistant_prompt: prompt,
    },
    env: {
      HA_TOKEN: supervisorToken,
      DISPLAY_TOKEN: options.display_token,
      LLM_API_KEY: apiKey,
      LLM_BASE_URL: apiBaseUrl,
      LLM_MODEL: modelName,
      SUPERVISOR_TOKEN: supervisorToken,
    },
  };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    const [options, defaults] = await Promise.all([
      readFile('/data/options.json', 'utf8'),
      readFile(new URL('../config.example.json', import.meta.url), 'utf8'),
    ]);
    const settings = addonSettings(JSON.parse(options), JSON.parse(defaults), process.env.SUPERVISOR_TOKEN);
    // Runtime settings, including the initial prompt, exclude credentials.
    const configPath = '/tmp/mono-calendar.json';
    await writeFile(configPath, JSON.stringify(settings.config), { mode: 0o600 });
    await start(configPath, settings.env);
    console.log('Mono Calendar started on container port 8080.');
  } catch {
    // JSON parse and upstream errors can contain input values: never echo them.
    console.error(
      'Mono Calendar could not start. Check app options, display token, timezone, entity IDs and LLM HTTPS settings.',
    );
    process.exitCode = 1;
  }
}
