import assert from 'node:assert/strict';
import { AssistantNews } from '../../../ha-app/server/assistant/news-context.mjs';

const now = new Date('2026-11-09T14:00:00Z');
const context = {
  timezone: 'America/Denver',
  weather: { city: 'Denver' },
  newsletter: {
    id: 'nyt-mail:issue-1',
    title: 'The Morning',
    summary: '早报'.repeat(500),
    site: 'The New York Times',
    date: now.toISOString(),
    scope: 'general',
    body: 'PRIVATE_BODY',
    sender: 'PRIVATE_EMAIL',
  },
};
const general = {
  title: '中国要闻',
  summary: '新闻'.repeat(500),
  url: 'https://www.chinanews.com.cn/one',
  site: '中新网',
  date: now.toISOString(),
  scope: 'general',
};
const local = { ...general, title: '城市新闻', url: 'https://local.example/one', site: 'Local', scope: 'local' };
const people = {
  title: '头版要闻',
  summary: '',
  url: 'https://paper.people.com.cn/rmrb/pc/content/202611/09/content_1.html',
  site: '人民日报',
  date: '2026-11-09',
  date_precision: 'day',
  source_timezone: 'Asia/Shanghai',
  scope: 'general',
};

let calls = 0;
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
const cache = new AssistantNews({
  newsSources: async () => {
    calls++;
    await gate;
    return [general, local, people, general];
  },
});
const early = await cache.snapshot(context, now, { wait: false });
assert.equal(calls, 1);
assert.equal(early.length, 1, 'Cold-cache chat immediately receives current NYT without waiting for public HTTP');
assert.equal([...early[0].summary].length, 400);
const waiting = cache.snapshot(context, now);
assert.equal(calls, 1, 'Concurrent snapshots share one public refresh');
release();
const all = await waiting;
assert.deepEqual(
  all.map((x) => x.site),
  ['The New York Times', '中新网', 'Local', '人民日报'],
);
assert.ok(all.every((x) => /^news:[a-f0-9]{64}$/.test(x.id)));
assert.ok(all.every((x) => [...x.summary].length <= 400));
assert.ok(!JSON.stringify(cache).includes('PRIVATE_BODY') && !JSON.stringify(all).includes('PRIVATE_EMAIL'));
const edition = all.find((x) => x.site === '人民日报');
assert.equal(edition.date_precision, 'day');
assert.equal(edition.source_timezone, 'Asia/Shanghai');
assert.equal(edition.date, '2026-11-09', 'Edition day is not fabricated as a publication timestamp');

const repeated = await cache.snapshot(context, new Date(+now + 29 * 60000));
assert.equal(calls, 1);
assert.deepEqual(
  repeated.map((x) => x.id),
  all.map((x) => x.id),
);
repeated[1].title = 'Changed outside cache';
assert.equal((await cache.snapshot(context, now))[1].title, general.title, 'Callers cannot mutate cached context');
await cache.snapshot(context, new Date(+now + 30 * 60000));
assert.equal(calls, 2, 'Thirty-minute refresh does not depend on broadcast mode');
await cache.snapshot({ ...context, weather: { city: 'Seattle' } }, now);
assert.equal(calls, 3, 'A city change invalidates public local news');

const tomorrow = new Date('2026-11-10T14:00:00Z');
const nextDay = await cache.snapshot(context, tomorrow);
assert.equal(calls, 4);
assert.deepEqual(
  nextDay.map((x) => x.site),
  ['人民日报'],
  'Old timestamped feeds and NYT expire; yesterday’s Shanghai edition stays eligible',
);
assert.deepEqual(
  await cache.snapshot(context, new Date('2026-11-11T14:00:00Z')),
  [],
  'Old newspaper editions also expire',
);

const staleAndUnsafe = new AssistantNews({
  newsSources: async () => [
    { ...general, title: 'Future', date: new Date(+now + 60000).toISOString() },
    { ...general, title: 'No timezone', date: '2026-11-09T14:00:00' },
    { ...general, title: 'Unsafe URL', url: 'javascript:alert(1)' },
    { ...general, title: 'Credentials', url: 'https://name:password@example.com/' },
    ...Array.from({ length: 20 }, (_, i) => ({ ...general, title: 'Item ' + i, url: 'https://news.example/' + i })),
  ],
});
assert.equal((await staleAndUnsafe.snapshot({ ...context, newsletter: null }, now)).length, 10);

