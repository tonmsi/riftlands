import { readFile, writeFile, rename, unlink, readdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ACTOR_CATALOG, parseActorCatalog } from '../shared/actor-catalog';
import { unpackDungeonCatalog } from '../shared/dungeon-storage';
import { acquireDataLease } from '../server/data-lease';

export const actorRevision = (text: string) => createHash('sha256').update(text).digest('hex');
export async function readActorProject(path: string) {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; text = JSON.stringify(ACTOR_CATALOG, null, 2) + '\n'; }
  return { catalog: parseActorCatalog(JSON.parse(text)), revision: actorRevision(text), text };
}
export async function listActorAssets(root: string): Promise<string[]> {
  const lists = await Promise.all(['actor-assets', 'world-assets'].map(async folder => {
    const files = await readdir(join(root, 'public', folder)).catch(() => []);
    return files.filter(file => /^[a-zA-Z0-9_-]+\.(png|svg)$/.test(file)).map(file => `/${folder}/${file}`);
  }));
  return lists.flat().sort();
}
export async function saveActorProject(options: { root: string; documentPath: string; dungeonPath: string; dataPath: string }, value: unknown, revision: string) {
  const path = join(dirname(options.documentPath), 'actor-catalog.json'), temp = `${path}.${randomUUID()}.tmp`;
  const releaseData = acquireDataLease(options.dataPath);
  let releaseCatalog: (() => void) | undefined;
  try {
    releaseCatalog = acquireDataLease(path);
    const current = await readActorProject(path);
    if (current.revision !== revision) throw new Error('Il catalogo boss è cambiato in un’altra finestra. Ricarica prima di salvare.');
    const catalog = parseActorCatalog(value);
    const dungeons = JSON.parse(await readFile(options.dungeonPath, 'utf8'));
    unpackDungeonCatalog(dungeons, catalog);
    for (const skin of Object.values(catalog.skins)) for (const animation of Object.values(skin.animations))
      await access(resolve(options.root, 'public', animation.asset.slice(1)));
    const backup = `${path}.${randomUUID()}.bak`;
    await writeFile(backup, current.text, { flag: 'wx' });
    const text = JSON.stringify(catalog, null, 2) + '\n';
    await writeFile(temp, text, { flag: 'wx' });
    if ((await readActorProject(path)).revision !== revision) throw new Error('Catalogo modificato durante il salvataggio.');
    await rename(temp, path);
    return { catalog, revision: actorRevision(text), backup };
  } finally { await unlink(temp).catch(() => {}); releaseCatalog?.(); releaseData(); }
}
