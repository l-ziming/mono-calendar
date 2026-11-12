import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Bounded decision records: no raw prompts, email bodies, credentials or reasoning. */
export class AssistantAudit {
  constructor(path = '') {
    this.path = path;
    this.queue = Promise.resolve();
  }
  record(value) {
    if (!this.path) return Promise.resolve();
    const next = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      try {
        if ((await stat(this.path)).size > 1024 * 1024) await rename(this.path, this.path + '.previous');
      } catch (cause) {
        if (cause.code !== 'ENOENT') throw cause;
      }
      await appendFile(this.path, JSON.stringify(value) + '\n', { mode: 0o600, flush: true });
    });
    this.queue = next.catch(() => {
      console.warn('Assistant: decision log unavailable.');
    });
    return this.queue;
  }
}