let reject = false;
const failedRefresh = new AssistantNews({
  newsSources: async () => {
    if (reject) throw new Error('feed unavailable');
    return [general];
  },
});
await failedRefresh.snapshot(context, now);
reject = true;
const retained = await failedRefresh.snapshot(context, new Date(+now + 31 * 60000));
assert.equal(retained.length, 2, 'A failed refresh preserves still-valid cached headlines and current newsletter');

let fetches = 0;
const partial = new AssistantNews({
  fetch: async (url) => {
    fetches++;
    if (url.startsWith('https://paper.people.com.cn/')) throw new Error('newspaper down');
    const localFeed = url.startsWith('https://news.google.com/');
    return new Response(
      `<rss><channel><title>${localFeed ? 'Local' : '中新网'}</title><item><title>${localFeed ? '城市报道' : '国内报道'}</title><link>https://news.example/${localFeed ? 'local' : 'china'}</link><description>摘要</description><pubDate>Mon, 09 Nov 2026 14:00:00 GMT</pubDate></item></channel></rss>`,
    );
  },
});
assert.equal(
  (await partial.snapshot(context, now)).length,
  3,
  'A newspaper failure leaves NYT and both RSS sources available',
);
assert.equal(fetches, 3);

let editionCalls = 0;
const editionCache = new AssistantNews({
  newsSources: async (sourceContext) => {
    editionCalls++;
    assert.deepEqual(
      Object.keys(sourceContext).sort(),
      ['timezone', 'weather'],
      'Public source loaders never receive user history or newsletter bodies',
    );
    return [people];
  },
});
await editionCache.snapshot(context, new Date('2026-11-09T15:50:00Z'));
await editionCache.snapshot(context, new Date('2026-11-09T16:10:00Z'));
assert.equal(
  editionCalls,
  2,
  'Shanghai midnight refreshes edition data even when the display’s local day has not changed',
);

const releases = new Map();
let cityCalls = 0;
const concurrent = new AssistantNews({
  newsSources: async (sourceContext) => {
    cityCalls++;
    const city = sourceContext.weather.city;
    await new Promise((resolve) => releases.set(city, resolve));
    return [{ ...local, title: city, site: city, url: 'https://local.example/' + encodeURIComponent(city) }];
  },
});
const denverSnapshot = concurrent.snapshot(context, now);
const seattleContext = { ...context, weather: { city: 'Seattle' } };
const seattle = concurrent.snapshot(seattleContext, now);
await Promise.resolve();
releases.get('Seattle')();
await seattle;
releases.get('Denver')();
await denverSnapshot;
assert.equal((await concurrent.snapshot(seattleContext, now)).at(-1).site, 'Seattle');
assert.equal(cityCalls, 2, 'A late response for an old city cannot replace the latest city cache');

