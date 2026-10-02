import { parseDungeonDraft, type DungeonDraft } from '../shared/dungeon-draft';
import { buildDungeonBundle } from '../shared/dungeon-install';
import { changeCatalog, readCatalog } from './dungeon-removal';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseWorldDocument } from '../shared/world-schema';
import { validateWorld, worldDungeons } from '../shared/world-validation';

/** Both the CLI and the local Studio use this install/update transaction. Caller holds the data lease. */
export async function installDungeon(draft: DungeonDraft, options: { catalogPath: string; dataPath: string; replace?: boolean; check?: boolean }) {
    const parsed = parseDungeonDraft(JSON.stringify(draft));
    const catalog = await readCatalog(options.catalogPath), old = catalog.bundles.find(b => b.definition.id === parsed.id);
    if (old && !options.replace) throw new Error(`ID dungeon già installato: ${parsed.id}. Usa Aggiorna per sostituirlo.`);
    if (!old && options.replace) throw new Error(`Dungeon ${parsed.id} non installato. Usa Installa per aggiungerlo.`);
    const remaining = catalog.bundles.filter(b => b.definition.id !== parsed.id);
    let worldDocument: ReturnType<typeof parseWorldDocument> | undefined;
    try { worldDocument = parseWorldDocument(await readFile(join(dirname(options.catalogPath), 'custom-world.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (worldDocument) {
        const placement = worldDocument.dungeons.find(p => p.dungeonId === parsed.id);
        if (placement?.enabled !== false && placement) parsed.origin = { x: placement.x, y: placement.y };
    }
    const bundle = buildDungeonBundle(parsed, worldDocument ? worldDungeons(worldDocument, remaining.map(b => b.definition)) : remaining.map(b => b.definition));
    if (worldDocument) {
        const issues = validateWorld(worldDocument, [...remaining, bundle].map(b => b.definition));
        if (issues.length) throw new Error(`Dungeon incompatibile con il mondo: ${issues.slice(0, 12).join('\n')}`);
    }
    const result = await changeCatalog({ ...options, id: parsed.id }, catalog.text, [...remaining, bundle], old?.bosses.map(b => b.id) ?? []);
    return { ...result, name: parsed.name, encounters: parsed.encounters.length, bossCount: bundle.bosses.length };
}
