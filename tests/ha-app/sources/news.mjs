import assert from 'node:assert/strict';
import { parseRss, fetchSources } from '../../../ha-app/server/sources/news.mjs';

const now = new Date('2026-11-07T21:13:00Z');
const timezone = 'America/Denver';
const context = { weather: { city: '丹佛' } };
const china = 'https://www.chinanews.com.cn/rss/importnews.xml';
const article = 'https://news.example.test/2026/11/07/historic-house/';
const feed = (items) =>
  `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>测试新闻</title><lastBuildDate>Sat, 7 Nov 2026 20:00:00 GMT</lastBuildDate>${items}</channel></rss>`;
const item = (id, date = 'Sat, 7 Nov 2026 13:01:53 GMT') =>
  `<item><title>新闻${id}</title><link>https://example.test/${id}</link><description><![CDATA[<p>报道摘要。</p>]]></description><pubDate>${date}</pubDate><guid isPermaLink="false">${id}</guid><source url="https://example.test">新闻来源</source></item>`;
// Same shape as a Google News city feed item: publisher suffix in the title, anchor-only description.
const local = feed(
  `<item><title>A historic downtown house is the last holdout on a rapidly developing block. Here’s a peek inside. - Example Daily</title><link>${article}</link><description><![CDATA[<a href="${article}">A historic downtown house</a>]]></description><pubDate>Sat, 07 Nov 2026 13:01:53 GMT</pubDate><source url="https://news.example.test">Example Daily</source></item>`,
);
// Original ChinaNews item captured from the same day's public feed: no guid or source.
const chinaItem =
  '<item><title>海军首批舰载机女飞行学员结业赴一线部队</title><link>https://www.chinanews.com.cn/gn/2026/11-07/10728127.shtml</link><description>　　新华社快讯：记者11月7日从海军航空大学获悉，海军首批舰载机女飞行学员全部通过结业考核赴一线部队。这标志着海军航空兵人才梯队建设再添新生力量，海军舰载机飞行人才培养取得突破性进展。</description><pubDate>Sat, 7 Nov 2026 20:42:52 +0800</pubDate></item>';
const chinaParsed = parseRss(feed(chinaItem))[0];
assert.equal(chinaParsed.title, '海军首批舰载机女飞行学员结业赴一线部队');
assert.equal(chinaParsed.url, 'https://www.chinanews.com.cn/gn/2026/11-07/10728127.shtml');
assert.equal(chinaParsed.date, 'Sat, 7 Nov 2026 20:42:52 +0800');
assert.equal(chinaParsed.guid, '');
assert.equal(chinaParsed.site, '测试新闻', 'The feed title supplies missing publisher information');
assert.ok(chinaParsed.summary.startsWith('新华社快讯：'), 'Ideographic padding is removed');
const chinaNews = await fetchSources({}, { now, timezone, fetch: async () => new Response(feed(chinaItem)) });
assert.equal(chinaNews[0].date, '2026-11-07T12:42:52.000Z');
assert.equal(chinaNews[0].scope, 'general');
const parsed = parseRss(local);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].date, 'Sat, 07 Nov 2026 13:01:53 GMT');
assert.equal(parsed[0].site, 'Example Daily');
assert.equal(parsed[0].summary, 'A historic downtown house');
assert.equal(parsed[0].url, article);

const entities = parseRss(
  feed(
    `<item><title>A &amp; B &#x1F30D; &quot;新闻&quot; &apos;好&apos; &#20013;</title><link>https://example.test/story?a=1&amp;b=2</link><description><![CDATA[<p>第一段 &amp; 正文。</p><script>bad()</script><style>.bad{}</style><p>第二段<br/>继续。 <item>这不是另一条新闻</item></p>]]></description><pubDate>Sat, 7 Nov 2026 13:00:00 GMT</pubDate><guid isPermaLink="false">internal-id</guid><source url="https://example.test">A &amp; B</source></item>`,
  ),
);
assert.equal(entities.length, 1, 'CDATA markup cannot create extra news items');
assert.equal(entities[0].title, 'A & B 🌍 "新闻" \'好\' 中');
assert.equal(entities[0].url, 'https://example.test/story?a=1&b=2');
assert.equal(entities[0].summary, '第一段 & 正文。 第二段 继续。 这不是另一条新闻');
assert.equal(entities[0].guid, 'internal-id');
assert.equal(entities[0].site, 'A & B');
assert.equal(
  parseRss(feed('<item><title>&amp;lt;</title></item>'))[0].title,
  '&lt;',
  'XML text is not repeatedly decoded',
);
assert.equal(
  parseRss(feed('<item><title>标题</title><description>&lt;p&gt;A &amp;amp; B&lt;/p&gt;</description></item>'))[0]
    .summary,
  'A & B',
  'Encoded HTML is rendered as text',
);
assert.equal(
  parseRss(
    feed(
      '<item><title>标题</title><description><![CDATA[<a title="A > B" href="https://example.test">Hello&nbsp;&nbsp;World &mdash; today</a>]]></description></item>',
    ),
  )[0].summary,
  'Hello World — today',
  'HTML attributes and common named entities remain readable',
);
assert.equal(
  parseRss(feed('<item><title>标题</title><guid>https://example.test/permalink</guid></item>'))[0].url,
  'https://example.test/permalink',
);
assert.equal(
  parseRss(feed('<item><title>标题</title><guid isPermaLink="false">https://example.test/id</guid></item>'))[0].url,
  '',
  'Opaque GUIDs are not links',
);
for (const xml of [
  '<html><body>Error</body></html>',
  '<rss><channel><item></channel></rss>',
  '<rss><other><item/></other></rss>',
  '<!DOCTYPE rss [<!ENTITY remote SYSTEM "https://example.test/entity">]>' + local,
]) {
  assert.deepEqual(parseRss(xml), []);
}

