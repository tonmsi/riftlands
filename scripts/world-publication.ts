import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** The local game's data lease advertises a secret, loopback-only publication endpoint. */
export async function forwardWorldPublication(options: { dataPath: string; documentPath: string }, payload: unknown): Promise<any | undefined> {
  let lock: { pid: number; publisher?: { port: number; secret: string; documentPath: string } };
  try { lock = JSON.parse(await readFile(`${options.dataPath}.lock`, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  try { process.kill(lock.pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
  const publisher = lock.publisher;
  if (!publisher) throw new Error('Salvataggio in uso. Il server attivo non supporta la pubblicazione live: riavvialo con la nuova versione.');
  if (resolve(publisher.documentPath) !== resolve(options.documentPath)) throw new Error('Lo Studio e il gioco usano progetti diversi.');
  const response = await fetch(`http://127.0.0.1:${publisher.port}/__world/publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${publisher.secret}` },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(60_000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Pubblicazione live non riuscita.');
  return result;
}
