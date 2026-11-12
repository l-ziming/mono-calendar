import assert from 'node:assert/strict';
import { fetchPeopleNews, parsePeopleFrontPage } from '../../../ha-app/server/sources/people-news.mjs';

const root = 'https://paper.people.com.cn/rmrb/pc/layout/';
const front = root + '202611/07/node_01.html';
const now = new Date('2026-11-07T21:35:00Z'); // Already Nov 8 in the newspaper's timezone.
const index =
  '<ul id="list" style="display:none"><li><a href="202611/07/node_01.html" target="_blank"><img src="x"/><br/>第01版 要闻</a></li></ul>';
const page = `<div class="date-box"><p class="date left">人民日报 <span class="newstime">2026年11月07日 Sat</span></p></div>
<area href="../../../content/202611/07/content_30189948.html">
<a href="../../../content/202611/07/content_30189948.html"> 第一条  要闻 </a>
<a href="../../../content/202611/07/content_30189948.html">重复链接</a>
<a href="https://bad.example/rmrb/pc/content/202611/07/content_3.html">站外</a>
<a href="../../../content/202611/06/content_3.html">旧版文章</a>
<a href="../../../content/202611/07/content_30189949.html"><b>第二条</b>&amp;要闻</a>
<a href="../../../content/202611/07/content_30189950.html">&#31532;三条</a>
<a href="../../../content/202611/07/content_30189951.html">第四条</a>`;
const items = parsePeopleFrontPage(page, front, now);
assert.equal(items.length, 3);
assert.deepEqual(
  items.map((x) => x.title),
  ['第一条 要闻', '第二条 &要闻', '第三条'],
);
assert.deepEqual(items[0], {
  title: '第一条 要闻',
  summary: '',
  url: 'https://paper.people.com.cn/rmrb/pc/content/202611/07/content_30189948.html',
  site: '人民日报',
  date: '2026-11-07',
  date_precision: 'day',
  source_timezone: 'Asia/Shanghai',
  scope: 'general',
});
assert.equal(parsePeopleFrontPage(page, front, new Date('2026-11-07T03:00:00Z')).length, 3, 'current Shanghai edition');
assert.equal(
  parsePeopleFrontPage(page, front, new Date('2026-11-08T17:00:00Z')).length,
  0,
  'two-day-old edition rejected',
);
assert.equal(parsePeopleFrontPage(page, front, new Date('2026-11-06T03:00:00Z')).length, 0, 'future edition rejected');
assert.equal(
  parsePeopleFrontPage(page.replace('newstime', 'other'), front, now).length,
  0,
  'visible edition date required',
);
assert.equal(
  parsePeopleFrontPage(page.replace('2026年11月07日', '2026年11月08日'), front, now).length,
  0,
  'path and printed edition must agree',
);
assert.equal(parsePeopleFrontPage(page, front, now, 1).length, 1);
assert.equal(parsePeopleFrontPage(page, front, now, 99).length, 3);
assert.equal(parsePeopleFrontPage(page, front, now, NaN).length, 3);
const calls = [];
const fake = async (url, options) => {
  calls.push({ url, options });
  return new Response(url === root ? index : page);
};
assert.deepEqual(await fetchPeopleNews({}, { now, fetch: fake }), items);
assert.deepEqual(
  calls.map((x) => x.url),
  [root, front],
);
assert.ok(calls.every((x) => x.options.redirect === 'manual' && x.options.signal));
await assert.rejects(
  fetchPeopleNews(
    {},
    { now, fetch: async () => new Response('', { status: 302, headers: { location: 'https://bad.example/' } }) },
  ),
  /Unexpected newspaper URL/,
);
await assert.rejects(
  fetchPeopleNews(
    {},
    {
      now,
      fetch: async () => new Response('', { status: 200, headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
    },
  ),
  /too large/,
);
await assert.rejects(
  fetchPeopleNews({}, { now, fetch: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }),
  /too large/,
);
await assert.rejects(fetchPeopleNews({}, { now, fetch: async () => new Response('', { status: 503 }) }), /503/);
assert.deepEqual(
  await fetchPeopleNews({}, { now, fetch: async () => new Response(index.replace('node_01', 'node_02')) }),
  [],
  'only the front page is fetched',
);
console.log(
  'People\u2019s Daily: bounded official front page, dedupe, edition date and source-timezone freshness passed.',
);