const calls = [];
const mixed = feed(
  item('china', 'Sat, 7 Nov 2026 20:42:52 +0800') +
    item('yesterday', 'Sat, 7 Nov 2026 06:59:59 GMT') +
    item('midnight', 'Sat, 7 Nov 2026 07:00:00 GMT') +
    item('future', 'Sat, 7 Nov 2026 22:00:00 GMT') +
    item('missing', '') +
    item('invalid', 'not a date') +
    item('nozone', '2026-11-07T13:00:00') +
    item('china', 'Sat, 7 Nov 2026 20:42:52 +0800'),
);
const fetch = async (url, options) => {
  calls.push({ url, options });
  return new Response(url === china ? mixed : local);
};
const news = await fetchSources(context, { now, timezone, fetch });
assert.equal(news.length, 3, 'Only valid, distinct, nonfuture items from the local calendar day survive');
assert.deepEqual(
  news.filter((x) => x.scope === 'general').map((x) => x.date),
  ['2026-11-07T12:42:52.000Z', '2026-11-07T07:00:00.000Z'],
);
assert.equal(news.find((x) => x.scope === 'local').date, '2026-11-07T13:01:53.000Z');
assert.deepEqual(Object.keys(news[0]).sort(), ['date', 'scope', 'site', 'summary', 'title', 'url']);
assert.equal(
  decodeURIComponent(new URL(calls[1].url).pathname),
  '/rss/headlines/section/geo/丹佛',
  'The displayed city is used without a city-specific mapping',
);
assert.ok(
  calls.every((x) => x.options.redirect === 'manual' && x.options.signal instanceof AbortSignal && !x.options.headers),
  'Public sources receive no credential headers',
);
const other = [];
await fetchSources(
  { weather: { city: 'Seattle, Washington' } },
  {
    now,
    timezone,
    fetch: async (url) => {
      other.push(url);
      return new Response(local);
    },
  },
);
assert.match(decodeURIComponent(other[1]), /geo\/Seattle, Washington/);
const blank = [];
await fetchSources(
  { weather: { city: '' } },
  {
    now,
    timezone,
    fetch: async (url) => {
      blank.push(url);
      return new Response(mixed);
    },
  },
);
assert.deepEqual(blank, [china], 'A missing city does not select an invented local area');
const capped = await fetchSources(context, {
  now,
  timezone,
  limit: 2,
  fetch: async () => new Response(feed([1, 2, 3, 4].map((x) => item(x)).join(''))),
});
assert.equal(capped.filter((x) => x.scope === 'general').length, 2);
assert.equal(capped.filter((x) => x.scope === 'local').length, 2, 'Each source has its own cap');
const partial = await fetchSources(context, {
  now,
  timezone,
  fetch: async (url) => {
    if (url === china) {
      throw new Error('offline');
    }
    return new Response(local);
  },
});
assert.deepEqual(
  partial.map((x) => x.scope),
  ['local'],
  'A failed source does not suppress another source',
);

let redirected = 0;
const redirect = await fetchSources(
  {},
  {
    now,
    timezone,
    fetch: async (url, options) => {
      redirected++;
      assert.equal(options.redirect, 'manual');
      return redirected === 1
        ? new Response(null, { status: 302, headers: { location: '/rss/importnews.xml?fresh=1' } })
        : new Response(mixed);
    },
  },
);
assert.equal(redirected, 2);
assert.equal(redirect.length, 2, 'Same-origin redirects are allowed');
for (const location of [
  'https://elsewhere.test/rss',
  'http://www.chinanews.com.cn/rss/importnews.xml',
  'https://www.chinanews.com.cn:8443/rss',
  'https://user:pass@www.chinanews.com.cn/rss',
]) {
  let requests = 0;
  assert.deepEqual(
    await fetchSources(
      {},
      {
        now,
        timezone,
        fetch: async () => {
          requests++;
          return new Response(null, { status: 302, headers: { location } });
        },
      },
    ),
    [],
  );
  assert.equal(requests, 1, 'An unsafe redirect is never followed');
}
let cancelled = false;
const oversized = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('中'.repeat(700000)));
  },
  cancel() {
    cancelled = true;
  },
});
const bounded = await fetchSources(context, {
  now,
  timezone,
  fetch: async (url) => new Response(url === china ? oversized : local),
});
assert.ok(cancelled, 'Oversized streaming bodies are cancelled by byte count');
assert.deepEqual(
  bounded.map((x) => x.scope),
  ['local'],
  'An oversized feed does not suppress another source',
);
let headerCancelled = false;
const declared = new ReadableStream({
  cancel() {
    headerCancelled = true;
  },
});
assert.deepEqual(
  await fetchSources(
    {},
    {
      now,
      timezone,
      fetch: async () => new Response(declared, { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
    },
  ),
  [],
);
assert.ok(headerCancelled, 'An excessive declared body is cancelled before reading');
console.log(
  'News RSS: real publication timestamps, XML/CDATA, local dates, per-source caps, isolation, redirects and byte limits passed.',
);
