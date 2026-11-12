import { createHash } from 'node:crypto';
import { localDay } from '../core.mjs';
import { fetchSources } from '../sources/news.mjs';
import { fetchPeopleNews } from '../sources/people-news.mjs';

const CACHE_MS = 30 * 60000;
const MAX_ARTICLE_BYTES = 1024 * 1024;
const clip = (value, limit) =>
  [
    ...String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, limit)
    .join('');
const hash = (value) => createHash('sha256').update(value).digest('hex');
function scope(context, now) {
  const timezone = context.timezone || 'UTC';
  const city = clip(context.weather?.city, 80);
  return {
    timezone,
    city,
    key: JSON.stringify([timezone, city, localDay(now, timezone), localDay(now, 'Asia/Shanghai')]),
  };
}
function articleText(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value)
    .replace(/<!--[\s\S]*?-->|<(script|style|noscript|template|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, code) => {
      if (code[0] !== '#') return named[code.toLowerCase()];
      const codePoint = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      if (codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '';
      return String.fromCodePoint(codePoint);
    })
    .replace(/\s+/g, ' ')
    .trim();
}
function permittedArticle(url) {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    (/^(?:[a-z0-9-]+\.)*chinanews\.com(?:\.cn)?$/.test(url.hostname) ||
      ['paper.people.com.cn', 'news.google.com'].includes(url.hostname))
  );
}
async function readArticle(address, fetch) {
  let url = new URL(address);
  if (url.protocol === 'http:' && !url.port) url.protocol = 'https:';
  if (!permittedArticle(url)) return null;
  const origin = url.origin;
  const signal = AbortSignal.timeout(8000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url.href, {
      redirect: 'manual',
      credentials: 'omit',
      signal,
      headers: { Accept: 'text/html,text/plain' },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location || redirects === 3) return null;
      const next = new URL(location, url);
      if (next.origin !== origin || !permittedArticle(next)) return null;
      url = next;
      continue;
    }
    const type = response.headers.get('content-type') || '';
    if (
      !response.ok ||
      Number(response.headers.get('content-length')) > MAX_ARTICLE_BYTES ||
      (type && !/^text\/(?:html|plain)\b/i.test(type))
    ) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) {
      const value = await response.text();
      return Buffer.byteLength(value) <= MAX_ARTICLE_BYTES ? articleText(value) : null;
    }
    const decoder = new TextDecoder();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_ARTICLE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      return articleText(chunks.join('') + decoder.decode());
    } finally {
      reader.releaseLock();
    }
  }
  return null;
}
function fresh(article, now, timezone) {
  if (article.date_precision === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(article.date) || !article.source_timezone) return false;
    const today = localDay(now, article.source_timezone);
    const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
    return article.date === today || article.date === yesterday;
  }
  const at = Date.parse(article.date);
  return (
    Number.isFinite(at) &&
    /(?:\bGMT|\bUTC|\bUT|Z|[+-]\d{2}:?\d{2})$/i.test(article.date) &&
    at <= now.getTime() &&
    localDay(new Date(at), timezone) === localDay(now, timezone)
  );
}
function compact(articles, now, timezone) {
  const output = [];
  const seen = new Set();
  for (const item of articles) {
    try {
      if (!item || typeof item !== 'object' || !fresh(item, now, timezone)) continue;
      const title = clip(item.title, 240);
      if (!title) continue;
      let url;
      if (item.url) {
        const parsed = new URL(item.url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) continue;
        url = parsed.href;
      }
      if (!url && !item.id) continue;
      const id = /^news:[a-f0-9]{64}$/.test(item.id || '')
        ? item.id
        : 'news:' + hash(String(item.id || url || title + '\n' + item.date));
      const keys = [id, 'title:' + title.toLowerCase(), ...(url ? ['url:' + url] : [])];
      if (keys.some((key) => seen.has(key))) continue;
      keys.forEach((key) => seen.add(key));
      output.push({
        id,
        title,
        summary: clip(item.summary, 400),
        site: clip(item.site, 120),
        date: item.date,
        scope: item.scope === 'local' ? 'local' : 'general',
        ...(url ? { url } : {}),
        ...(item.date_precision === 'day' ? { date_precision: 'day', source_timezone: item.source_timezone } : {}),
      });
      if (output.length === 10) break;
    } catch {
      /* An invalid candidate must not hide valid items from another source. */
    }
  }
  return output;
}

/** Short, shared news context. Availability is independent of screen broadcast policy. */
export class AssistantNews {
  constructor({ fetch = globalThis.fetch, newsSources } = {}) {
    this.fetch = fetch;
    this.newsSources =
      newsSources ||
      (async (context, now) => {
        const settings = { now, timezone: context.timezone || 'UTC', fetch };
        const results = await Promise.allSettled([fetchSources(context, settings), fetchPeopleNews(context, settings)]);
        return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
      });
    this.cache = null;
    this.pending = new Map();
    this.currentKey = '';
    this.details = new Map();
    this.detailPending = new Map();
  }
  async snapshot(context, now = new Date(), { wait = true } = {}) {
    const { timezone, city, key } = scope(context, now);
    this.currentKey = key;
    let articles = this.cache?.key === key ? compact(this.cache.articles, now, timezone) : [];
    const cached =
      this.cache?.key === key && now.getTime() >= this.cache.at && now.getTime() - this.cache.at < CACHE_MS;
    if (!cached) {
      let pending = this.pending.get(key);
      if (!pending) {
        const previous = articles;
        const sourceContext = { timezone, weather: { city } };
        pending = Promise.resolve()
          .then(() => this.newsSources(sourceContext, now))
          .then(
            (value) => compact(Array.isArray(value) ? value : [], now, timezone),
            () => previous,
          )
          .then((value) => {
            if (this.currentKey === key) this.cache = { key, at: now.getTime(), articles: value };
            return value;
          })
          .finally(() => this.pending.delete(key));
        this.pending.set(key, pending);
      }
      if (wait) articles = await pending;
    }
    // The newsletter was already sanitized by newsletterCandidate; its full body is never cached here.
    return compact([context.newsletter, ...articles], now, timezone);
  }
  async detail(id, context, now = new Date()) {
    if (typeof id !== 'string' || !/^news:[a-f0-9]{64}$/.test(id)) return null;
    const { timezone, key } = scope(context, now);
    const newsletter = compact([context.newsletter], now, timezone)[0];
    const article = compact([newsletter, ...(this.cache?.key === key ? this.cache.articles : [])], now, timezone).find(
      (item) => item.id === id,
    );
    if (!article) return null; // Unknown or expired IDs never authorize URL fetching.
    for (const [articleId, cached] of this.details)
      if (+now < cached.at || +now - cached.at >= CACHE_MS) this.details.delete(articleId);
    const cached = this.details.get(id);
    if (cached) return { ...cached.value };
    let pending = this.detailPending.get(id);
    if (!pending) {
      pending = (async () => {
        try {
          let text = null;
          if (newsletter?.id === id) text = articleText(context.newsletter.summary);
          else if (article.url) text = await readArticle(article.url, this.fetch);
          if (!text) return null;
          const { summary, ...source } = article;
          const value = { ...source, text: clip(text, 6000), truncated: [...text].length > 6000 };
          this.details.set(id, { at: +now, value });
          while (this.details.size > 10) this.details.delete(this.details.keys().next().value);
          return value;
        } catch {
          return null;
        }
      })().finally(() => this.detailPending.delete(id));
      this.detailPending.set(id, pending);
    }
    const value = await pending;
    return value ? { ...value } : null;
  }
}
