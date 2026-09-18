import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalog, removeDungeon } from './dungeon-removal';
import { acquireDataLease } from '../server/data-lease';

async function main(): Promise<void> {
    const args = process.argv.slice(2), catalogPath = fileURLToPath(new URL('../shared/custom-dungeons.json', import.meta.url));
    if (args.length === 1 && args[0] === '--list') {
        const { bundles } = await readCatalog(catalogPath);
        console.log(bundles.length ? bundles.map(b => `${b.definition.id}: ${b.definition.name} (${b.bosses.length} boss)`).join('\n') : 'Nessun dungeon personalizzato installato.');
        return;
    }
    const id = args.shift();
    let check = false, dataPath = process.env.DATA_FILE ? resolve(process.env.DATA_FILE) : fileURLToPath(new URL('../data/accounts.json', import.meta.url));
    const usage = 'Uso: npm run dungeon:remove -- ID|--all [--check] [--data-file percorso/accounts.json] oppure --list. Esegui la rimozione a server fermo.';
    if (!id || (id.startsWith('--') && id !== '--all')) throw new Error(usage);
    while (args.length) {
        const arg = args.shift();
        if (arg === '--check' && !check) check = true;
        else if (arg === '--data-file' && args[0] && !args[0].startsWith('--')) dataPath = resolve(args.shift()!);
        else throw new Error(usage);
    }
    console.log(`Salvataggio: ${dataPath}`);
    const release = check ? () => {} : acquireDataLease(dataPath);
    let result;
    try { result = await removeDungeon({ id, catalogPath, dataPath, check }); }
    finally { release(); }
    console.log(`${check ? 'Da rimuovere' : 'Rimosso'}: ${id}, ${result.bossIds.length} boss, ${result.removedStates} stati salvati.`);
    if (!result.dataExists) console.log('Salvataggio non presente: nessun file account creato.');
    if (check) console.log('Nessun file modificato.');
    else {
        for (const path of result.backups) console.log(`Backup: ${path}`);
        console.log('Account e bozza originale conservati. Esegui npm run build prima di riavviare il server.');
    }
}
main().catch(error => {
    console.error(`Rimozione non riuscita: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
