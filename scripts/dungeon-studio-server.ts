import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { dungeonStudioRoutes } from './dungeon-studio-routes';

/** Compatibility entry point; World Studio hosts the same protected dungeon library. */
export async function startDungeonStudio(options: { root: string; catalogPath: string; dataPath: string; port: number }) {
    const vite = await createViteServer({ root: options.root, server: { middlewareMode: true, hmr: false,
        fs: { strict: true, allow: [options.root], deny: ['**/.git/**', '**/.tmp/**', '**/data/**', '**/server/**', '**/scripts/**', '**/tests/**', '**/*.bak', '**/*.tmp', '**/*.lock', '**/*.log', '**/*accounts*.json', '.env', '.env.*', '*.{crt,pem}'] } }, appType: 'mpa' });
    let origin = '';
    const library = dungeonStudioRoutes(options, () => vite.moduleGraph.invalidateAll());
    const server = createServer((request, response) => {
        if (`http://${request.headers.host}` !== origin || (request.headers.origin && request.headers.origin !== origin)) {
            response.writeHead(403, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Studio accessibile solo dalla propria pagina locale.' })); return;
        }
        if (!library(request, response, origin)) vite.middlewares(request, response, () => { response.writeHead(404); response.end(); });
    });
    try {
        await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', () => { server.removeListener('error', reject); done(); }); });
    } catch (error) { await vite.close(); throw error; }
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { url: `${origin}/dungeon-maker.html`, async close() {
        server.closeAllConnections();
        await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
        await vite.close();
    } };
}
