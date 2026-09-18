import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startDungeonStudio } from './dungeon-studio-server';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.STUDIO_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STUDIO_PORT deve essere tra 1 e 65535.');
const studio = await startDungeonStudio({ root, port, catalogPath: resolve(root, 'shared/custom-dungeons.json'),
    dataPath: process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : resolve(root, 'data/accounts.json') });
console.log(`Dungeon Studio: ${studio.url}`);
console.log('Ferma il server di gioco prima di installare, aggiornare o eliminare. Ctrl+C chiude lo Studio.');
let closing = false;
const close = () => { if (!closing) { closing = true; void studio.close().then(() => process.exit(0)); } };
process.on('SIGINT', close); process.on('SIGTERM', close);
