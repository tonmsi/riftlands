import { createServer, type IncomingMessage } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { acquireDataLease } from '../server/data-lease';
import { installDungeon } from './dungeon-library';
import { readCatalog, removeDungeon } from './dungeon-removal';
import { listDungeonBackups, removeDungeonBackups } from './dungeon-backups';

async function body(request: IncomingMessage): Promise<any> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 2_000_000) throw new Error('File troppo grande (massimo 2 MB).');
        chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** A separate loopback-only developer process. No administration routes on the game server. */
export async function startDungeonStudio(options: { root: string; catalogPath: string; dataPath: string; port: number }) {
    const token = randomUUID(); let origin = '', busy = false;
    const vite = await createViteServer({ root: options.root, server: { middlewareMode: true, hmr: false,
        fs: { strict: true, allow: [options.root], deny: ['**/.git/**', '**/data/**', '**/server/**', '**/scripts/**', '**/tests/**', '**/*.bak', '**/*.tmp', '**/*.lock', '**/*.log', '**/*accounts*.json', '.env', '.env.*', '*.{crt,pem}'] } }, appType: 'mpa' });
    const server = createServer((request, response) => {
        const reply = (status: number, value: unknown) => {
            response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            response.end(JSON.stringify(value));
        };
        if (`http://${request.headers.host}` !== origin || (request.headers.origin && request.headers.origin !== origin)) {
            reply(403, { error: 'Studio accessibile solo dalla propria pagina locale.' }); return;
        }
        if ((request.url ?? '').split('?')[0] !== '/__studio/library') {
            vite.middlewares(request, response, () => { response.writeHead(404); response.end(); }); return;
        }
        void (async () => {
            if (request.method === 'GET') {
                const catalog = await readCatalog(options.catalogPath);
                reply(200, { token, dungeons: catalog.bundles.map(b => ({ id: b.definition.id, name: b.definition.name, draft: b.draft })), backups: await listDungeonBackups(options) });
                return;
            }
            const supplied = Buffer.from(String(request.headers['x-studio-token'] ?? ''));
            if (request.method !== 'POST' || request.headers.origin !== origin || supplied.length !== token.length
                || !timingSafeEqual(supplied, Buffer.from(token)) || !request.headers['content-type']?.startsWith('application/json')) {
                reply(403, { error: 'Richiesta Studio non autorizzata.' }); return;
            }
            const payload = await body(request);
            if (busy) { reply(409, { error: 'Operazione già in corso.' }); return; }
            if (!payload || !['install', 'update', 'remove', 'remove-backups'].includes(payload.action)) throw new Error('Operazione non valida.');
            if (payload.action === 'remove' && (typeof payload.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(payload.id))) throw new Error('ID dungeon non valido.');
            busy = true;
            let release: (() => void) | undefined;
            try {
                release = acquireDataLease(options.dataPath);
                if (payload.action === 'remove-backups') {
                    reply(200, await removeDungeonBackups(options,payload.scope));
                    return;
                }
                const result = payload.action === 'remove'
                    ? await removeDungeon({ ...options, id: payload.id })
                    : await installDungeon(payload.draft, { ...options, replace: payload.action === 'update' });
                vite.moduleGraph.invalidateAll();
                reply(200, result);
            } finally { release?.(); busy = false; }
        })().catch(error => reply(400, { error: error instanceof Error ? error.message : String(error) }));
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
