import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Capture JSON at request time; drain is a barrier for all earlier requests. */
export interface SaveWriter {
  write(path: string, value: unknown): void;
  drain(): Promise<void>;
}

/** Offline fixtures and maintenance keep their immediate read-after-write contract. */
export class SynchronousSaveWriter implements SaveWriter {
  write(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const next = `${path}.tmp`;
    writeFileSync(next, JSON.stringify(value), { mode: 0o600 });
    renameSync(next, path);
  }
  async drain(): Promise<void> {}
}

export type AtomicWrite = (path: string, json: string) => Promise<void>;
export const writeAtomic: AtomicWrite = async (path, json) => {
  const next = `${path}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(next, json, { mode: 0o600 });
    await rename(next, path);
  } catch (error) {
    await unlink(next).catch(() => {});
    throw error;
  }
};

interface Save { path: string; json: string; sequence: number; }
interface Barrier { sequence: number; resolve: () => void; reject: (error: Error) => void; }

/** One ordered disk writer. Only adjacent pending writes to the same file coalesce. */
export class OrderedSaveWriter implements SaveWriter {
  private readonly pending: Save[] = [];
  private readonly barriers: Barrier[] = [];
  private sequence = 0;
  private completed = 0;
  private scheduled = false;
  private running = false;
  private active?: Promise<void>;
  private failure?: Error;
  private failureHandler?: (error: Error) => void;
  constructor(private readonly atomicWrite: AtomicWrite = writeAtomic, private readonly maxPending = 128) {
    if (!Number.isSafeInteger(maxPending) || maxPending < 1) throw new Error('Limite coda salvataggi non valido.');
  }

  onFailure(handler: (error: Error) => void): void {
    this.failureHandler = handler;
    if (this.failure) handler(this.failure);
  }
  write(path: string, value: unknown): void {
    if (this.failure) throw this.failure;
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error('Salvataggio JSON non valido.');
    const last = this.pending.at(-1);
    if (last?.path !== path && this.pending.length >= this.maxPending) {
      throw this.fail(new Error('Coda salvataggi piena: il disco non tiene il passo.'));
    }
    const next = { path, json, sequence: ++this.sequence };
    if (last?.path === path) this.pending[this.pending.length - 1] = next;
    else this.pending.push(next);
    if (!this.running && !this.scheduled) {
      this.scheduled = true;
      setImmediate(() => { this.scheduled = false; void this.pump(); });
    }
  }
  drain(): Promise<void> {
    if (this.failure) {
      const failure = this.failure;
      // A queue limit can fail while one atomic replacement is still in flight.
      return (this.active ?? Promise.resolve()).catch(() => {}).then(() => { throw failure; });
    }
    if (this.completed >= this.sequence) return Promise.resolve();
    return new Promise((resolve, reject) => this.barriers.push({ sequence: this.sequence, resolve, reject }));
  }
  private async pump(): Promise<void> {
    if (this.running || this.failure) return;
    this.running = true;
    try {
      while (this.pending.length && !this.failure) {
        const save = this.pending.shift()!;
        try { this.active = this.atomicWrite(save.path, save.json); await this.active; }
        catch (cause) {
          this.fail(new Error(`Salvataggio fallito: ${save.path}`, { cause }));
          return;
        }
        if (this.failure) return;
        this.completed = save.sequence;
        let ready = 0;
        while (ready < this.barriers.length && this.barriers[ready].sequence <= this.completed) ready++;
        for (const barrier of this.barriers.splice(0, ready)) barrier.resolve();
      }
    } finally { this.active = undefined; this.running = false; }
  }
  private fail(error: Error): Error {
    if (this.failure) return this.failure;
    this.failure = error;
    for (const barrier of this.barriers.splice(0)) barrier.reject(error);
    this.pending.length = 0;
    this.failureHandler?.(error);
    return error;
  }
}
