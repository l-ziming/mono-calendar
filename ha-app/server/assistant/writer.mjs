import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { clock } from '../metrics.mjs';
import { localDay } from '../core.mjs';
import { fingerprint } from './audit.mjs';
import { assistantSettings, assistantOptions } from './settings.mjs';
import { checkLines, readLines, tidy } from './text.mjs';
export { width, checkLines, readLines } from './text.mjs';

const timestamp = (value) => (typeof value === 'number' ? value : Date.parse(value));
// The bundled prompt is personal and not published; without it the assistant starts from an empty prompt.
const bundledPrompt = () =>
  readFile(new URL('./default-prompt.txt', import.meta.url), 'utf8').catch((cause) =>
    cause.code === 'ENOENT' ? '' : Promise.reject(cause),
  );
const sameLines = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const EXPIRY_RETRY_MS = 5 * 60000;
const MAX_EXPIRY_ATTEMPTS = 3;
// An empty display has no meaningful HA change timestamp in the shared context.
const screenVersion = (lines, at) => fingerprint({ lines, at: lines.length ? at || null : null });
const rejected = (reason) => ({ status: 'rejected', reason });

/** Shared API configuration and a scheduled, guarded screen executor. No separate screen model. */
export class AssistantWriter {
  constructor(config, env, ha, options = {}) {
    this.config = config;
    this.ha = ha;
    this.key = env.LLM_API_KEY;
    this.base = (env.LLM_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
    this.model = env.LLM_MODEL || 'deepseek-flash';
    this.fetch = options.fetch || fetch;
    this.thinking = config.llm_thinking ?? true;
    this.effort = config.llm_reasoning_effort ?? 'high';
    this.maxTokens = config.llm_max_tokens ?? 0;
    if (
      typeof this.thinking !== 'boolean' ||
      !['low', 'high', 'max'].includes(this.effort) ||
      !Number.isInteger(this.maxTokens) ||
      this.maxTokens < 0 ||
      this.maxTokens > 393216
    )
      throw new Error('Invalid LLM generation settings');
    if (!this.base.startsWith('https://')) throw new Error('Assistant API requires HTTPS');
    this.path = config.assistant_state_file || '';
    this.promptPath = config.assistant_prompt_file || '';
    this.optionsPath = config.assistant_settings_file || '';
    if (!this.optionsPath && this.promptPath)
      this.optionsPath = join(dirname(this.promptPath), 'assistant-settings.json');
    if (!this.optionsPath && this.path) this.optionsPath = join(dirname(this.path), 'assistant-settings.json');
    this.webOptions = null;
    this.optionsError = false;
    this.optionsPersistence = Promise.resolve();
    this.configuredPrompt = config.assistant_prompt ?? '';
    if (typeof this.configuredPrompt !== 'string' || this.configuredPrompt.length > 20000)
      throw new Error('Invalid assistant prompt');
    this.newsMode = config.assistant_news_mode ?? 'morning_and_major';
    this.newsInterval = config.assistant_news_interval_hours ?? 6;
    this.validateNews(this.newsMode, this.newsInterval);
    this.settings = assistantSettings(config);
    this.supervisorToken = env.SUPERVISOR_TOKEN || '';
    this.measure = options.measure || (async () => []);
    this.state = {
      previous: null,
      usedNews: [],
      attempted: [],
      writes: [],
      reminders: [],
      morningNewsDay: null,
      lastMajorNewsAt: 0,
      lastNewsAt: 0,
      expiryCheck: null,
    };
    this.busy = false;
    this.stateError = false;
    this.decide = null;
    this.persistence = Promise.resolve();
  }
  setDecision(handler) {
    this.decide = handler;
  }
  validateNews(mode, hours) {
    if (!['off', 'morning', 'morning_and_major'].includes(mode) || !Number.isInteger(hours) || hours < 1 || hours > 168)
      throw new Error('Invalid assistant news policy');
  }
  /** Display preference only: acquisition and chat access to news are independent. */
  newsPolicy(now, requested = true) {
    if (!requested || this.newsMode === 'off') return { kind: 'none', mode: this.newsMode };
    const day = localDay(now, this.config.timezone);
    const time = clock(now.getTime(), this.config.timezone);
    if (time >= '06:00' && time < '12:00' && this.state.morningNewsDay !== day)
      return { kind: 'morning', mode: this.newsMode };
    const last = timestamp(this.state.lastMajorNewsAt);
    if (
      this.newsMode === 'morning_and_major' &&
      (!Number.isFinite(last) || now.getTime() - last >= this.newsInterval * 3600000)
    )
      return { kind: 'major', mode: this.newsMode };
    return { kind: 'none', mode: this.newsMode };
  }
  get enabled() {
    return Boolean(this.key && /^(input_text|text)\.[a-z0-9_]+$/.test(this.config.entities.assistant_text || ''));
  }
  async load() {
    if (this.promptPath)
      try {
        await mkdir(dirname(this.promptPath), { recursive: true });
        await writeFile(this.promptPath, await bundledPrompt(), { flag: 'wx', mode: 0o600 });
      } catch (cause) {
        if (cause.code !== 'EEXIST') console.warn('Assistant: custom prompt could not be initialized.');
      }
    if (this.optionsPath)
      try {
        this.applyOptions(assistantOptions(JSON.parse(await readFile(this.optionsPath, 'utf8'))));
      } catch (cause) {
        if (cause.code !== 'ENOENT') {
          this.optionsError = true;
          console.warn('Assistant: saved settings unavailable; refusing to overwrite them.');
        }
      }
    if (!this.path) return;
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8'));
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid schedule state');
      this.state = { ...this.state, ...state };
      // The old marker recorded an attempt before knowing whether the check succeeded.
      delete this.state.expiryChecked;
      for (const key of ['usedNews', 'attempted', 'writes', 'reminders'])
        if (!Array.isArray(this.state[key])) throw new Error('invalid schedule state');
      if (this.state.writes.some((value) => !Number.isFinite(value) || value < 0))
        throw new Error('invalid screen write times');
      const expiryCheck = this.state.expiryCheck;
      if (
        expiryCheck !== null &&
        (typeof expiryCheck !== 'object' ||
          Array.isArray(expiryCheck) ||
          typeof expiryCheck.expires_at !== 'string' ||
          !Number.isFinite(Date.parse(expiryCheck.expires_at)) ||
          !Number.isInteger(expiryCheck.attempts) ||
          expiryCheck.attempts < 1 ||
          expiryCheck.attempts > MAX_EXPIRY_ATTEMPTS ||
          !Number.isFinite(expiryCheck.attempted_at) ||
          expiryCheck.attempted_at < 0 ||
          typeof expiryCheck.complete !== 'boolean')
      )
        throw new Error('invalid expiry check');
    } catch (cause) {
      if (cause.code !== 'ENOENT') {
        this.stateError = true;
        console.warn('Assistant: screen schedule state unavailable; refusing screen writes.');
      }
    }
  }
  async refreshSettings() {
    if (this.webOptions || !this.supervisorToken) return;
    try {
      const response = await this.fetch('http://supervisor/addons/self/info', {
        headers: { Authorization: `Bearer ${this.supervisorToken}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error('unavailable');
      const info = await response.json();
      const options = info?.data?.options;
      if (info?.result !== 'ok' || !options || typeof options !== 'object' || Array.isArray(options))
        throw new Error('invalid options');
      const prompt = options.assistant_prompt ?? '';
      const mode = options.assistant_news_mode ?? this.newsMode;
      const hours = options.assistant_news_interval_hours ?? this.newsInterval;
      if (typeof prompt !== 'string' || prompt.length > 20000) throw new Error('invalid prompt');
      this.validateNews(mode, hours);
      const settings = assistantSettings(options, this.config);
      this.configuredPrompt = prompt;
      this.newsMode = mode;
      this.newsInterval = hours;
      this.settings = settings;
      Object.assign(this.config, settings);
    } catch {
      console.warn('Assistant: live settings unavailable; keeping the last valid settings.');
    }
  }
  async readPrompt() {
    if (this.configuredPrompt.trim()) return this.configuredPrompt;
    if (!this.webOptions && this.promptPath)
      try {
        const prompt = await readFile(this.promptPath, 'utf8');
        if (prompt.trim()) return prompt;
      } catch {}
    return bundledPrompt();
  }
  applyOptions(options) {
    this.webOptions = options;
    const {
      llm_api_key,
      llm_model,
      llm_base_url,
      assistant_text_entity,
      assistant_image_entity,
      assistant_newsletter_entity,
      ...config
    } = options;
    Object.assign(this.config, config);
    Object.assign(this.config.entities, {
      assistant_text: assistant_text_entity,
      assistant_image: assistant_image_entity,
      newsletter: assistant_newsletter_entity,
    });
    this.key = llm_api_key;
    this.model = llm_model;
    this.base = llm_base_url.replace(/\/$/, '');
    this.thinking = options.llm_thinking;
    this.effort = options.llm_reasoning_effort;
    this.maxTokens = options.llm_max_tokens;
    this.configuredPrompt = options.assistant_prompt;
    this.newsMode = options.assistant_news_mode;
    this.newsInterval = options.assistant_news_interval_hours;
    this.settings = assistantSettings(options);
  }
  async currentOptions() {
    await this.refreshSettings();
    const prompt = await this.readPrompt();
    return (
      this.webOptions ||
      assistantOptions(
        {},
        {
          ...this.config,
          ...this.settings,
          assistant_prompt: prompt,
          assistant_news_mode: this.newsMode,
          assistant_news_interval_hours: this.newsInterval,
          llm_model: this.model,
          llm_api_key: this.key || '',
          llm_base_url: this.base,
          llm_thinking: this.thinking,
          llm_reasoning_effort: this.effort,
          llm_max_tokens: this.maxTokens,
          assistant_text_entity: this.config.entities.assistant_text || '',
          assistant_image_entity: this.config.entities.assistant_image || '',
          assistant_newsletter_entity: this.config.entities.newsletter || '',
        },
      )
    );
  }
  async preferences() {
    const options = await this.currentOptions();
    const { llm_api_key, ...visible } = options;
    return {
      options: visible,
      api_key_configured: Boolean(llm_api_key),
      revision: fingerprint(options),
      writable: Boolean(this.optionsPath && !this.optionsError),
    };
  }
  replaceOptions(options, revision) {
    const run = this.optionsPersistence.then(async () => {
      if (!this.optionsPath || this.optionsError)
        throw Object.assign(new Error('助手设置暂时无法保存。'), { status: 503 });
      if (revision !== (await this.preferences()).revision)
        throw Object.assign(new Error('设置已更新，请重新载入后再保存。'), { status: 409 });
      let next;
      try {
        next = assistantOptions(options, await this.currentOptions());
      } catch (cause) {
        throw Object.assign(new Error(cause.message), { status: 400 });
      }
      try {
        await mkdir(dirname(this.optionsPath), { recursive: true });
        await writeFile(this.optionsPath + '.tmp', JSON.stringify(next), { mode: 0o600, flush: true });
        await rename(this.optionsPath + '.tmp', this.optionsPath);
      } catch {
        throw Object.assign(new Error('设置未保存，请稍后重试。'), { status: 503 });
      }
      this.applyOptions(next);
      return this.preferences();
    });
    this.optionsPersistence = run.catch(() => {});
    return run;
  }
  save() {
    if (!this.path) return Promise.resolve(true);
    const text = JSON.stringify(this.state);
    const run = this.persistence.then(async () => {
      try {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(this.path + '.tmp', text, { mode: 0o600, flush: true });
        await rename(this.path + '.tmp', this.path);
        return true;
      } catch {
        this.stateError = true;
        console.warn('Assistant: screen schedule state could not be saved.');
        return false;
      }
    });
    this.persistence = run.catch(() => {});
    return run;
  }
  async request(url, body, signal) {
    const response = await this.fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return body.stream ? response : response.json();
  }
  complete(messages, { json = false, stream = false, signal, tools } = {}) {
    return this.request(
      this.base + '/chat/completions',
      {
        model: this.model,
        thinking: { type: this.thinking ? 'enabled' : 'disabled' },
        ...(this.thinking ? { reasoning_effort: this.effort } : {}),
        ...(this.maxTokens ? { max_tokens: this.maxTokens } : {}),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        ...(stream ? { stream: true } : {}),
        ...(tools?.length ? { tools } : {}),
        messages,
      },
      signal,
    );
  }
  panelLines(lines, now = new Date()) {
    const previous = this.state.previous;
    return previous?.expires_at && Date.parse(previous.expires_at) <= now.getTime() && sameLines(lines, previous.lines)
      ? []
      : lines;
  }
  screenState(context, now = new Date()) {
    const previous = context?.previous;
    const lines = Array.isArray(previous?.lines) ? previous.lines : [];
    const at = previous?.at || previous?.generated_at || null;
    const stored = sameLines(lines, this.state.previous?.lines) ? this.state.previous : null;
    const history = this.state.reminders
      .slice(-24)
      .filter(
        (item) =>
          typeof item?.at === 'string' &&
          Number.isFinite(Date.parse(item.at)) &&
          Date.parse(item.at) <= +now &&
          Array.isArray(item.lines) &&
          item.lines.length <= 4 &&
          item.lines.every((line) => typeof line === 'string'),
      )
      .map(({ at, lines }) => ({ at, lines: [...lines] }));
    return {
      version: screenVersion(lines, at),
      lines,
      at,
      expires_at: stored?.expires_at || null,
      history,
      last_pushed_at: this.state.writes.length
        ? new Date(this.state.writes.at(-1)).toISOString()
        : stored?.generated_at || at,
      observed_at: now.toISOString(),
    };
  }
  quiet(at) {
    const time = clock(at, this.config.timezone);
    const start = this.settings.assistant_screen_quiet_start;
    const end = this.settings.assistant_screen_quiet_end;
    return start !== end && (start < end ? time >= start && time < end : time >= start || time < end);
  }
  /** Default expiry: the next scheduled check (at most 6 h). Slots under 15 min away are skipped so the write still lands before them. */
  nextCheck(now = new Date()) {
    const limit = +now + 6 * 3600000;
    for (let at = Math.ceil((+now + 15 * 60000) / 60000) * 60000; at <= limit; at += 60000)
      if (this.settings.assistant_screen_times.includes(clock(at, this.config.timezone)))
        return new Date(at).toISOString();
    return new Date(limit).toISOString();
  }
  async actualScreen() {
    const id = this.config.entities.assistant_text;
    const state = (await this.ha.states([id]))[id];
    if (!state || typeof state.state !== 'string' || ['unknown', 'unavailable'].includes(state.state))
      throw new Error('screen unavailable');
    return { lines: readLines(state.state), at: state.last_changed || state.last_updated || null };
  }
  /** Validate and commit only this screen action. No other action is rolled back on rejection. */
  async publish(action, { now = new Date(), signal, trigger = 'scheduled' } = {}) {
    if (!this.enabled) return rejected('screen_disabled');
    if (this.stateError) return rejected('schedule_state_unavailable');
    const allowed = ['action', 'lines', 'expires_at', 'base_version', 'news_ids', 'reason'];
    if (
      !action ||
      typeof action !== 'object' ||
      Array.isArray(action) ||
      Object.keys(action).some((key) => !allowed.includes(key)) ||
      !['keep', 'update', 'clear'].includes(action.action) ||
      typeof action.base_version !== 'string'
    )
      return rejected('invalid_action');
    const operation = action.action;
    const rawLines = action.lines ?? [];
    const newsIds = action.news_ids ?? [];
    const expires = action.expires_at ?? null;
    if (
      !Array.isArray(rawLines) ||
      !Array.isArray(newsIds) ||
      newsIds.length > 10 ||
      newsIds.some((x) => typeof x !== 'string' || x.length > 120) ||
      new Set(newsIds).size !== newsIds.length ||
      (action.reason != null && (typeof action.reason !== 'string' || action.reason.length > 400))
    )
      return rejected('invalid_action');
    const lines = rawLines.map((x) => (typeof x === 'string' ? tidy(x.trim()) : x));
    if (
      checkLines({ lines }).length ||
      (operation === 'update' && (!lines.length || (lines.length > 3 && !newsIds.length))) ||
      (operation !== 'update' && (lines.length || newsIds.length || expires !== null))
    )
      return rejected('invalid_lines');
    const at = now.getTime();
    if (
      operation === 'update' &&
      (typeof expires !== 'string' ||
        !/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(expires) ||
        !Number.isFinite(Date.parse(expires)) ||
        Date.parse(expires) <= at ||
        Date.parse(expires) > at + 6 * 3600000)
    )
      return rejected('invalid_expiry');
    try {
      signal?.throwIfAborted();
      const current = await this.actualScreen();
      if (screenVersion(current.lines, current.at) !== action.base_version) return rejected('stale_version');
      const stored = sameLines(current.lines, this.state.previous?.lines) ? this.state.previous : null;
      const expired = stored?.expires_at && Date.parse(stored.expires_at) <= at;
      if (operation === 'keep') {
        if (expired && current.lines.length) return rejected('expired_keep');
        if (current.lines.length) return { status: 'kept' };
        return { status: 'kept', reason: 'empty' };
      }
      if (operation === 'clear' && !current.lines.length) return { status: 'kept', reason: 'empty' };
      if (operation === 'update' && sameLines(lines, current.lines) && !expired)
        return { status: 'kept', reason: 'unchanged' };
      if (trigger !== 'manual' && this.quiet(at)) return rejected('quiet_hours');
      const changed = timestamp(current.at);
      const last = Math.max(Number.isFinite(changed) ? changed : 0, this.state.writes.at(-1) || 0);
      if (last && at - last < this.settings.assistant_screen_min_minutes * 60000) return rejected('minimum_stay');
      const recent = this.state.writes.filter((x) => Number.isFinite(x) && x > at - 3600000);
      if (recent.length >= this.settings.assistant_screen_max_per_hour) return rejected('hourly_limit');
      const policy = this.newsPolicy(now);
      if (newsIds.length && policy.kind === 'none') return rejected('news_display_frequency');
      if (newsIds.some((id) => this.state.usedNews.includes(id))) return rejected('news_already_used');
      if ((await this.measure(lines)).length) return rejected('invalid_line_width');
      signal?.throwIfAborted();
      const latest = await this.actualScreen();
      if (screenVersion(latest.lines, latest.at) !== action.base_version) return rejected('stale_version');
      signal?.throwIfAborted();
      // HA has no conditional set_value API. Recheck immediately before the write; all our own calls are serialized.
      const id = this.config.entities.assistant_text;
      const text = lines.join('\n');
      await this.ha.service(id.split('.')[0], 'set_value', { entity_id: id, value: text });
      const confirmed = (await this.ha.states([id]))[id];
      if (confirmed?.state !== text) return { status: 'failed', reason: 'write_not_confirmed' };
      // Commit point: cancellation after a confirmed write does not erase the real screen state.
      this.state.previous = {
        lines,
        generated_at: now.toISOString(),
        expires_at: operation === 'clear' ? now.toISOString() : expires,
      };
      this.state.writes = [...recent, at];
      this.state.reminders = [...this.state.reminders, { at: now.toISOString(), lines }].slice(-24);
      if (newsIds.length) {
        this.state.usedNews = [...this.state.usedNews, ...newsIds].slice(-240);
        this.state.lastNewsAt = at;
        if (policy.kind === 'morning') this.state.morningNewsDay = localDay(now, this.config.timezone);
        else this.state.lastMajorNewsAt = now.toISOString();
      }
      if (!(await this.save()))
        return { status: operation === 'clear' ? 'cleared' : 'updated', reason: 'schedule_state_not_saved' };
      return { status: operation === 'clear' ? 'cleared' : 'updated' };
    } catch (cause) {
      return { status: 'failed', reason: signal?.aborted ? 'canceled' : 'screen_write_failed' };
    }
  }
  async refresh(now = new Date()) {
    if (!this.enabled || !this.decide) return false;
    return this.decide('manual', now);
  }
  async tick(now = new Date()) {
    if (!this.enabled || this.busy || !this.decide || this.stateError) return false;
    this.busy = true;
    try {
      await this.refreshSettings();
      await this.readPrompt();
      const day = localDay(now, this.config.timezone);
      const time = clock(now.getTime(), this.config.timezone);
      const slot = day + 'T' + time;
      const scheduled = this.settings.assistant_screen_times.includes(time) && !this.state.attempted.includes(slot);
      // Failed expiry checks retry with a bounded budget; fixed screen slots remain independent.
      const previous = this.state.previous;
      const expiry = previous?.lines?.length && Date.parse(previous.expires_at) <= +now ? previous.expires_at : null;
      const expiryCheck = this.state.expiryCheck?.expires_at === expiry ? this.state.expiryCheck : null;
      const attempts = expiryCheck?.attempts || 0;
      const quiet = this.quiet(+now);
      const expiryDue =
        expiry &&
        !expiryCheck?.complete &&
        attempts < MAX_EXPIRY_ATTEMPTS &&
        (!expiryCheck || +now - expiryCheck.attempted_at >= EXPIRY_RETRY_MS);
      if (!scheduled && (!expiryDue || quiet)) return false;
      if (scheduled)
        this.state.attempted = [
          ...this.state.attempted.filter((x) => typeof x === 'string' && x.startsWith(day)),
          slot,
        ].slice(-24);
      if (expiry && !quiet)
        this.state.expiryCheck = {
          expires_at: expiry,
          attempts: Math.min(attempts + 1, MAX_EXPIRY_ATTEMPTS),
          attempted_at: now.getTime(),
          complete: expiryCheck?.complete || false,
        };
      this.state.lastCheck = now.getTime();
      if (!(await this.save())) return false;
      const result = await this.decide('scheduled', now);
      if (result && expiry && !quiet) {
        this.state.expiryCheck.complete = true;
        await this.save();
      }
      return result;
    } catch {
      console.warn('Assistant: scheduled screen check failed.');
      return false;
    } finally {
      this.busy = false;
    }
  }
}
