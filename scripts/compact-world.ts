import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseWorldDocument } from '../shared/world-schema';
import { compactWorldTiles, serializeWorldDocument, WorldTiles, tileCode } from '../shared/world-tiles';
import { acquireDataLease } from '../server/data-lease';

/** Lossless offline representation migration. No terrain, entities, saves or gameplay rules change. */
export async function compactWorldFile(path: string) {
  const release = acquireDataLease(path), temp = `${path}.${randomUUID()}.tmp`;
  try {
    const original = await readFile(path, 'utf8'), document = parseWorldDocument(original), next = compactWorldTiles(document);
    if (document.version === 2 && !document.tiles.length) return { before: Buffer.byteLength(original), after: Buffer.byteLength(original), cells: 0, backup: undefined };
    const checked = parseWorldDocument(serializeWorldDocument(next)), index = new WorldTiles(checked);
    for (const t of document.tiles) if (tileCode(index.at(t.x, t.y)) !== tileCode(t)) throw new Error('Migrazione terreno non equivalente.');
    const occupied = next.tileChunks!.reduce((sum, c) => { for (let i = 2; i < c.length; i += 3) sum += c[i + 1]; return sum; }, 0);
    if (occupied !== document.tiles.length) throw new Error('Conteggio celle non equivalente.');
    const text = serializeWorldDocument(checked), backup = `${path}.before-chunks-${randomUUID()}.bak`;
    await writeFile(backup, original, { flag: 'wx' });
    const hash = (s: string) => createHash('sha256').update(s).digest('hex');
    await writeFile(`${path}.format-migration.bak`, JSON.stringify({ fromRevision: hash(original), toRevision: hash(text) }));
    await writeFile(temp, text, { flag: 'wx' });
    if (await readFile(path, 'utf8') !== original) throw new Error('Mondo modificato durante la migrazione.');
    await rename(temp, path);
    return { before: Buffer.byteLength(original), after: Buffer.byteLength(text), cells: occupied, backup };
  } finally { await unlink(temp).catch(() => {}); release(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/compact-world.ts')) console.log(JSON.stringify(await compactWorldFile(resolve('shared/custom-world.json'))));
