import { randomUUID } from 'node:crypto';
import { copyFile, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { DungeonBundle } from '../shared/dungeon-install';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const parse = (text: string): unknown => JSON.parse(text.replace(/^\uFEFF/, ''));

export async function readCatalog(path: string): Promise<{ text: string; bundles: DungeonBundle[] }> {
    const text = await readFile(path, 'utf8'), value = parse(text);
    if (!Array.isArray(value) || !value.every(b => object(b) && object(b.definition)
        && typeof b.definition.id === 'string' && Array.isArray(b.bosses)
        && b.bosses.every(boss => object(boss) && typeof boss.id === 'string')))
        throw new Error('Catalogo dungeon non valido. Nessun file modificato.');
    const ids = value.map(b => b.definition.id), bosses = value.flatMap(b => b.bosses.map((boss: { id: string }) => boss.id));
    if (new Set(ids).size !== ids.length || new Set(bosses).size !== bosses.length)
        throw new Error('ID duplicati nel catalogo dungeon. Nessun file modificato.');
    return { text, bundles: value as DungeonBundle[] };
}

/** Offline maintenance: never construct AccountStore, which can migrate account data. */
export async function removeDungeon(options: { id: string; catalogPath: string; dataPath: string; check?: boolean }) {
    const { id, catalogPath } = options;
    const catalog = await readCatalog(catalogPath), bundle = catalog.bundles.find(b => b.definition.id === id);
    if (!bundle && id !== '--all') throw new Error(`Dungeon personalizzato "${id}" non trovato. Usa --list per vedere gli ID installati.`);
    return changeCatalog(options, catalog.text, id === '--all' ? [] : catalog.bundles.filter(b => b.definition.id !== id),
        id === '--all' ? catalog.bundles.flatMap(b => b.bosses.map(boss => boss.id)) : bundle!.bosses.map(b => b.id));
}

export async function changeCatalog(options: { id: string; catalogPath: string; dataPath: string; check?: boolean },
    catalogText: string, next: DungeonBundle[], bossIds: string[]) {
    const { id, catalogPath, dataPath, check } = options;
    let dataText: string | undefined;
    try { dataText = await readFile(dataPath, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let data: Record<string, unknown> | undefined, removedStates = 0;
    if (dataText !== undefined) {
        const value = parse(dataText);
        if (!object(value) || value.version !== 2 || !Array.isArray(value.accounts)
            || ('bosses' in value && !object(value.bosses)))
            throw new Error('Salvataggio non supportato: servono version: 2, accounts e un eventuale oggetto bosses. Nessun file modificato.');
        data = value;
        if (id === '--all') {
            bossIds = [...new Set([...bossIds, ...Object.keys(object(data.bosses) ? data.bosses : {})])];
        }
        if (object(data.bosses)) for (const bossId of bossIds) {
            if (Object.hasOwn(data.bosses, bossId)) { delete data.bosses[bossId]; removedStates++; }
        }
    }
    const result = { id, bossIds, removedStates, dataExists: dataText !== undefined, backups: [] as string[] };
    if (check) return result;

    if (id !== '--all' && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('ID dungeon non valido.');
    const tag = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}--${id === '--all' ? 'catalog' : `dungeon-${id}`}`;
    const files = [{ path: catalogPath, before: catalogText,
        after: JSON.stringify(next, null, 2) + '\n' }];
    // Save cleanup first: if interrupted, the old catalog can still load the cleaned save.
    if (dataText !== undefined && (removedStates > 0 || id === '--all'))
        files.unshift({ path: dataPath, before: dataText, after: JSON.stringify(data, null, 2) + '\n' });
    const backups = dataText === undefined ? [catalogPath] : [catalogPath, dataPath];
    const staged: string[] = [];
    let saveWritten = false;
    try {
        for (const path of backups) {
            const backup = `${path}.${tag}.bak`;
            await copyFile(path, backup, constants.COPYFILE_EXCL);
            result.backups.push(backup);
        }
        for (const file of files) {
            const temporary = `${file.path}.${tag}.tmp`;
            staged.push(temporary);
            await writeFile(temporary, file.after, { flag: 'wx', mode: (await stat(file.path)).mode & 0o777 });
        }
        // Catch edits since planning; the server must still be stopped throughout maintenance.
        for (const file of files)
            if (await readFile(file.path, 'utf8') !== file.before)
                throw new Error('Un file è cambiato durante la rimozione. Ferma il server e riprova.');
        for (let i = 0; i < files.length; i++) {
            await rename(staged[i], files[i].path);
            if (files[i].path === dataPath) saveWritten = true;
        }
    } catch (error) {
        const recovery = saveWritten ? ' Il salvataggio dei boss è già stato pulito; ripristina entrambi i backup prima di riavviare oppure ripeti la rimozione.' : '';
        throw new Error(`${error instanceof Error ? error.message : String(error)}${recovery}${result.backups.length ? ` Backup: ${result.backups.join(', ')}` : ''}`);
    } finally {
        for (const temporary of staged) await unlink(temporary).catch(() => {});
    }
    return result;
}
