import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Cooperative exclusion between the game server and offline developer tools. */
export function acquireDataLease(dataPath: string): () => void {
    const path = `${dataPath}.lock`, token = randomUUID();
    mkdirSync(dirname(path), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = openSync(path, 'wx', 0o600);
            try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); }
            finally { closeSync(fd); }
            let released = false;
            return () => {
                if (released) return;
                released = true;
                try { if (JSON.parse(readFileSync(path, 'utf8')).token === token) unlinkSync(path); } catch { /* already released */ }
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            let pid: unknown;
            try { pid = JSON.parse(readFileSync(path, 'utf8')).pid; } catch { /* never remove an unrecognized lock */ }
            if (Number.isSafeInteger(pid) && Number(pid) > 0) {
                try { process.kill(Number(pid), 0); }
                catch (probe) {
                    if ((probe as NodeJS.ErrnoException).code === 'ESRCH') { unlinkSync(path); continue; }
                }
            }
            throw new Error(`Salvataggio in uso. Ferma il server o l'altra operazione prima di modificare i dungeon (${path}).`);
        }
    }
    throw new Error('Impossibile acquisire il salvataggio. Riprova.');
}
