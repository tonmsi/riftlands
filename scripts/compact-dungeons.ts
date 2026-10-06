import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { unpackDungeonCatalog, serializeDungeonCatalog } from '../shared/dungeon-storage';
import { readActorProject } from './actor-library';
import { acquireDataLease } from '../server/data-lease';

export async function compactDungeonFile(path: string) {
  const release = acquireDataLease(path), temp = `${path}.${randomUUID()}.tmp`;
  try {
    const original = await readFile(path, 'utf8'), { catalog } = await readActorProject(join(dirname(path), 'actor-catalog.json'));
    const before = unpackDungeonCatalog(JSON.parse(original), catalog);
    for (const bundle of before) for (const entity of bundle.draft?.entities ?? []) if (entity.kind === 'boss' && entity.inheritRadius === undefined)
      entity.inheritRadius = entity.radius === catalog.bosses.find(b => b.id === entity.template)?.radius;
    const text = serializeDungeonCatalog(before, catalog);
    const after = unpackDungeonCatalog(JSON.parse(text), catalog);
    for (let i = 0; i < before.length; i++) {
      assert.deepEqual(after[i].definition, before[i].definition);
      assert.deepEqual(after[i].bosses, before[i].bosses);
      const strip = (draft: typeof before[number]['draft']) => draft ? { ...draft, entities: draft.entities.map(({ inheritRadius, ...e }) => e) } : draft;
      assert.deepEqual(strip(after[i].draft), strip(before[i].draft));
    }
    if (text === original) return { before: Buffer.byteLength(original), after: Buffer.byteLength(text), backup: undefined };
    const backup = `${path}.before-compact-${randomUUID()}.bak`;
    await writeFile(backup, original, { flag: 'wx' }); await writeFile(temp, text, { flag: 'wx' });
    if (await readFile(path, 'utf8') !== original) throw new Error('Catalogo dungeon modificato durante la migrazione.');
    await rename(temp, path);
    return { before: Buffer.byteLength(original), after: Buffer.byteLength(text), backup };
  } finally { await unlink(temp).catch(() => {}); release(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/compact-dungeons.ts'))
  console.log(JSON.stringify(await compactDungeonFile(resolve('shared/custom-dungeons.json'))));
