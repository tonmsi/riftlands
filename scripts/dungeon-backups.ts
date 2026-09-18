import { readdir, lstat, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export interface BackupGroup { scope: string; label: string; count: number; bytes: number; files: string[]; }
type Paths = { catalogPath: string; dataPath: string };

/** Scan only siblings of the configured originals. Never accept paths from the browser. */
async function backupFiles(options: Paths) {
    const files: { path: string; scope: string; bytes: number }[] = [];
    for (const original of new Set([resolve(options.catalogPath), resolve(options.dataPath)])) {
        const directory = dirname(original), prefix = `${basename(original)}.`;
        const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.bak')) continue;
            const path = resolve(directory, entry.name);
            if (dirname(path) !== directory || path === original) throw new Error('Percorso backup non valido.');
            const suffix = entry.name.slice(prefix.length);
            const tag = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z-[a-f0-9-]{36}--(dungeon-([a-z0-9][a-z0-9-]{0,63})|catalog)\.bak$/.exec(suffix);
            const scope = tag ? (tag[2] ? `dungeon:${tag[2]}` : 'catalog') : 'legacy';
            const info = await lstat(path);
            if (info.isFile() && !info.isSymbolicLink()) files.push({ path, scope, bytes: info.size });
        }
    }
    return files;
}

export async function listDungeonBackups(options: Paths): Promise<BackupGroup[]> {
    const groups = new Map<string, BackupGroup>();
    for (const file of await backupFiles(options)) {
        const group = groups.get(file.scope) ?? { scope: file.scope,
            label: file.scope === 'legacy' ? 'Storici / condivisi (dungeon non identificabile)'
                : file.scope === 'catalog' ? 'Operazioni su tutto il catalogo' : file.scope.slice('dungeon:'.length),
            count: 0, bytes: 0, files: [] };
        group.count++; group.bytes += file.bytes; group.files.push(file.path); groups.set(file.scope, group);
    }
    return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
}

/** Caller holds the same data lease used by catalog writes. Originals and other scopes are untouched. */
export async function removeDungeonBackups(options: Paths, scope: string) {
    if (typeof scope !== 'string' || !/^(all|legacy|catalog|dungeon:[a-z0-9][a-z0-9-]{0,63})$/.test(scope))
        throw new Error('Selezione backup non valida.');
    const selected = (await backupFiles(options)).filter(file=>scope === 'all' || file.scope === scope);
    let deletedFiles = 0, deletedBytes = 0;
    for (const file of selected) {
        try {
            const info = await lstat(file.path);
            if (!info.isFile() || info.isSymbolicLink()) throw new Error('Il file backup è cambiato.');
            await unlink(file.path); deletedFiles++; deletedBytes += file.bytes;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw new Error(`Eliminati ${deletedFiles} backup; impossibile eliminare ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { deletedFiles, deletedBytes };
}