const articleCalls = [];
const full = new AssistantNews({
  newsSources: async () => [general],
  fetch: async (url, options) => {
    articleCalls.push({ url, options });
    return new Response(
      '<html><head><title>页面标题</title><style>PRIVATE_STYLE</style></head><body><script>PRIVATE_SCRIPT</script><article>新闻正文 &amp; &quot;引文&quot; &#x1f680;</article></body></html>',
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  },
});
const short = await full.snapshot(context, now);
assert.equal(articleCalls.length, 0, 'Initial shared context never fetches article pages');
assert.equal(await full.detail('https://www.chinanews.com.cn/arbitrary', context, now), null);
assert.equal(await full.detail('news:' + '0'.repeat(64), context, now), null);
assert.equal(articleCalls.length, 0, 'Only a known article ID authorizes an on-demand read');
const publicID = short.find((x) => x.site === '中新网').id;
const detail = await full.detail(publicID, context, now);
assert.equal(detail.id, publicID);
assert.equal(detail.title, general.title);
assert.equal(detail.text, '新闻正文 & "引文" 🚀');
assert.equal(detail.truncated, false);
assert.ok(!JSON.stringify(detail).includes('PRIVATE_'));
assert.equal(articleCalls.length, 1);
assert.ok(articleCalls[0].options.signal);
assert.equal(articleCalls[0].options.redirect, 'manual');
assert.equal(articleCalls[0].options.credentials, 'omit');
assert.equal(articleCalls[0].options.headers.Authorization, undefined);
detail.text = 'tampered';
assert.equal((await full.detail(publicID, context, new Date(+now + 29 * 60000))).text, '新闻正文 & "引文" 🚀');
assert.equal(articleCalls.length, 1);
await full.detail(publicID, context, new Date(+now + 30 * 60000));
assert.equal(articleCalls.length, 2, 'Article text is refreshed after thirty minutes');
assert.equal(
  await full.detail(publicID, context, tomorrow),
  null,
  'An expired candidate cannot read cached or remote article text',
);

const longMail = {
  ...context,
  newsletter: { ...context.newsletter, id: 'nyt-mail:long', summary: '原文'.repeat(4000) },
};
const mailID = (await full.snapshot(longMail, now))[0].id;
const mailDetail = await full.detail(mailID, longMail, now);
assert.equal([...mailDetail.text].length, 6000);
assert.equal(mailDetail.truncated, true);
assert.equal(
  articleCalls.length,
  2,
  'NYT detail uses only the already validated current newsletter, without mailbox or network access',
);
for (let i = 0; i < 12; i++) {
  const issue = { ...context, newsletter: { ...context.newsletter, id: 'nyt-mail:edition-' + i } };
  const id = (await full.snapshot(issue, now))[0].id;
  await full.detail(id, issue, now);
}
assert.ok(full.details.size <= 10, 'At most ten bounded full-text excerpts are retained');

for (const response of [
  () => new Response('x', { headers: { 'content-length': String(1024 * 1024 + 1) } }),
  () => new Response('x'.repeat(1024 * 1024 + 1)),
  () => new Response('PRIVATE_BINARY', { headers: { 'content-type': 'application/octet-stream' } }),
  () => new Response('', { status: 503 }),
  () => {
    throw new Error('network failure');
  },
]) {
  const unavailable = new AssistantNews({ newsSources: async () => [general], fetch: async () => response() });
  const id = (await unavailable.snapshot(context, now)).find((x) => x.site === '中新网').id;
  assert.equal(
    await unavailable.detail(id, context, now),
    null,
    'Failed or oversized reads do not fabricate full article text from a headline',
  );
}

let redirected = 0;
const sameOrigin = new AssistantNews({
  newsSources: async () => [general],
  fetch: async () => {
    redirected++;
    return redirected === 1
      ? new Response('', { status: 302, headers: { location: '/final-article' } })
      : new Response('<p>同源正文</p>');
  },
});
const redirectID = (await sameOrigin.snapshot(context, now)).find((x) => x.site === '中新网').id;
assert.equal((await sameOrigin.detail(redirectID, context, now)).text, '同源正文');
assert.equal(redirected, 2);
let crossOrigin = 0;
const redirectedAway = new AssistantNews({
  newsSources: async () => [general],
  fetch: async () => {
    crossOrigin++;
    return new Response('', { status: 302, headers: { location: 'http://127.0.0.1:8080/assistant/state' } });
  },
});
const blockedID = (await redirectedAway.snapshot(context, now)).find((x) => x.site === '中新网').id;
assert.equal(await redirectedAway.detail(blockedID, context, now), null);
assert.equal(crossOrigin, 1);
const localURL = new AssistantNews({
  newsSources: async () => [{ ...general, url: 'http://192.168.1.20:8080/assistant/state' }],
  fetch: async () => {
    throw new Error('Must not fetch local/private endpoints');
  },
});
const localID = (await localURL.snapshot(context, now)).find((x) => x.site === '中新网').id;
assert.equal(
  await localURL.detail(localID, context, now),
  null,
  'Even a hostile cached RSS link cannot authorize fetching the local network',
);
let upgradedURL;
const legacyHTTP = new AssistantNews({
  newsSources: async () => [{ ...general, url: 'http://www.chinanews.com.cn/legacy' }],
  fetch: async (url) => {
    upgradedURL = url;
    return new Response('正文');
  },
});
const legacyID = (await legacyHTTP.snapshot(context, now)).find((x) => x.site === '中新网').id;
assert.equal((await legacyHTTP.detail(legacyID, context, now)).text, '正文');
assert.equal(
  upgradedURL,
  'https://www.chinanews.com.cn/legacy',
  'Legacy official HTTP article links are upgraded before any request',
);
console.log(
  'Shared news: compact four-source context, nonblocking/coalesced cache, city/date rollover, isolation and freshness checked.',
);
