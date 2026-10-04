import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startWorldStudio } from './world-studio-server';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.WORLD_STUDIO_PORT ?? process.env.STUDIO_PORT ?? 3002);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta Studio deve essere tra 1 e 65535.');
const studio = await startWorldStudio({ root, port, documentPath: resolve(root, 'shared/custom-world.json'), dungeonPath: resolve(root, 'shared/custom-dungeons.json'),
    dataPath: process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : resolve(root, 'data/accounts.json') });
console.log(`World Studio (Dungeon Maker incluso): ${studio.url}`);
console.log('Ferma il server di gioco prima di installare, aggiornare o eliminare. Ctrl+C chiude lo Studio.');
let closing = false;
const close = () => { if (!closing) { closing = true; void studio.close().then(() => process.exit(0)); } };
process.on('SIGINT', close); process.on('SIGTERM', close);
