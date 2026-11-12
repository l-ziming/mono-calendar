import { createHash } from 'node:crypto';
import { localDay } from '../core.mjs';

const nytDomain = (host) => /^(?:[a-z0-9-]+\.)*(?:nytimes\.com|newyorktimes\.com)$/i.test(host);
const clip = (text, length) => [...text].slice(0, length).join('');
const senderAddress = (sender) => (sender.match(/^[^<>\r\n]*<([^<>\r\n]+)>\s*$/)?.[1] || sender).trim();
function nytSender(sender) {
  const domain = senderAddress(sender).match(/^[^\s<>@]+@([a-z0-9.-]+)$/i)?.[1];
  return Boolean(domain && nytDomain(domain));
}
const nytRelay = (sender) =>
  /^[a-z0-9.+_-]+_at_(?:nytimes_com|newyorktimes_com)_[a-z0-9]+(?:_[a-z0-9]+)*@privaterelay\.appleid\.com$/i.test(
    senderAddress(sender),
  );
function withoutHtmlAds(html) {
  html = html.replace(
    /<!--\s*(?:(?:begin|start)\s+(?:ad|advertisement|sponsored content|paid post)|(?:ad|advertisement|sponsored content|paid post)(?:\s+(?:begin|start))?)\s*-->[\s\S]*?<!--\s*(?:(?:end|\/)\s*(?:ad|advertisement|sponsored content|paid post)|(?:ad|advertisement|sponsored content|paid post)\s+end)\s*-->/gi,
    '\n',
  );
  const tagPattern = /<\/?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  let cleanedHtml = '';
  let cursor = 0;
  let blockedDepth = 0;
  let blockedTag = '';
  while (true) {
    const tagMatch = tagPattern.exec(html);
    if (!tagMatch) {
      break;
    }
    const tagText = tagMatch[0];
    const tagName = tagMatch[1].toLowerCase();
    const closingTag = tagText.startsWith('</');
    const selfClosing = /\/\s*>$/.test(tagText) || /^(?:img|br|hr|input|meta|link|source)$/.test(tagName);
    if (blockedDepth) {
      if (tagName === blockedTag) {
        if (closingTag) {
          blockedDepth--;
        } else if (!selfClosing) {
          blockedDepth++;
        }
      }
      if (!blockedDepth) {
        cursor = tagPattern.lastIndex;
      }
    } else if (
      !closingTag &&
      (/\sdata-(?:ad|ad-slot|ad-unit|advertisement|sponsored)(?:\s|=|\/?>)/i.test(tagText) ||
        [...tagText.matchAll(/\s(?:class|id)\s*=\s*(["'])(.*?)\1/gi)].some((attr) =>
          /(?:^|\s)(?:ad-container|advertisement|sponsored-content|paid-post)(?:\s|$)/i.test(attr[2]),
        ))
    ) {
      cleanedHtml += html.slice(cursor, tagMatch.index);
      cursor = tagPattern.lastIndex;
      if (!selfClosing) {
        blockedDepth = 1;
        blockedTag = tagName;
      }
    }
  }
  return cleanedHtml + (blockedDepth ? '' : html.slice(cursor));
}
function withoutTextAds(text) {
  const start =
    /^\s*(?:advertisement|paid post|sponsored(?: content| post)?|a message from .+|supported by .+)(?:\s*[:—–-]\s*.*)?\s*$/i;
  const resume =
    /^\s*(?:continue reading the main story|end (?:of )?(?:advertisement|ad|sponsored content|paid post)|back to (?:the )?(?:news|newsletter|story))\.?\s*$/i;
  const editorial = /^\s*(?:the latest news|more news|today[’']s headlines|around the world)\s*$/i;
  const promotion =
    /^\s*(?:subscribe(?: now| to the new york times)?|start your subscription|get unlimited access|upgrade your subscription|support independent journalism|sign up for (?:this|our|the .+) newsletter)[.!]?\s*$/i;
  const kept = [];
  let advertising = false;
  for (const line of text.split(/\r?\n/)) {
    if (start.test(line)) {
      advertising = true;
      continue;
    }
    if (advertising) {
      if (resume.test(line)) {
        advertising = false;
        continue;
      }
      if (!editorial.test(line)) {
        continue;
      }
      advertising = false;
    }
    if (promotion.test(line)) {
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}
function plain(text) {
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\/?[a-z][a-z0-9]*(?:\s[^<>]*?)?\s*\/?>/gi, '')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, value) => {
      const code = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/gi,
      (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase()],
    );
}
function links(text) {
  return (text.match(/https?:\/\/[^\s<>"']+/gi) || []).flatMap((value) => {
    try {
      const url = new URL(value.replace(/[).,;!?]+$/, ''));
      return !url.username && !url.password ? [url] : [];
    } catch {
      return [];
    }
  });
}
function clean(text) {
  return plain(text)
    .replace(/https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi, '')
    .replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '')
    .replace(
      /^\s*>?\s*(?:from|to|cc|bcc|reply-to|message-id|date|sent|subject|发件人|收件人|抄送|日期|发送时间|主题)\s*[:：].*$/gim,
      '',
    )
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Sender domains and forwarded headers identify a source; they are not SPF/DKIM authentication.
// Only a sanitized newsletter candidate leaves this function, never the mailbox or mail headers.
export function newsletterCandidate(state, { now = new Date(), timezone = 'UTC' } = {}) {
  const attributes = state?.attributes;
  if (
    !state ||
    ['unknown', 'unavailable'].includes(state.state) ||
    !attributes ||
    Array.isArray(attributes) ||
    !['body', 'date', 'subject', 'sender'].every((key) => typeof attributes[key] === 'string')
  ) {
    return null;
  }
  const htmlWithoutAds = withoutHtmlAds(attributes.body.slice(0, 48000));
  const articleUrls = links(htmlWithoutAds);
  let body = plain(htmlWithoutAds);
  let subject = attributes.subject;
  let sentAt = Date.parse(attributes.date);
  const relayedByApple = nytRelay(attributes.sender) && articleUrls.some((url) => nytDomain(url.hostname));
  if (!nytSender(attributes.sender) && !relayedByApple) {
    // Conventional forwards must preserve the original From and Date, plus an NYT link.
    // The forwarding message's fresh Date must never make an old issue look current.
    const header = body.slice(0, 4000);
    const forwardedSender = /^\s*>?\s*(?:from|发件人)\s*[:：]\s*(.+)$/im.exec(header);
    if (!forwardedSender || !nytSender(forwardedSender[1]) || !articleUrls.some((url) => nytDomain(url.hostname))) {
      return null;
    }
    const originalHeader = header.slice(forwardedSender.index);
    const date = /^\s*>?\s*(?:date|sent|日期|发送时间)\s*[:：]\s*(.+)$/im.exec(originalHeader);
    if (!date) {
      return null;
    }
    sentAt = Date.parse(date[1]);
    subject = /^\s*>?\s*(?:subject|主题)\s*[:：]\s*(.+)$/im.exec(originalHeader)?.[1] || subject;
    body = body.slice(forwardedSender.index); // Exclude a forwarder's personal introductory note.
  }
  if (
    !Number.isFinite(sentAt) ||
    !Number.isFinite(+now) ||
    sentAt > +now ||
    localDay(new Date(sentAt), timezone) !== localDay(now, timezone)
  ) {
    return null;
  }
  const footer =
    /^\s*(?:you (?:received|are receiving) this (?:email|message|newsletter)|you’re receiving this (?:email|newsletter)|this email was sent to|to (?:unsubscribe|stop receiving)|unsubscribe(?:\s*[|·]|\s*$)|manage (?:your )?email preferences|the new york times company\.?\s*(?:\d|$)|(?:©|copyright).*the new york times|sent from my (?:iphone|ipad)|发自我的(?:iphone|ipad))/im.exec(
      body,
    );
  if (footer) {
    body = body.slice(0, footer.index);
  }
  const title = clip(clean(subject).replace(/^(?:(?:fw|fwd|转发)\s*[:：]\s*)+/i, ''), 240);
  const summary = clip(withoutTextAds(clean(body)).trim(), 12000);
  if (!title || !summary) {
    return null;
  }
  const date = new Date(sentAt).toISOString();
  const url = articleUrls.find(
    (url) =>
      /^https:$/.test(url.protocol) &&
      /^(?:www\.)?nytimes\.com$/i.test(url.hostname) &&
      /^\/\d{4}\/\d{2}\/\d{2}\//.test(url.pathname),
  );
  const id = 'nyt-mail:' + createHash('sha256').update([date, title, summary].join('\n')).digest('hex');
  return {
    id,
    title,
    summary,
    date,
    site: 'The New York Times',
    scope: 'general',
    ...(url ? { url: url.origin + url.pathname } : {}),
  };
}
