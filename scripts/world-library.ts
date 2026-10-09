import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, access, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseWorldDocument, type WorldDocument } from '../shared/world-schema';
import { validateWorld } from '../shared/world-validation';
import type { DungeonDefinition } from '../shared/dungeons';
import { acquireDataLease } from '../server/data-lease';
import { worldDungeons } from '../shared/world-validation';
import { mapDocument } from '../shared/warps';
import { compactWorldTiles, serializeWorldDocument } from '../shared/world-tiles';
import { readCatalog } from './dungeon-removal';

export const worldRevision = (text: string): string => createHash('sha256').update(text).digest('hex');
async function formatCompatibleRevisions(path: string, revision: string): Promise<string[]> {
  try {
    const marker = JSON.parse(await readFile(`${path}.format-migration.bak`, 'utf8'));
    return marker.toRevision === revision && /^[a-f0-9]{64}$/.test(marker.fromRevision) ? [marker.fromRevision] : [];
  } catch { return []; }
}
export async function readWorldProject(path: string) {
  const text = await readFile(path, 'utf8'), revision = worldRevision(text);
  return { document: compactWorldTiles(parseWorldDocument(text)), revision, compatibleRevisions: await formatCompatibleRevisions(path, revision) };
}
export async function readWorldDungeonCatalog(path: string): Promise<DungeonDefinition[]> {
  const { bundles } = await readCatalog(path);
  return bundles.map(b => b.definition);
}
export async function saveWorldProject(options: { root: string; documentPath: string; dungeonPath: string; dataPath: string }, document: unknown, revision: string) {
  const releaseData = acquireDataLease(options.dataPath);
  let releaseWorld: (() => void) | undefined;
  const temp = `${options.documentPath}.${randomUUID()}.tmp`;
  try {
    releaseWorld = acquireDataLease(options.documentPath);
    const current = await readFile(options.documentPath, 'utf8');
    const currentRevision = worldRevision(current);
    if (currentRevision !== revision && !(await formatCompatibleRevisions(options.documentPath, currentRevision)).includes(revision)) throw new Error('Il progetto è stato modificato da un’altra finestra. Esporta la bozza e ricarica prima di applicare.');
    const next = compactWorldTiles(parseWorldDocument(document)), catalog = await readWorldDungeonCatalog(options.dungeonPath);
    const issues = validateWorld(next, catalog);
    if (issues.length) throw new Error(issues.slice(0, 12).join('\n'));
    for (const a of next.assets) await access(resolve(options.root, 'public', a.image.slice(1)));
    for (const doc of [next, ...(next.interiors ?? []).map(m => m.document)])
      for (const zone of doc.zones) if (zone.music) await access(resolve(options.root, 'public', zone.music.src.slice(1)));
    const tag = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
    const backup = `${options.documentPath}.${tag}.bak`, backups = [backup];
    await writeFile(backup, current, { flag: 'wx' });
    // A moved encounter must not invalidate unrelated boss persistence on the next startup.
    // Targeted cleanup happens first: an interruption still leaves a loadable old world.
    const placements = (project: WorldDocument) => ['world', ...(project.interiors ?? []).map(m => m.id)].flatMap(mapId =>
      worldDungeons(mapDocument(project, mapId), catalog).map(dungeon => ({ mapId, dungeon })));
    const oldDungeons = placements(parseWorldDocument(current)), newDungeons = placements(next);
    const movedBossIds = new Set(oldDungeons.filter(old => {
      const next = newDungeons.find(d => d.dungeon.id === old.dungeon.id);
      return !next || next.mapId !== old.mapId || old.dungeon.layout.bounds.minTx !== next.dungeon.layout.bounds.minTx || old.dungeon.layout.bounds.minTy !== next.dungeon.layout.bounds.minTy;
    }).flatMap(({ dungeon }) => [dungeon.bossId, ...(dungeon.additionalEncounters ?? []).map(e => e.bossId)]));
    if (movedBossIds.size) {
      let savePath = resolve(dirname(options.dataPath), 'dungeon.json'), saveText: string | undefined;
      try { saveText = await readFile(savePath, 'utf8'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; savePath = options.dataPath; try { saveText = await readFile(savePath, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
      if (saveText !== undefined) {
        const save = JSON.parse(saveText);
        if (!save || typeof save !== 'object' || (save.bosses !== undefined && (!save.bosses || typeof save.bosses !== 'object' || Array.isArray(save.bosses)))) throw new Error('Stato dei boss non leggibile; nessun mondo applicato.');
        let removed = 0;
        for (const id of movedBossIds) if (save.bosses && Object.hasOwn(save.bosses, id)) { delete save.bosses[id]; removed++; }
        if (removed) {
          const stateBackup = `${savePath}.${tag}--world-relocation.bak`, stateTemp = `${savePath}.${tag}.tmp`;
          await writeFile(stateBackup, saveText, { flag: 'wx' }); backups.push(stateBackup);
          try { await writeFile(stateTemp, JSON.stringify(save, null, 2) + '\n', { flag: 'wx' }); await rename(stateTemp, savePath); }
          finally { await unlink(stateTemp).catch(() => {}); }
        }
      }
    }
    const text = serializeWorldDocument(next);
    await writeFile(temp, text, { flag: 'wx' }); await rename(temp, options.documentPath);
    return { revision: worldRevision(text), backup, backups };
  } finally {
    await unlink(temp).catch(() => {}); releaseWorld?.(); releaseData();
  }
}

/** Readable filenames; existing images can be reused but never silently overwritten. */
export async function importWorldImage(root: string, mime: string, base64: string, folder: 'world-assets' | 'actor-assets' = 'world-assets', filename: string = 'asset'): Promise<string> {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 7_000_000) throw new Error('Immagine non valida o oltre 5 MB.');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 5_000_000) throw new Error('Immagine oltre 5 MB.');
  let ext: string;
  if (mime === 'image/png') {
    if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString() !== 'IHDR') throw new Error('PNG non valido.');
    const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
    if (!w || !h || w > 8192 || h > 8192 || w * h > 32_000_000) throw new Error('Risoluzione PNG troppo grande.');
    ext = 'png';
  } else if (mime === 'image/svg+xml') {
    const svg = bytes.toString('utf8');
    if (!/<svg\b/i.test(svg) || /<!DOCTYPE|<!ENTITY|<\s*(?:[\w-]+:)?(?:script|foreignObject|iframe|object|embed|audio|video|animate|set|animateTransform|animateMotion)\b|\bon[\w-]+\s*=|@import|<\?xml-stylesheet/i.test(svg)
      || /(?:href|src)\s*=\s*(?:"(?!#)|'(?!#)|[^"'\s])/i.test(svg)
      || [...svg.matchAll(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi)].some(match => !match[2].trim().startsWith('#'))) throw new Error('SVG non supportato: usa solo forme, senza script o risorse esterne.');
    ext = 'svg';
  } else throw new Error('Importa un PNG o SVG.');
  if (typeof filename !== 'string' || filename.length > 200 || /[/\\]/.test(filename)) throw new Error('Nome file non valido.');
  const stem = filename.replace(/\.(png|svg)$/i, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  if (!stem) throw new Error('Il nome file deve contenere lettere o numeri.');
  const name = `${stem}.${ext}`, directory = resolve(root, 'public', folder), path = resolve(directory, name);
  await mkdir(directory, { recursive: true });
  try { await writeFile(path, bytes, { flag: 'wx' }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    if (!(await readFile(path)).equals(bytes)) throw new Error(`Esiste già un asset diverso chiamato ${name}. Rinomina il file prima di importarlo.`);
  }
  return `/${folder}/${name}`;
}
