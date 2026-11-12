import { localDay } from '../core.mjs';

// The current People's Daily front page. Edition dates are dates, not publication timestamps.
const ORIGIN = 'https://paper.people.com.cn';
const ROOT = ORIGIN + '/rmrb/pc/layout/';
const ZONE = 'Asia/Shanghai';
const MAX_BYTES = 2 * 1024 * 1024;
const layoutPath = /^\/rmrb\/pc\/layout\/(?:\d{6}\/\d{2}\/node_01\.html)?$/;
const articlePath = /^\/rmrb\/pc\/content\/(\d{4})(\d{2})\/(\d{2})\/content_\d+\.html$/;

function text(html) {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entityCode) => {
      const namedEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (entityCode[0] !== '#') {
        return namedEntities[entityCode.toLowerCase()];
      }
      const codePoint =
        entityCode[1].toLowerCase() === 'x' ? parseInt(entityCode.slice(2), 16) : Number(entityCode.slice(1));
      return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}
function links(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi)].map((x) => ({
    href: x[2],
    title: text(x[3]),
  }));
}
function official(url, pattern) {
  return (
    url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash && pattern.test(url.pathname)
  );
}
function isoDate(y, m, d) {
  const date = `${y}-${m}-${d}`;
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
}
export function parsePeopleFrontPage(html, url, now = new Date(), limit = 3) {
  const page = new URL(url);
  if (!official(page, layoutPath)) {
    return [];
  }
  const stamp = html.match(/<span\b[^>]*class\s*=\s*(["'])[^"']*\bnewstime\b[^"']*\1[^>]*>([\s\S]*?)<\/span\s*>/i);
  const dateMatch = stamp && text(stamp[2]).match(/^(\d{4})年(\d{2})月(\d{2})日(?:\s|$)/);
  if (!dateMatch) {
    return [];
  }
  const date = isoDate(...dateMatch.slice(1));
  const today = localDay(now, ZONE);
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  if (!date || (date !== today && date !== yesterday)) {
    return [];
  }
  const pathDate = page.pathname.match(/\/(\d{4})(\d{2})\/(\d{2})\/node_01\.html$/);
  if (pathDate && isoDate(...pathDate.slice(1)) !== date) {
    return [];
  }
  const result = [];
  const seen = new Set();
  const count = Math.min(3, Math.max(0, Number.isFinite(limit) ? Math.floor(limit) : 3));
  for (const item of links(html)) {
    let article;
    try {
      article = new URL(item.href, page);
    } catch {
      continue;
    }
    const match = article.pathname.match(articlePath);
    if (
      !official(article, articlePath) ||
      !match ||
      isoDate(...match.slice(1)) !== date ||
      !item.title ||
      item.title.length > 240 ||
      seen.has(article.href)
    ) {
      continue;
    }
    if (result.length >= count) {
      break;
    }
    seen.add(article.href);
    result.push({
      title: item.title,
      summary: '',
      url: article.href,
      site: '人民日报',
      date,
      date_precision: 'day',
      source_timezone: ZONE,
      scope: 'general',
    });
  }
  return result;
}

export async function fetchPeopleNews(context, { now = new Date(), fetch = globalThis.fetch, limit = 3 } = {}) {
  const signal = AbortSignal.timeout(8000);
  async function page(url) {
    for (let redirects = 0; redirects <= 2; redirects++) {
      if (!official(url, layoutPath)) {
        throw new Error('Unexpected newspaper URL');
      }
      const response = await fetch(url.href, { redirect: 'manual', signal, headers: { Accept: 'text/html' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error('Invalid newspaper redirect');
        }
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        throw new Error('Newspaper HTTP ' + response.status);
      }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) {
        throw new Error('Newspaper page too large');
      }
      const reader = response.body?.getReader();
      if (!reader) {
        const html = await response.text();
        if (Buffer.byteLength(html) > MAX_BYTES) {
          throw new Error('Newspaper page too large');
        }
        return { html, url };
      }
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          throw new Error('Newspaper page too large');
        }
        chunks.push(Buffer.from(value));
      }
      return { html: Buffer.concat(chunks).toString('utf8'), url };
    }
    throw new Error('Too many newspaper redirects');
  }
  const index = await page(new URL(ROOT));
  if (/node_01\.html$/.test(index.url.pathname)) {
    return parsePeopleFrontPage(index.html, index.url, now, limit);
  }
  for (const item of links(index.html)) {
    let url;
    try {
      url = new URL(item.href, index.url);
    } catch {
      continue;
    }
    if (!official(url, layoutPath) || !/node_01\.html$/.test(url.pathname)) {
      continue;
    }
    const front = await page(url);
    return parsePeopleFrontPage(front.html, front.url, now, limit);
  }
  return [];
}
