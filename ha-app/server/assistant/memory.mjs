import { mkdir, writeFile, rename, open, appendFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fingerprint } from './audit.mjs';

export const MEMORY_LIMITS = { long_term: 3000, short_term: 6000, style: 3000 };
export const MEMORY_ACTION_LIMITS = { operations: 16, evidence: 4, contextIds: 6 };
const names = { long_term: 'long-term.md', short_term: 'short-term.md', style: 'style.md' };
const initial = {
  long_term:
    '# 长期记忆\n\n- 用户明确的目标：结合日历、天气、时间和家中环境，帮助关注生活节奏与舒适度。\n- 表达自然、具体，给出可选建议，避免重复叮嘱。\n- 新闻优先早间，只讲事实，不附生活建议。\n',
  short_term: '# 短期记忆\n\n暂时没有需要跨会话保留的事情。\n',
  style: '# 表达偏好\n\n',
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const count = (text) => [...text].length;
const error = (status, message) => Object.assign(new Error(message), { status });
const entryVersion = (entry) =>
  fingerprint([entry.id, entry.text, entry.evidence, entry.context_refs, entry.expires_at]);
const documentVersion = (doc) => fingerprint([doc.text, doc.entries]);
const validKind = (kind) => Object.hasOwn(names, kind);

// Keep Markdown bytes, including headings and separators. IDs and evidence live in the revision journal.
function index(kind, text, previous = [], overrides = []) {
  const entries = [];
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter((x) => x[0]);
  const used = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i][0].trim() || /^#{1,6}\s/.test(lines[i][0])) continue;
    const start = lines[i].index;
    const bullet = /^[-*]\s/.test(lines[i][0]);
    while (
      i + 1 < lines.length &&
      lines[i + 1][0].trim() &&
      (bullet ? /^[ \t]+\S/.test(lines[i + 1][0]) : !/^(?:#{1,6}\s|[-*]\s)/.test(lines[i + 1][0]))
    )
      i++;
    const end = lines[i].index + lines[i][0].length;
    const render = text.slice(start, end);
    let known =
      overrides.find((x) => x.render === render && !used.has(x.id)) ||
      previous.find((x) => x.render === render && !used.has(x.id));
    if (!known) {
      const old = previous[entries.length];
      known = {
        id:
          old && !used.has(old.id) && !text.includes(old.render)
            ? old.id
            : 'mem_' + hash(kind + '\0' + render + '\0' + entries.length).slice(0, 24),
        text: render.trim().replace(/^[-*]\s/, ''),
        source_ids: [],
        evidence: [],
        context_refs: [],
        expires_at: null,
        legacy: true,
      };
    }
    used.add(known.id);
    entries.push({ ...known, start, end, render });
  }
  return entries;
}
function snapshot(kind, text, previous, overrides) {
  if (typeof text !== 'string' || count(text) > MEMORY_LIMITS[kind])
    throw error(413, '记忆超过长度上限，请精简后保存。');
  const doc = { text, entries: index(kind, text, previous, overrides) };
  return { ...doc, revision: documentVersion(doc) };
}
function validSnapshot(kind, doc) {
  if (
    !doc ||
    typeof doc.text !== 'string' ||
    count(doc.text) > MEMORY_LIMITS[kind] ||
    !Array.isArray(doc.entries) ||
    documentVersion(doc) !== doc.revision ||
    new Set(doc.entries.map((x) => x.id)).size !== doc.entries.length
  )
    throw new Error('invalid memory version');
  for (const x of doc.entries)
    if (
      typeof x.id !== 'string' ||
      typeof x.text !== 'string' ||
      typeof x.render !== 'string' ||
      !Number.isInteger(x.start) ||
      !Number.isInteger(x.end) ||
      doc.text.slice(x.start, x.end) !== x.render ||
      !Array.isArray(x.source_ids) ||
      !Array.isArray(x.evidence) ||
      !Array.isArray(x.context_refs) ||
      (x.expires_at !== null && !Number.isFinite(Date.parse(x.expires_at)))
    )
      throw new Error('invalid memory entry');
  return doc;
}

/** Editable memory and style documents with a recoverable append-only revision journal. */
export class AssistantMemory {
  constructor(directory) {
    this.directory = directory;
    this.queue = Promise.resolve();
    this.volatile = { ...initial };
    this.docs = {};
    this.historyError = false;
    this.journalStamp = '';
    this.journalLoaded = false;
  }
  enqueue(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
  }
  async load() {
    return this.enqueue(async () => {
      if (this.directory) {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        for (const kind of Object.keys(names))
          try {
            await writeFile(join(this.directory, names[kind]), initial[kind], { flag: 'wx', mode: 0o600 });
          } catch (cause) {
            if (cause.code !== 'EEXIST') throw cause;
          }
      }
      await this.sync();
      return this.publicDocs();
    });
  }
  get journalPath() {
    return this.directory ? join(this.directory, 'memory-revisions.jsonl') : '';
  }
  async readText(kind) {
    if (!this.directory) return this.volatile[kind];
    const file = await open(join(this.directory, names[kind]), 'r');
    try {
      if ((await file.stat()).size > MEMORY_LIMITS[kind] * 4) throw error(413, '记忆文档超过长度上限，请先精简。');
      return new TextDecoder('utf-8', { fatal: true }).decode(await file.readFile());
    } finally {
      await file.close();
    }
  }
  async append(record) {
    if (!this.directory) return;
    try {
      await appendFile(this.journalPath, JSON.stringify(record) + '\n', { mode: 0o600, flush: true });
      this.journalStamp = await this.stamp();
    } catch (cause) {
      this.historyError = true;
      throw cause;
    }
  }
  async stamp() {
    try {
      const journalStat = await stat(this.journalPath);
      return journalStat.size + ':' + journalStat.mtimeMs;
    } catch (cause) {
      if (cause.code === 'ENOENT') return '';
      throw cause;
    }
  }
  async loadJournal() {
    if (!this.directory || this.historyError) return;
    let stamp;
    try {
      stamp = await this.stamp();
    } catch {
      this.historyError = true;
      return;
    }
    if (this.journalLoaded && stamp === this.journalStamp) return;
    const docs = {};
    const pending = new Map();
    let buffer = '';
    try {
      if (stamp) {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        const line = (text) => {
          if (!text.trim()) return;
          const r = JSON.parse(text);
          if (!r || typeof r.id !== 'string' || !['version', 'prepare', 'commit', 'abort'].includes(r.type))
            throw new Error('invalid memory history');
          if (r.type === 'version' || r.type === 'prepare') {
            if (!validKind(r.kind)) throw new Error('invalid memory kind');
            validSnapshot(r.kind, r.after);
            if (r.before_revision !== (docs[r.kind]?.revision ?? null)) throw new Error('broken memory history');
            if (r.type === 'version') docs[r.kind] = r.after;
            else {
              if (pending.size) throw new Error('unresolved memory write');
              pending.set(r.id, r);
            }
          } else {
            const prepare = pending.get(r.id);
            if (!prepare) throw new Error('missing memory write');
            if (r.type === 'commit') docs[prepare.kind] = prepare.after;
            pending.delete(r.id);
          }
        };
        for await (const chunk of createReadStream(this.journalPath)) {
          buffer += decoder.decode(chunk, { stream: true });
          if (buffer.length > 2 * 1024 * 1024) throw new Error('memory history record too large');
          let end;
          while ((end = buffer.indexOf('\n')) !== -1) {
            line(buffer.slice(0, end));
            buffer = buffer.slice(end + 1);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) throw new Error('incomplete memory history');
      }
      this.docs = docs;
      this.journalLoaded = true;
      this.journalStamp = stamp;
      for (const r of pending.values()) {
        const applied = (await this.readText(r.kind)) === r.after.text;
        await this.append({
          type: applied ? 'commit' : 'abort',
          id: r.id,
          at: new Date().toISOString(),
          recovery: true,
        });
        if (applied) this.docs[r.kind] = r.after;
      }
    } catch {
      this.historyError = true;
    }
  }
  async sync() {
    await this.loadJournal();
    for (const kind of Object.keys(names)) {
      const text = await this.readText(kind);
      const old = this.docs[kind];
      if (old?.text === text) continue;
      const after = snapshot(kind, text, old?.entries);
      if (!this.historyError)
        await this.append({
          type: 'version',
          id: randomUUID(),
          at: new Date().toISOString(),
          kind,
          reason: old ? 'manual_external' : 'migration',
          before_revision: old?.revision ?? null,
          after,
        });
      this.docs[kind] = after;
    }
  }
  publicDocs() {
    return Object.fromEntries(
      Object.keys(names).map((kind) => {
        const doc = this.docs[kind];
        return [
          kind,
          {
            text: doc.text,
            revision: doc.revision,
            length: count(doc.text),
            limit: MEMORY_LIMITS[kind],
            entries: doc.entries.map(({ start, end, render, ...entry }) => ({
              ...entry,
              revision: entryVersion(entry),
            })),
            writable: !this.historyError,
          },
        ];
      }),
    );
  }
  async read() {
    return this.enqueue(async () => {
      await this.sync();
      return this.publicDocs();
    });
  }
  async commit(kind, after, reason, details = {}) {
    if (this.historyError) throw error(503, '记忆历史暂不可用，已保留原文，请先修复历史文件。');
    const before = this.docs[kind];
    if ((await this.readText(kind)) !== before.text) throw error(409, '记忆已被更新，请重新载入后再保存。');
    if (after.revision === before.revision) return;
    const id = randomUUID();
    await this.append({
      type: 'prepare',
      id,
      at: new Date().toISOString(),
      kind,
      reason,
      details,
      before_revision: before.revision,
      after,
    });
    try {
      if (this.directory) {
        const path = join(this.directory, names[kind]);
        await writeFile(path + '.tmp', after.text, { mode: 0o600, flush: true });
        if ((await this.readText(kind)) !== before.text) throw error(409, '记忆已被更新，请重新载入后再保存。');
        await rename(path + '.tmp', path);
      } else this.volatile[kind] = after.text;
    } catch (cause) {
      await this.append({ type: 'abort', id, at: new Date().toISOString() });
      throw cause;
    }
    this.docs[kind] = after;
    try {
      await this.append({ type: 'commit', id, at: new Date().toISOString() });
    } catch (cause) {
      cause.committed = true;
      throw cause;
    }
  }
  replace(kind, text, expectedRevision) {
    return this.enqueue(async () => {
      if (!validKind(kind) || typeof text !== 'string' || typeof expectedRevision !== 'string')
        throw error(400, '无效的记忆更新。');
      await this.sync();
      if (this.docs[kind].revision !== expectedRevision) throw error(409, '记忆已被更新，请重新载入后再保存。');
      await this.commit(kind, snapshot(kind, text, this.docs[kind].entries), 'manual');
      return this.publicDocs();
    });
  }
  apply(operations, { messages = [], current_user_id, now = new Date(), ttlDays = 14 } = {}) {
    return this.enqueue(async () => {
      await this.sync();
      if (!Array.isArray(operations) || operations.length > MEMORY_ACTION_LIMITS.operations)
        throw error(400, '无效的记忆操作。');
      const at = +new Date(now);
      if (!Number.isFinite(at) || !Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 365)
        throw error(400, '无效的记忆时间。');
      const sources = new Map(
        messages
          .filter(
            (x) =>
              x && typeof x.id === 'string' && typeof x.content === 'string' && ['user', 'assistant'].includes(x.role),
          )
          .map((x) => [x.id, x]),
      );
      const currentUser = sources.get(current_user_id);
      const base = Object.fromEntries(Object.keys(names).map((kind) => [kind, this.docs[kind].revision]));
      const expected = { ...base };
      const results = [];
      for (const op of operations)
        try {
          await this.sync();
          if (!op || !validKind(op.kind) || !['add', 'update', 'delete'].includes(op.op))
            throw error(400, 'invalid_operation');
          const doc = this.docs[op.kind];
          if (op.base_revision !== base[op.kind] || doc.revision !== expected[op.kind])
            throw error(409, 'stale_version');
          if (
            !currentUser ||
            currentUser.role !== 'user' ||
            !Array.isArray(op.evidence) ||
            !op.evidence.length ||
            op.evidence.length > MEMORY_ACTION_LIMITS.evidence ||
            !op.evidence.some((x) => x.message_id === current_user_id)
          )
            throw error(400, 'missing_current_user_evidence');
          let evidence = op.evidence.map((x) => {
            const source = sources.get(x?.message_id);
            if (
              source?.role !== 'user' ||
              typeof x.quote !== 'string' ||
              !x.quote.trim() ||
              count(x.quote) > 8000 ||
              !source.content?.includes(x.quote)
            )
              throw error(400, 'invalid_user_evidence');
            return { message_id: source.id, quote: x.quote };
          });
          if (op.op === 'add' && op.id != null) throw error(400, 'add_id_is_server_generated');
          const target = op.op === 'add' ? undefined : doc.entries.find((x) => x.id === op.id);
          if (op.op !== 'add' && !target) throw error(400, 'unknown_entry');
          if (op.op === 'delete') {
            const current = evidence.find(
              (x) => x.message_id === current_user_id && (x.quote.includes(target.id) || x.quote.includes(target.text)),
            );
            if (!current) throw error(400, 'unsupported_deletion');
            evidence = [
              { message_id: current_user_id, quote: current.quote.includes(target.id) ? target.id : target.text },
            ];
          }
          let text = doc.text;
          let override = [];
          if (op.op === 'delete') text = text.slice(0, target.start) + text.slice(target.end);
          else {
            if (
              typeof op.text !== 'string' ||
              !op.text.trim() ||
              !evidence.some((x) => x.message_id === current_user_id && x.quote.includes(op.text))
            )
              throw error(400, 'text_not_current_user_quote');
            evidence = evidence
              .filter((x) => x.quote.includes(op.text))
              .map((x) => ({ message_id: x.message_id, quote: op.text }));
            if (doc.entries.some((x) => x.text === op.text && x.id !== target?.id)) throw error(409, 'duplicate_entry');
            const contextIds = op.context_ids ?? [];
            if (
              !Array.isArray(contextIds) ||
              contextIds.length > MEMORY_ACTION_LIMITS.contextIds ||
              contextIds.some((id) => !sources.has(id))
            )
              throw error(400, 'invalid_context_reference');
            const context = [...new Set(contextIds)].map((id) => {
              const source = sources.get(id);
              return { id, role: source.role, content: String(source.content).slice(0, 8000) };
            });
            let expires = null;
            if (op.kind === 'short_term') {
              expires = op.expires_at ?? new Date(at + ttlDays * 86400000).toISOString();
              if (
                typeof expires !== 'string' ||
                !/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(expires) ||
                !Number.isFinite(Date.parse(expires)) ||
                Date.parse(expires) <= at
              )
                throw error(400, 'invalid_expiry');
              expires = new Date(expires).toISOString();
            } else if (op.expires_at != null) throw error(400, 'long_term_expiry_not_allowed');
            const render =
              '- 用户原话：' +
              JSON.stringify(op.text) +
              '\n' +
              context.map((x) => '  前文（' + x.role + '）：' + JSON.stringify(x.content) + '\n').join('');
            const entry = {
              id: target?.id ?? 'mem_' + randomUUID(),
              text: op.text,
              source_ids: [...new Set(evidence.map((x) => x.message_id))],
              evidence,
              context_refs: context,
              expires_at: expires,
              legacy: false,
              render,
            };
            if (target) text = text.slice(0, target.start) + render + text.slice(target.end);
            else text += (text && !text.endsWith('\n') ? '\n' : '') + render;
            override = [entry];
          }
          const after = snapshot(
            op.kind,
            text,
            doc.entries.filter((x) => x.id !== target?.id),
            override,
          );
          await this.commit(op.kind, after, 'model_' + op.op, { evidence, target_id: target?.id ?? null });
          expected[op.kind] = after.revision;
          results.push({ status: 'saved', op: op.op, kind: op.kind, id: override[0]?.id ?? target.id });
        } catch (cause) {
          results.push({
            status: 'rejected',
            op: op?.op,
            kind: op?.kind,
            reason: cause.status ? cause.message : 'memory_write_failed',
            ...(cause.committed ? { committed: true } : {}),
          });
        }
      return results;
    });
  }
  expire(now = new Date()) {
    return this.enqueue(async () => {
      await this.sync();
      const at = +new Date(now);
      if (!Number.isFinite(at)) throw error(400, '无效的记忆时间。');
      const doc = this.docs.short_term;
      const expired = doc.entries.filter((x) => x.expires_at && Date.parse(x.expires_at) <= at);
      if (!expired.length) return [];
      let text = doc.text;
      for (const entry of [...expired].sort((a, b) => b.start - a.start))
        text = text.slice(0, entry.start) + text.slice(entry.end);
      await this.commit(
        'short_term',
        snapshot(
          'short_term',
          text,
          doc.entries.filter((x) => !expired.includes(x)),
        ),
        'expiry',
        { entry_ids: expired.map((x) => x.id) },
      );
      return expired.map((x) => ({ id: x.id, status: 'expired' }));
    });
  }
}
