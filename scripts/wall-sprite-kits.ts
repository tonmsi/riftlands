import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';
import { isWallSpriteKitId, parseWallSpriteKitCatalog, WALL_SPRITE_PARTS, type WallSpriteKit, type WallSpriteKitCatalog } from '../shared/wall-sprite-kits';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR')
    throw new Error('il file non è un PNG valido');
  let offset = 8, data = false, end = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error('PNG troncato');
    offset += length + 12;
    if (kind === 'IDAT') data = true;
    if (kind === 'IEND') { end = length === 0 && offset === bytes.length; break; }
  }
  if (!data || !end) throw new Error('PNG incompleto: dati o terminatore mancanti');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error('dimensioni PNG consentite: 1–8192 pixel');
  return { width, height };
}

/** Direct child folders only; artwork packs are not catalogued as placeable decorations. */
export async function scanWallSpriteKits(root: string): Promise<WallSpriteKitCatalog> {
  const catalog: WallSpriteKitCatalog = { version: 1, kits: [], issues: [] };
  let folders;
  try { folders = await readdir(root, { withFileTypes: true }); }
  catch (error: any) { if (error.code === 'ENOENT') return catalog; throw error; }
  for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!folder.isDirectory() || folder.isSymbolicLink()) continue;
    if (!isWallSpriteKitId(folder.name)) { catalog.issues.push(`Cartella ignorata: ${folder.name}. Usa lettere minuscole, numeri e trattini.`); continue; }
    if (catalog.kits.length >= 128) { catalog.issues.push('Sono consentiti al massimo 128 kit PNG.'); break; }
    const directory = path.join(root, folder.name);
    try {
      const files = await readdir(directory, { withFileTypes: true });
      const metadata = files.find(f => f.name === 'kit.json' && f.isFile() && !f.isSymbolicLink());
      let settings: any = {};
      if (metadata) {
        if ((await stat(path.join(directory, metadata.name))).size > 16_384) throw new Error('kit.json è troppo grande');
        settings = JSON.parse(await readFile(path.join(directory, metadata.name), 'utf8'));
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('kit.json deve contenere un oggetto');
      }
      const tileSize = settings.tileSize ?? 48;
      const kit: WallSpriteKit = { id: folder.name, name: settings.name ?? folder.name.replace(/-/g, ' '), material: settings.material ?? 'rock',
        tileSize, levelHeight: settings.levelHeight ?? tileSize / 3, pixelated: settings.pixelated ?? true,
        ...(settings.layout !== undefined ? { layout: settings.layout } : {}), parts: {} };
      for (const file of files) {
        if (!file.isFile() || file.isSymbolicLink() || !file.name.endsWith('.png')) continue;
        if (file.name.endsWith('-source.png')) continue;
        const part = WALL_SPRITE_PARTS.find(part => `${part}.png` === file.name);
        if (!part) { catalog.issues.push(`${folder.name}/${file.name}: nome non riconosciuto, PNG ignorato.`); continue; }
        const source = path.join(directory, file.name);
        if ((await stat(source)).size > 16 * 1024 * 1024) throw new Error(`${file.name} supera 16 MB`);
        const size = pngSize(await readFile(source));
        kit.parts[part] = { image: `/terrain-walls/${folder.name}/${file.name}`, ...size };
      }
      // Validate each kit in isolation so a malformed folder never hides the other packs.
      const checked = parseWallSpriteKitCatalog({ version: 1, kits: [kit], issues: [] });
      catalog.kits.push(checked.kits[0]);
    } catch (error) { catalog.issues.push(`${folder.name}: ${error instanceof Error ? error.message : String(error)}`); }
    if (catalog.issues.length >= 510) { catalog.issues = catalog.issues.slice(0, 510); catalog.issues.push('Ulteriori problemi omessi.'); break; }
  }
  return catalog;
}

/** Dev discovers folders on request; production carries the same catalog alongside the PNGs. */
export function wallSpriteKitPlugin(): Plugin {
  let folder = '';
  return {
    name: 'riftlands-wall-sprite-kits',
    configResolved(config) { folder = path.join(config.publicDir, 'terrain-walls'); },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/terrain-walls/catalog.json') { next(); return; }
        if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
        try {
          const catalog = await scanWallSpriteKits(folder);
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(request.method === 'HEAD' ? undefined : JSON.stringify(catalog));
        } catch { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Impossibile leggere le cartelle dei kit PNG.' })); }
      });
    },
    async generateBundle() { this.emitFile({ type: 'asset', fileName: 'terrain-walls/catalog.json', source: JSON.stringify(await scanWallSpriteKits(folder), null, 2) }); },
  };
}
