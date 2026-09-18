import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDungeonFile } from '../shared/dungeon-import';
import { acquireDataLease } from '../server/data-lease';
import { installDungeon } from './dungeon-library';

async function importDungeonCommand(): Promise<void> {
    const [source, ...flags] = process.argv.slice(2);
    if (!source || flags.some(flag => !['--check', '--replace'].includes(flag)))
        throw new Error('Uso: npm run dungeon:import -- percorso/dungeon.json [--check] [--replace]');
    const catalogPath = fileURLToPath(new URL('../shared/custom-dungeons.json', import.meta.url));
    const dataPath = process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : fileURLToPath(new URL('../data/accounts.json', import.meta.url));
    const { draft, warnings } = parseDungeonFile(await readFile(source, 'utf8'));
    for (const warning of warnings) console.warn(warning);
    const check = flags.includes('--check'), release = check ? () => {} : acquireDataLease(dataPath);
    try {
        const result = await installDungeon(draft, { catalogPath, dataPath, check, replace: flags.includes('--replace') });
        console.log(`${check ? 'Valido' : 'Salvato'}: ${result.name}, ${result.bossCount} boss, ${result.encounters} incontri.`);
        if (check) console.log('Nessun file modificato.');
        else { for (const path of result.backups) console.log(`Backup: ${path}`); console.log('Esegui npm run build e riavvia il server.'); }
    } finally { release(); }
}

importDungeonCommand().catch(error => { console.error(`Importazione non riuscita: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
