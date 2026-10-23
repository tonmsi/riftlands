import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, access, unlink, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, join } from 'node:path';
import { parseWorldDocument, validWorldAssetImage, type WorldDocument } from '../shared/world-schema';
import { readActorProject } from './actor-library';
import { assetFilePath } from '../shared/world-asset-paths';
import { validateWorld } from '../shared/world-validation';
import type { DungeonDefinition } from '../shared/dungeons';
import { acquireDataLease } from '../server/data-lease';
import { worldDungeons } from '../shared/world-validation';
import { mapDocument } from '../shared/warps';
import { compactWorldTiles, serializeWorldDocument } from '../shared/world-tiles';
import { readCatalog } from './dungeon-removal';
import { repairWorldAssetPaths } from '../shared/world-asset-paths';
import { listWorldAssetFiles } from './world-asset-files';

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
export async function saveWorldProject(options: { root: string; documentPath: string; dungeonPath: string; dataPath: string }, document: unknown, revision: string, deleteAssetId?: string) {
  const releaseData = acquireDataLease(options.dataPath);
  let releaseWorld: (() => void) | undefined;
  const temp = `${options.documentPath}.${randomUUID()}.tmp`;
  let removedImage: { path: string; staged: string } | undefined;
  try {
    releaseWorld = acquireDataLease(options.documentPath);
    const current = await readFile(options.documentPath, 'utf8');
    const currentRevision = worldRevision(current);
    if (currentRevision !== revision && !(await formatCompatibleRevisions(options.documentPath, currentRevision)).includes(revision)) throw new Error('Il progetto è stato modificato da un’altra finestra. Esporta la bozza e ricarica prima di applicare.');
    const next = compactWorldTiles(parseWorldDocument(document)), catalog = await readWorldDungeonCatalog(options.dungeonPath);
    repairWorldAssetPaths(next, await listWorldAssetFiles(options.root));
    if (deleteAssetId !== undefined) {
      const asset = next.assets.find(a => a.id === deleteAssetId);
      if (!asset) throw new Error('Asset non più presente.');
      if (next.assets.some(a => a.variantOf === asset.id)) throw new Error('Rendi autonome le varianti prima di eliminare il principale.');
      if (Object.values(next.cliffAssets ?? {}).includes(asset.id)) throw new Error('Questo asset definisce un bordo automatico.');
      if (catalog.some(d => d.assetPlacements?.some(p => p.assetId === asset.id))) throw new Error('Rimuovi prima le istanze dai dungeon.');
      next.assets = next.assets.filter(a => a.id !== asset.id);
      for (const doc of [next, ...(next.interiors ?? []).map(m => m.document)]) doc.placements = doc.placements.filter(p => p.assetId !== asset.id);
      const image = assetFilePath(asset.image);
      const referencesImage = (value: unknown): boolean => typeof value === 'string' ? assetFilePath(value) === image
        : !!value && typeof value === 'object' && Object.values(value).some(referencesImage);
      const actors = await readActorProject(join(dirname(options.documentPath), 'actor-catalog.json'));
      const dungeons = await readCatalog(options.dungeonPath);
      const owners = [
        ...next.assets.filter(a => assetFilePath(a.image) === image).map(a => `asset “${a.name}” (${a.id})`),
        ...Object.entries(actors.catalog.skins).filter(([, skin]) => referencesImage(skin)).map(([id]) => `aspetto personaggio “${id}”`),
        ...dungeons.bundles.filter(bundle => referencesImage(bundle)).map(bundle => `dungeon “${bundle.definition.name}”`),
      ];
      if (owners.length) throw new Error(`Immagine condivisa: ${decodeURIComponent(asset.image)} è usata anche da ${owners.slice(0, 5).join(', ')}${owners.length > 5 ? ` e altre ${owners.length - 5} voci` : ''}. Per eliminare solo questa voce usa “Rimuovi dal catalogo · conserva file”.`);
      if (!validWorldAssetImage(asset.image)) throw new Error('Percorso immagine non valido.');
      const publicDirectory = await realpath(resolve(options.root, 'public'));
      const directory = await realpath(resolve(options.root, 'public/world-assets'));
      const folderWithin = relative(publicDirectory, directory);
      if (!folderWithin || folderWithin.startsWith('..') || isAbsolute(folderWithin)) throw new Error('La cartella world-assets deve trovarsi nel progetto.');
      const path = resolve(options.root, 'public', decodeURIComponent(asset.image.slice(1)));
      const actual = await realpath(path), within = relative(directory, actual);
      if (!within || within.startsWith('..') || isAbsolute(within) || !(await lstat(path)).isFile()) throw new Error('Il file deve trovarsi nella cartella world-assets.');
      removedImage = { path, staged: `${path}.${randomUUID()}.tmp` };
    }
    const issues = validateWorld(next, catalog);
    if (issues.length) throw new Error(issues.slice(0, 12).join('\n'));
    for (const a of next.assets) {
      try { await access(resolve(options.root, 'public', decodeURIComponent(a.image.slice(1)))); }
      catch { throw new Error(`Immagine assente per ${a.name}: ${decodeURIComponent(a.image)}. Premi Sincronizza cartelle per riparare i file spostati, oppure ripristina l’immagine.`); }
    }
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
    await writeFile(temp, text, { flag: 'wx' });
    if (removedImage) await rename(removedImage.path, removedImage.staged);
    try { await rename(temp, options.documentPath); }
    catch (e) { if (removedImage) await rename(removedImage.staged, removedImage.path); throw e; }
    if (removedImage) {
      try { await unlink(removedImage.staged); }
      catch (e) {
        await rename(removedImage.staged, removedImage.path);
        await writeFile(temp, current, { flag: 'wx' }); await rename(temp, options.documentPath);
        throw e;
      }
    }
    return { revision: worldRevision(text), backup, backups, ...(deleteAssetId !== undefined ? { document: next } : {}) };
  } finally {
    await unlink(temp).catch(() => {}); releaseWorld?.(); releaseData();
  }
}

/** Readable filenames; collisions receive a stable content suffix without overwrites. */
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
  const directory = resolve(root, 'public', folder);
  await mkdir(directory, { recursive: true });
  const suffix = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const name = `${stem}${attempt ? `-${suffix}${attempt > 1 ? `-${attempt - 1}` : ''}` : ''}.${ext}`;
    const path = resolve(directory, name);
    try { await writeFile(path, bytes, { flag: 'wx' }); return `/${folder}/${name}`; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if ((await readFile(path)).equals(bytes)) return `/${folder}/${name}`;
    }
  }
  throw new Error('Troppi file con lo stesso nome: scegli un altro nome per l’immagine.');
}
