import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssistantWriter, width, checkLines, readLines } from '../../../ha-app/server/assistant/writer.mjs';

const directory = await mkdtemp(join(tmpdir(), 'mono-calendar-screen-'));
const now = new Date('2026-11-09T15:00:00Z'); // 08:00 in Denver
const valid = ['明早有线上会议，资料可以提前备好。'];
const config = {
  timezone: 'America/Denver',
  entities: { assistant_text: 'input_text.mono_calendar_assistant' },
  assistant_screen_times: ['08:00'],
  assistant_screen_quiet_start: '23:00',
  assistant_screen_quiet_end: '06:00',
};
const env = { LLM_API_KEY: 'fake-key' };
function harness(overrides = {}, options = {}) {
  let current = { state: '原有便条仍然有效。', last_changed: '2026-11-09T13:00:00Z' };
  const writes = [];
  const requests = [];
  const ha = {
    async states() {
      return { 'input_text.mono_calendar_assistant': { ...current } };
    },
    async service(domain, name, payload) {
      writes.push({ domain, name, payload });
      if (!options.ignoreWrites)
        current = { state: payload.value, last_changed: options.changeAt || now.toISOString() };
    },
  };
  const fetch =
    options.fetch ||
    (async (url, init) => {
      requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({ choices: [] }) };
    });
  const writer = new AssistantWriter({ ...config, ...overrides }, env, ha, { ...options, fetch });
  const snapshot = () =>
    writer.screenState({ previous: { lines: readLines(current.state), at: current.last_changed } }, now);
  const action = (extra = {}) => ({
    action: 'update',
    base_version: snapshot().version,
    lines: valid,
    expires_at: '2026-11-09T16:00:00Z',
    ...extra,
  });
  return {
    writer,
    writes,
    requests,
    snapshot,
    action,
    get current() {
      return current;
    },
    set current(value) {
      current = value;
    },
  };
}
try {
  assert.equal(width('中，12'), 3.2);
  assert.deepEqual(checkLines({ lines: valid }), []);
  assert.deepEqual(readLines('{"lines":["第一行。","第二行。"]}'), ['第一行。', '第二行。']);

  const api = harness();
  await api.writer.complete([{ role: 'user', content: '你好。' }], {
    tools: [{ type: 'function', function: { name: 'chat' } }],
    stream: true,
  });
  assert.equal(api.requests[0].body.model, 'deepseek-flash');
  assert.deepEqual(api.requests[0].body.thinking, { type: 'enabled' });
  assert.equal(api.requests[0].body.reasoning_effort, 'high');
  assert.equal(api.requests[0].body.tools[0].function.name, 'chat');
  assert.equal(api.requests[0].body.max_tokens, undefined);
  const disabled = harness({ llm_thinking: false, llm_max_tokens: 2048 });
  await disabled.writer.complete([]);
  assert.deepEqual(disabled.requests[0].body.thinking, { type: 'disabled' });
  assert.equal(disabled.requests[0].body.reasoning_effort, undefined);
  assert.equal(disabled.requests[0].body.max_tokens, 2048);
  assert.throws(() => harness({ llm_max_tokens: -1 }));

  {
    const settingsPath = join(directory, 'web-settings.json');
    const webConfig = { assistant_settings_file: settingsPath, entities: { ...config.entities } };
    const web = harness(webConfig);
    await web.writer.load();
    const original = await web.writer.preferences();
    assert.equal(original.api_key_configured, true);
    assert.equal(JSON.stringify(original).includes('fake-key'), false);
    const saved = await web.writer.replaceOptions(
      {
        assistant_prompt: '网页提示词。',
        llm_model: 'new-model',
        llm_thinking: false,
        llm_max_tokens: 1234,
        assistant_screen_times: ['09:00'],
        assistant_news_mode: 'morning',
        assistant_context_tokens: 65536,
        assistant_presence_entities: ['person.user'],
        assistant_entities: ['sensor.test'],
        calendars: ['calendar.test'],
      },
      original.revision,
    );
    assert.equal(await web.writer.readPrompt(), '网页提示词。');
    assert.equal(web.writer.key, 'fake-key', 'An omitted key is retained');
    assert.equal(web.writer.config.assistant_context_tokens, 65536);
    await web.writer.complete([]);
    assert.equal(web.requests[0].body.model, 'new-model');
    assert.equal(web.requests[0].body.max_tokens, 1234);
    assert.equal(web.requests[0].body.thinking.type, 'disabled');
    assert.equal((await stat(settingsPath)).mode & 0o777, 0o600);
    await assert.rejects(
      web.writer.replaceOptions({ llm_model: 'stale' }, original.revision),
      (error) => error.status === 409,
    );
    const preserved = await readFile(settingsPath, 'utf8');
    for (const invalid of [
      { llm_api_key: null },
      { llm_base_url: 'http://unsafe.test' },
      { llm_base_url: 'https://user:secret@example.test' },
      { assistant_entities: ['../file'] },
      { calendars: ['sensor.test'] },
      { assistant_text_entity: 'light.test' },
      { unknown_setting: true },
    ])
      await assert.rejects(web.writer.replaceOptions(invalid, saved.revision), (error) => error.status === 400);
    assert.equal(await readFile(settingsPath, 'utf8'), preserved, 'Invalid settings never replace the saved file');
    const restartedWeb = harness({ ...webConfig, entities: { ...config.entities } });
    await restartedWeb.writer.load();
    assert.equal((await restartedWeb.writer.preferences()).revision, saved.revision);
    assert.equal(await restartedWeb.writer.readPrompt(), '网页提示词。');
    const concurrent = await Promise.allSettled(
      ['one', 'two'].map((model) => restartedWeb.writer.replaceOptions({ llm_model: model }, saved.revision)),
    );
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(concurrent.find((result) => result.status === 'rejected').reason.status, 409);
    await restartedWeb.writer.replaceOptions({ llm_api_key: '' }, (await restartedWeb.writer.preferences()).revision);
    assert.equal(restartedWeb.writer.enabled, false, 'Explicit key removal disables generation');
    const corruptPath = join(directory, 'corrupt-settings.json');
    await writeFile(corruptPath, '{broken');
    const corrupt = harness({ assistant_settings_file: corruptPath });
    await corrupt.writer.load();
    assert.equal((await corrupt.writer.preferences()).writable, false);
    await assert.rejects(
      corrupt.writer.replaceOptions({}, (await corrupt.writer.preferences()).revision),
      (error) => error.status === 503,
    );
    assert.equal(await readFile(corruptPath, 'utf8'), '{broken');
  }

  const scheduler = harness({ assistant_state_file: join(directory, 'schedule.json') });
  const calls = [];
  scheduler.writer.setDecision(async (trigger, at) => {
    calls.push([trigger, at.toISOString()]);
    return true;
  });
  assert.equal(await scheduler.writer.tick(new Date('2026-11-09T14:59:00Z')), false);
  assert.equal(await scheduler.writer.tick(now), true);
  assert.equal(await scheduler.writer.tick(new Date('2026-11-09T15:00:30Z')), false);
  assert.equal(
    await scheduler.writer.tick(new Date('2026-11-09T15:01:00Z')),
    false,
    'No device or environment changes can trigger a screen request',
  );
  assert.equal(await scheduler.writer.refresh(now), true);
  assert.deepEqual(
    calls.map((x) => x[0]),
    ['scheduled', 'manual'],
  );
  const restarted = harness({ assistant_state_file: join(directory, 'schedule.json') });
  await restarted.writer.load();
  restarted.writer.setDecision(async () => {
    throw new Error('duplicate scheduled call');
  });
  assert.equal(await restarted.writer.tick(now), false, 'Schedule attempt survives restart');
  const dst = harness({ assistant_screen_times: ['01:30'] });
  let repeats = 0;
  dst.writer.setDecision(async () => {
    repeats++;
    return true;
  });
  await dst.writer.tick(new Date('2026-11-01T07:30:00Z'));
  await dst.writer.tick(new Date('2026-11-01T08:30:00Z'));
  assert.equal(repeats, 1, 'Repeated DST local minute is requested once');
  assert.equal(
    harness().writer.nextCheck(new Date('2026-11-09T14:00:00Z')),
    '2026-11-09T15:00:00.000Z',
    'Expiry defaults to the next check',
  );
  assert.equal(
    harness().writer.nextCheck(now),
    '2026-11-09T21:00:00.000Z',
    'No check within six hours caps the expiry',
  );
  assert.equal(
    harness().writer.nextCheck(new Date('2026-11-09T14:50:00Z')),
    '2026-11-09T20:50:00.000Z',
    'A check under 15 minutes away is skipped',
  );
  const expiring = harness({ assistant_state_file: join(directory, 'expiry.json') });
  let rechecks = 0;
  expiring.writer.setDecision(async () => {
    rechecks++;
    return true;
  });
  expiring.writer.state.previous = {
    lines: valid,
    generated_at: now.toISOString(),
    expires_at: '2026-11-09T17:00:00Z',
  };
  assert.equal(await expiring.writer.tick(new Date('2026-11-09T16:59:00Z')), false);
  assert.equal(await expiring.writer.tick(new Date('2026-11-09T17:00:00Z')), true, 'An expired note is rechecked');
  assert.equal(await expiring.writer.tick(new Date('2026-11-09T17:00:30Z')), false);
  assert.equal(rechecks, 1, 'Each expiry is rechecked once');
  expiring.writer.state.previous = {
    lines: valid,
    generated_at: now.toISOString(),
    expires_at: '2026-11-10T07:00:00Z',
  }; // 00:00 Denver
  const beforeQuiet = structuredClone(expiring.writer.state.expiryCheck);
  assert.equal(await expiring.writer.tick(new Date('2026-11-10T07:00:00Z')), false);
  assert.equal(await expiring.writer.tick(new Date('2026-11-10T12:59:00Z')), false);
  assert.deepEqual(expiring.writer.state.expiryCheck, beforeQuiet, 'Quiet hours do not consume an expiry attempt');
  assert.equal(rechecks, 1, 'Quiet hours skip the expiry recheck');
  assert.equal(await expiring.writer.tick(new Date('2026-11-10T13:00:00Z')), true);
  assert.equal(rechecks, 2, 'An expiry skipped during quiet hours is checked after quiet hours end');
  expiring.writer.state.previous = { lines: [], generated_at: now.toISOString(), expires_at: now.toISOString() };
  assert.equal(await expiring.writer.tick(new Date('2026-11-10T17:00:00Z')), false, 'A cleared note needs no recheck');

  const retryPath = join(directory, 'expiry-retry.json');
  const retryConfig = { assistant_state_file: retryPath };
  const retry = harness(retryConfig);
  let failedChecks = 0;
  const failCheck = async () => {
    failedChecks++;
    const persisted = JSON.parse(await readFile(retryPath, 'utf8')).expiryCheck;
    assert.equal(persisted.attempts, Math.min(failedChecks, 3), 'The budget is saved before the model is called');
    assert.equal(persisted.complete, false);
    if (failedChecks === 2) throw new Error('temporary model failure');
    return false;
  };
  retry.writer.state.previous = {
    lines: valid,
    generated_at: now.toISOString(),
    expires_at: '2026-11-09T17:00:00Z',
  };
  retry.writer.setDecision(failCheck);
  assert.equal(await retry.writer.tick(new Date('2026-11-09T17:00:00Z')), false);
  const restartedRetry = harness(retryConfig);
  await restartedRetry.writer.load();
  restartedRetry.writer.setDecision(failCheck);
  assert.equal(await restartedRetry.writer.tick(new Date('2026-11-09T17:04:59Z')), false);
  assert.equal(failedChecks, 1, 'Restart does not reset the retry delay');
  assert.equal(await restartedRetry.writer.tick(new Date('2026-11-09T17:05:00Z')), false);
  assert.equal(await restartedRetry.writer.tick(new Date('2026-11-09T17:09:59Z')), false);
  assert.equal(failedChecks, 2, 'A thrown model error also waits five minutes');
  assert.equal(await restartedRetry.writer.tick(new Date('2026-11-09T17:10:00Z')), false);
  assert.equal(await restartedRetry.writer.tick(new Date('2026-11-09T17:15:00Z')), false);
  assert.equal(failedChecks, 3, 'One expiry gets at most three attempts');
  const exhausted = harness(retryConfig);
  await exhausted.writer.load();
  exhausted.writer.setDecision(failCheck);
  assert.equal(await exhausted.writer.tick(new Date('2026-11-09T18:00:00Z')), false);
  assert.equal(failedChecks, 3, 'Restart does not reset an exhausted budget');
  assert.equal(await exhausted.writer.tick(new Date('2026-11-10T15:00:00Z')), false);
  assert.equal(failedChecks, 4, 'Configured screen slots remain independent of exhausted expiry retries');

  for (const operation of ['keep', 'clear']) {
    const handled = harness();
    const expiresAt = '2026-11-09T17:00:00Z';
    handled.writer.state.previous = { lines: handled.snapshot().lines, expires_at: expiresAt };
    if (operation === 'keep') handled.current = { state: '', last_changed: now.toISOString() };
    let handledChecks = 0;
    handled.writer.setDecision(async (trigger, at) => {
      handledChecks++;
      const result = await handled.writer.publish(
        { action: operation, lines: [], expires_at: null, base_version: handled.snapshot().version },
        { now: at },
      );
      assert.ok(['kept', 'cleared'].includes(result.status));
      return true;
    });
    assert.equal(await handled.writer.tick(new Date(expiresAt)), true);
    assert.equal(handled.writer.state.expiryCheck.complete, true);
    assert.equal(await handled.writer.tick(new Date('2026-11-09T17:05:00Z')), false);
    assert.equal(handledChecks, 1, `Successful ${operation} finishes the expiry check`);
  }

  const legacyPath = join(directory, 'legacy-expiry.json');
  const legacy = harness({ assistant_state_file: legacyPath });
  const legacyState = {
    ...legacy.writer.state,
    previous: { lines: valid, expires_at: '2026-11-09T17:00:00Z' },
    expiryChecked: '2026-11-09T17:00:00Z',
  };
  delete legacyState.expiryCheck;
  await writeFile(legacyPath, JSON.stringify(legacyState));
  await legacy.writer.load();
  let legacyChecks = 0;
  legacy.writer.setDecision(async () => {
    legacyChecks++;
    return true;
  });
  assert.equal(await legacy.writer.tick(new Date('2026-11-09T18:00:00Z')), true);
  assert.equal(await legacy.writer.tick(new Date('2026-11-09T18:05:00Z')), false);
  assert.equal(legacyChecks, 1, 'The old attempt marker cannot suppress the new bounded recovery');
  const completedLegacy = harness({ assistant_state_file: legacyPath });
  await completedLegacy.writer.load();
  completedLegacy.writer.setDecision(async () => {
    throw new Error('completed expiry should survive restart');
  });
  assert.equal(await completedLegacy.writer.tick(new Date('2026-11-09T18:10:00Z')), false);
  assert.equal(completedLegacy.writer.state.expiryCheck.complete, true);

  const off = harness({ assistant_screen_times: [] });
  off.writer.setDecision(async () => {
    throw new Error('disabled schedule');
  });
  assert.equal(await off.writer.tick(now), false);

  let settings = {
    assistant_prompt: '新提示词。',
    assistant_screen_times: ['09:00'],
    assistant_screen_quiet_start: '22:00',
    assistant_news_mode: 'morning',
    assistant_news_interval_hours: 3,
  };
  const hot = harness(
    {},
    { fetch: async () => ({ ok: true, json: async () => ({ result: 'ok', data: { options: settings } }) }) },
  );
  hot.writer.supervisorToken = 'test-supervisor';
  let hotChecks = 0;
  hot.writer.setDecision(async () => {
    hotChecks++;
    return true;
  });
  assert.equal(await hot.writer.tick(now), false);
  assert.equal(hot.writer.settings.assistant_screen_quiet_start, '22:00');
  assert.equal(await hot.writer.tick(new Date('2026-11-09T16:00:00Z')), true);
  assert.equal(hotChecks, 1);
  settings = { ...settings, assistant_prompt: '更新后的提示词。', assistant_screen_quiet_start: '21:00' };
  assert.equal(await hot.writer.readPrompt(), '新提示词。');
  assert.equal(hot.writer.settings.assistant_screen_quiet_start, '22:00', 'Reading a prompt does not refresh live settings');
  await hot.writer.refreshSettings();
  assert.equal(await hot.writer.readPrompt(), '更新后的提示词。');
  assert.equal(hot.writer.settings.assistant_screen_quiet_start, '21:00');
  settings = { ...settings, assistant_screen_times: ['25:00'] };
  await hot.writer.refreshSettings();
  assert.deepEqual(
    hot.writer.settings.assistant_screen_times,
    ['09:00'],
    'Invalid live settings do not replace the last valid values',
  );

  const published = harness({ assistant_state_file: join(directory, 'published.json') });
  assert.deepEqual(await published.writer.publish(published.action(), { now }), { status: 'updated' });
  assert.equal(published.current.state, valid[0]);
  assert.equal(published.writes.length, 1);
  const saved = JSON.parse(await readFile(join(directory, 'published.json'), 'utf8'));
  assert.equal(saved.writes.length, 1);
  assert.deepEqual(published.snapshot().history, [{ at: now.toISOString(), lines: valid }]);
  const restored = harness({ assistant_state_file: join(directory, 'published.json') });
  await restored.writer.load();
  assert.deepEqual(
    restored.snapshot().history,
    published.snapshot().history,
    'Confirmed note history survives restart',
  );
  const history = harness();
  history.writer.state.reminders = Array.from({ length: 26 }, (_, i) => ({
    at: new Date(+now - (26 - i) * 60000).toISOString(),
    lines: [`历史便条 ${i}。`],
    private: 'not-model-data',
  }));
  const noteHistory = history.snapshot().history;
  assert.equal(noteHistory.length, 24);
  assert.equal(noteHistory[0].lines[0], '历史便条 2。');
  assert.deepEqual(Object.keys(noteHistory[0]), ['at', 'lines']);
  noteHistory[0].lines[0] = '不应修改持久化记录。';
  assert.equal(history.writer.state.reminders[2].lines[0], '历史便条 2。');
  history.writer.state.reminders = [
    null,
    {},
    { at: 'bad-date', lines: valid },
    { at: now.toISOString(), lines: [null] },
    { at: new Date(+now + 60000).toISOString(), lines: valid },
    { at: now.toISOString(), lines: [] },
  ];
  assert.deepEqual(
    history.snapshot().history,
    [{ at: now.toISOString(), lines: [] }],
    'Ignore malformed/future history; retain clearing records',
  );
  const keep = { action: 'keep', base_version: published.snapshot().version, lines: [], expires_at: null };
  assert.deepEqual(await published.writer.publish(keep, { now }), { status: 'kept' });
  assert.equal(published.writes.length, 1);
  const formerExpiry = published.writer.state.previous.expires_at;
  assert.equal((await published.writer.publish(published.action(), { now })).status, 'kept');
  assert.equal(published.writer.state.previous.expires_at, formerExpiry, 'Repeated text does not extend expiry');
  assert.deepEqual(
    await published.writer.publish(published.action({ action: 'clear', lines: [], expires_at: null }), { now }),
    { status: 'cleared' },
  );
  assert.deepEqual(
    await published.writer.publish(published.action({ action: 'clear', lines: [], expires_at: null }), {
      now: new Date('2026-11-09T15:16:00Z'),
    }),
    { status: 'kept', reason: 'empty' },
  );
  assert.equal(published.current.state, '');

  const stale = harness();
  const outdated = stale.action();
  stale.current = { state: '用户已经手动改过。', last_changed: now.toISOString() };
  assert.equal((await stale.writer.publish(outdated, { now })).reason, 'stale_version');
  assert.equal(stale.writes.length, 0);
  const race = harness(
    {},
    {
      measure: async () => {
        race.current = { state: '校验期间外部更新。', last_changed: now.toISOString() };
        return [];
      },
    },
  );
  assert.equal((await race.writer.publish(race.action(), { now })).reason, 'stale_version');
  assert.equal(race.writes.length, 0);
  const empty = harness();
  empty.current = { state: '', last_changed: now.toISOString() };
  const blankVersion = empty.writer.screenState({}, now).version;
  assert.equal(blankVersion, empty.snapshot().version);
  for (const action of ['keep', 'clear'])
    assert.deepEqual(
      await empty.writer.publish(empty.action({ action, lines: [], expires_at: null }), { now }),
      { status: 'kept', reason: 'empty' },
      'Keeping or clearing an empty screen does not claim to retain an existing note',
    );
  assert.equal(empty.writes.length, 0, 'An empty no-op does not write or consume the update allowance');
  assert.equal((await empty.writer.publish(empty.action(), { now })).status, 'updated');
  assert.equal((await empty.writer.publish(empty.action(), { now, trigger: 'manual' })).status, 'kept');

  const quiet = harness();
  assert.equal(
    (
      await quiet.writer.publish(quiet.action({ expires_at: '2026-11-10T07:00:00Z' }), {
        now: new Date('2026-11-10T06:00:00Z'),
      })
    ).reason,
    'quiet_hours',
  );
  const noQuiet = harness({ assistant_screen_quiet_start: '00:00', assistant_screen_quiet_end: '00:00' });
  assert.equal(
    (
      await noQuiet.writer.publish(noQuiet.action({ expires_at: '2026-11-10T07:00:00Z' }), {
        now: new Date('2026-11-10T06:00:00Z'),
      })
    ).status,
    'updated',
  );
  const rapid = harness();
  rapid.writer.state.writes = Array(4).fill(+now - 1000);
  for (let i = 0; i < 6; i++)
    assert.equal(
      (await rapid.writer.publish(rapid.action({ lines: [`第${i + 1}次连续更新。`] }), { now })).status,
      'updated',
      'Recent HA changes and existing write history do not limit automatic updates',
    );
  assert.equal(rapid.writes.length, 6);
  assert.equal(rapid.writer.state.writes.length, 10);
  assert.equal(rapid.snapshot().last_pushed_at, now.toISOString());
  const expired = harness();
  expired.writer.state.previous = { lines: expired.snapshot().lines, expires_at: now.toISOString() };
  assert.equal(
    (await expired.writer.publish({ action: 'keep', base_version: expired.snapshot().version }, { now })).reason,
    'expired_keep',
  );
  assert.deepEqual(expired.writer.panelLines(expired.snapshot().lines, now), []);

  const bad = harness();
  for (const extra of [
    { lines: ['不是完整句子'] },
    { lines: ['A'.repeat(90) + '。'] },
    { expires_at: null },
    { expires_at: '2026-11-10T00:00:00Z' },
    { bad_key: true },
    { trigger: 'manual' },
    { action: 'launch' },
  ])
    assert.equal((await bad.writer.publish(bad.action(extra), { now })).status, 'rejected');
  assert.equal(bad.writes.length, 0);
  const refused = harness({}, { ignoreWrites: true });
  assert.equal((await refused.writer.publish(refused.action(), { now })).reason, 'write_not_confirmed');
  assert.equal(refused.writer.state.previous, null);
  const canceled = harness();
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (await canceled.writer.publish(canceled.action(), { now, signal: controller.signal })).reason,
    'canceled',
  );
  assert.equal(canceled.writes.length, 0);

  const news = harness();
  assert.equal((await news.writer.publish(news.action({ news_ids: ['news:test'] }), { now })).status, 'updated');
  assert.ok(news.writer.state.usedNews.includes('news:test'));
  assert.equal(news.writer.state.morningNewsDay, '2026-11-09');
  const priorText = news.current.state;
  news.current = { state: '另一条有效便条。', last_changed: '2026-11-09T13:00:00Z' };
  for (const trigger of ['scheduled', 'manual'])
    assert.equal(
      (await news.writer.publish(news.action({ news_ids: ['news:test'] }), { now, trigger })).reason,
      'news_already_used',
    );
  assert.notEqual(news.current.state, priorText);
  const newsOff = harness({ assistant_news_mode: 'off' });
  for (const trigger of ['scheduled', 'manual'])
    assert.equal(
      (await newsOff.writer.publish(newsOff.action({ news_ids: ['news:test'] }), { now, trigger })).reason,
      'news_display_frequency',
    );

  const damagedPath = join(directory, 'damaged.json');
  await writeFile(damagedPath, '{broken');
  const damaged = harness({ assistant_state_file: damagedPath });
  await damaged.writer.load();
  assert.equal((await damaged.writer.publish(damaged.action(), { now })).reason, 'schedule_state_unavailable');
  console.log(
    'Assistant screen: fixed configured slots/hot reload/DST/restart, unified decision delegation, independent action validation, fresh versions, quiet hours, unrestricted update frequency, confirmed writes and LLM options checked.',
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
