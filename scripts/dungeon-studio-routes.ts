import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { acquireDataLease } from '../server/data-lease';
import { installDungeon } from './dungeon-library';
import { readCatalog, removeDungeon } from './dungeon-removal';
import { listDungeonBackups, removeDungeonBackups } from './dungeon-backups';

/** The same protected library is used by both editor entry points. */
export function dungeonStudioRoutes(options: { root: string; catalogPath: string; dataPath: string; documentPath?: string; managedPlacement?: boolean }, invalidate: () => void) {
    const token = randomUUID(); let busy = false;
    return (request: IncomingMessage, response: ServerResponse, origin: string): boolean => {
        if ((request.url ?? '').split('?')[0] !== '/__studio/library') return false;
        const reply = (status: number, value: unknown) => {
            response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            response.end(JSON.stringify(value));
        };
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
            const chunks: Buffer[] = []; let size = 0;
            for await (const chunk of request) {
                size += chunk.length;
                if (size > 2_000_000) throw new Error('File troppo grande (massimo 2 MB).');
                chunks.push(Buffer.from(chunk));
            }
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (busy) { reply(409, { error: 'Operazione già in corso.' }); return; }
            if (!payload || !['install', 'update', 'remove', 'remove-backups'].includes(payload.action)) throw new Error('Operazione non valida.');
            if (payload.action === 'remove' && (typeof payload.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(payload.id))) throw new Error('ID dungeon non valido.');
            busy = true;
            let release: (() => void) | undefined;
            try {
                release = acquireDataLease(options.dataPath);
                if (payload.action === 'remove-backups') { reply(200, await removeDungeonBackups(options, payload.scope)); return; }
                const result = payload.action === 'remove'
                    ? await removeDungeon({ ...options, id: payload.id })
                    : await installDungeon(payload.draft, { ...options, replace: payload.action === 'update' });
                invalidate(); reply(200, result);
            } finally { release?.(); busy = false; }
        })().catch(error => { if (!response.headersSent) reply(400, { error: error instanceof Error ? error.message : String(error) }); });
        return true;
    };
}
