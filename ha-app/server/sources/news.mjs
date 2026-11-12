import { localDay } from '../core.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const fields = new Set(['title', 'link', 'description', 'pubdate', 'source', 'guid']);
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const htmlEntities = { nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
function decode(text, html = false) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, key) => {
    if (key[0] !== '#') {
      return entities[key.toLowerCase()] || (html && htmlEntities[key.toLowerCase()]) || all;
    }
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all;
  });
}
function plain(text = '') {
  const html = /<\/?[a-z][\w:-]*(?:\s|>)/i.test(text);
  const value = text
    .replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?[a-z](?:"[^"]*"|'[^']*'|[^'">])*>/gi, ' ');
  return (html ? decode(value, true) : value).replace(/\s+/g, ' ').trim();
}
function webUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

/** Read the small RSS 2.0 field set used by our news feeds, without expanding DTDs. */
export function parseRss(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    return [];
  }
  const stack = [];
  const items = [];
  let item = null;
  let field = null;
  let channel = '';
  let position = 0;
  const finish = (name) => {
    if (stack.at(-1) !== name) {
      return false;
    }
    if (field && field.depth === stack.length) {
      if (field.channel) {
        channel = plain(field.text);
      } else if (item[field.name] === undefined) {
        item[field.name] = field.text.trim();
      }
      field = null;
    }
    if (name === 'item' && item && stack.join('/') === 'rss/channel/item') {
      items.push(item);
      item = null;
    }
    stack.pop();
    return true;
  };
  for (const match of xml.matchAll(
    /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(?:(?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+/g,
  )) {
    if (match.index !== position) {
      return [];
    }
    const token = match[0];
    position += token.length;
    if (token.startsWith('<!--') || token.startsWith('<?')) {
      continue;
    }
    if (token.startsWith('<![CDATA[')) {
      if (field) {
        field.text += token.slice(9, -3);
      }
      continue;
    }
    if (token[0] !== '<') {
      if (field) {
        field.text += decode(token);
      }
      continue;
    }
    const closing = token.match(/^<\/([\w:.-]+)\s*>$/);
    if (closing) {
      if (field && field.depth < stack.length) {
        field.text += token;
      }
      if (!finish(closing[1].toLowerCase())) {
        return [];
      }
      continue;
    }
    const opening = token.match(/^<([\w:.-]+)(?:\s|\/?\>)/);
    if (!opening) {
      return [];
    }
    const name = opening[1].toLowerCase();
    if (!stack.length && name !== 'rss') {
      return [];
    }
    if (field) {
      field.text += token;
    } else if (name === 'item' && stack.join('/') === 'rss/channel') {
      item = {};
    } else if (item && stack.join('/') === 'rss/channel/item' && fields.has(name)) {
      field = { name, text: '', depth: stack.length + 1 };
      if (name === 'guid') {
        item.guidIsPermalink = !/\bisPermaLink\s*=\s*(['"])false\1/i.test(token);
      }
    } else if (name === 'title' && stack.join('/') === 'rss/channel') {
      field = { channel: true, text: '', depth: stack.length + 1 };
    }
    stack.push(name);
    if (/\/\s*>$/.test(token) && !finish(name)) {
      return [];
    }
  }
  if (position !== xml.length || stack.length) {
    return [];
  }
  return items.map((x) => ({
    title: plain(x.title).slice(0, 240),
    summary: plain(x.description).slice(0, 1000),
    date: x.pubdate || '',
    site: plain(x.source) || channel,
    url: webUrl(x.link) || (x.guidIsPermalink ? webUrl(x.guid) : ''),
    guid: x.guid || '',
  }));
}

async function readFeed(address, fetch) {
  const origin = new URL(address).origin;
  const signal = AbortSignal.timeout(8000);
  let url = address;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, { redirect: 'manual', signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('RSS redirect has no location');
      }
      const next = new URL(location, url);
      if (next.origin !== origin || next.username || next.password) {
        throw new Error('RSS redirect changed origin');
      }
      url = next.href;
      continue;
    }
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error('RSS response rejected');
    }
    if (!response.body) {
      return '';
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new Error('RSS response too large');
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  throw new Error('Too many RSS redirects');
}

/** Keep independent sources useful even when one feed is unavailable. */
export async function fetchSources(
  context,
  { timezone = 'UTC', now = new Date(), fetch = globalThis.fetch, limit = 3 } = {},
) {
  const day = localDay(now, timezone);
  const sources = [{ url: 'https://www.chinanews.com.cn/rss/importnews.xml', scope: 'general' }];
  const city = typeof context.weather?.city === 'string' ? context.weather.city.trim() : '';
  if (city) {
    const url = new URL('https://news.google.com/rss/headlines/section/geo/' + encodeURIComponent(city));
    url.search = new URLSearchParams({ hl: 'en-US', gl: 'US', ceid: 'US:en' });
    sources.push({ url: url.href, scope: 'local' });
  }
  const groups = await Promise.all(
    sources.map(async (source) => {
      try {
        const seen = new Set();
        return parseRss(await readFeed(source.url, fetch))
          .filter((x) => {
            const at = Date.parse(x.date);
            if (
              !x.title ||
              !x.url ||
              !Number.isFinite(at) ||
              !/(?:\bGMT|\bUTC|\bUT|Z|[+-]\d{2}:?\d{2})$/i.test(x.date) ||
              at > now.getTime() ||
              localDay(new Date(at), timezone) !== day ||
              seen.has(x.url)
            ) {
              return false;
            }
            seen.add(x.url);
            return true;
          })
          .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
          .slice(0, limit)
          .map(({ guid, ...x }) => ({ ...x, date: new Date(x.date).toISOString(), scope: source.scope }));
      } catch {
        return [];
      }
    }),
  );
  return groups.flat();
}
