import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { readActorProject, saveActorProject, listActorAssets } from './actor-library';
import { createServer as createViteServer } from 'vite';
import { importWorldImage, readWorldProject, readWorldDungeonCatalog, saveWorldProject } from './world-library';
import { dungeonStudioRoutes } from './dungeon-studio-routes';

async function readBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 40_000_000) throw new Error('Richiesta oltre 40 MB.'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function startWorldStudio(options: { root: string; documentPath: string; dungeonPath: string; dataPath: string; port: number }) {
  const token = randomUUID(); let origin = '', busy = false;
  let vite: Awaited<ReturnType<typeof createViteServer>>;
  const library = dungeonStudioRoutes({ ...options, catalogPath: options.dungeonPath, managedPlacement: true }, () => vite.moduleGraph.invalidateAll());
  const server = createServer((request, response) => {
    const reply = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };
    if (`http://${request.headers.host}` !== origin || (request.headers.origin && request.headers.origin !== origin)) { reply(403, { error: 'World Studio accessibile dalla propria pagina locale.' }); return; }
    const path = (request.url ?? '').split('?')[0];
    if (library(request, response, origin)) return;
    const image = /^\/world-assets\/([a-zA-Z0-9_-]+\.(png|svg))$/.exec(path);
    if (image && request.method === 'GET') {
      // New immutable uploads are available immediately, independent of Vite's public-file watcher.
      void readFile(resolve(options.root, 'public/world-assets', image[1])).then(bytes => {
        response.writeHead(200, { 'Content-Type': image[2] === 'png' ? 'image/png' : 'image/svg+xml', 'X-Content-Type-Options': 'nosniff',
          'Cache-Control': /^[a-f0-9]{64}\./.test(image[1]) ? 'public, max-age=31536000, immutable' : 'no-cache' }); response.end(bytes);
      }).catch(() => { response.writeHead(404); response.end(); }); return;
    }
    if (!['/__world/project', '/__world/images', '/__world/actors', '/api/actor-catalog'].includes(path)) { vite.middlewares(request, response, () => { response.writeHead(404); response.end(); }); return; }
    void (async () => {
      if (request.method === 'GET' && (path === '/__world/actors' || path === '/api/actor-catalog')) {
        const { catalog, revision } = await readActorProject(join(dirname(options.documentPath), 'actor-catalog.json'));
        reply(200, { token, catalog, revision, assets: await listActorAssets(options.root) }); return;
      }
      if (request.method === 'GET' && path === '/__world/project') {
        reply(200, { token, ...await readWorldProject(options.documentPath), dungeons: await readWorldDungeonCatalog(options.dungeonPath) }); return;
      }
      const provided = Buffer.from(String(request.headers['x-world-token'] ?? '')), expected = Buffer.from(token);
      if (request.headers.origin !== origin || provided.length !== expected.length || !timingSafeEqual(provided, expected)) { reply(403, { error: 'Autorizzazione locale richiesta.' }); return; }
      if (request.method !== 'POST') { reply(405, { error: 'Metodo non consentito.' }); return; }
      if (busy) { reply(409, { error: 'Operazione già in corso.' }); return; }
      busy = true;
      try {
        const payload = await readBody(request);
        if (path === '/__world/actors') { const result = await saveActorProject(options, payload.catalog, payload.revision); vite.moduleGraph.invalidateAll(); reply(200, result); }
        else if (path === '/__world/images') reply(200, { image: await importWorldImage(options.root, payload.mime, payload.base64) });
        else { const result = await saveWorldProject(options, payload.document, payload.revision); vite.moduleGraph.invalidateAll(); reply(200, result); }
      } finally { busy = false; }
    })().catch(e => { if (!response.headersSent) reply(400, { error: e instanceof Error ? e.message : String(e) }); });
  });
  // Keep Vite's style transport on this same loopback server, without file watching or
  // surprise reloads on Apply. A second maker never contends for the default HMR port.
  vite = await createViteServer({ root: options.root, server: { middlewareMode: true, hmr: { server }, watch: null,
    fs: { strict: true, allow: [options.root], deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.tmp/**', '**/data/**', '**/server/**', '**/scripts/**', '**/tests/**', '**/*accounts*.json', '**/*.bak', '**/*.tmp', '**/*.lock', '**/*.log'] } }, appType: 'mpa' });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
  } catch (e) { await vite.close(); throw e; }
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Porta locale non disponibile.');
  origin = `http://127.0.0.1:${address.port}`;
  return { url: `${origin}/world-maker.html`, async close() { await vite.close(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); } };
}
