import { parseDungeonDraft, type DungeonDraft } from '../shared/dungeon-draft';
import { buildDungeonBundle } from '../shared/dungeon-install';
import { changeCatalog, readCatalog } from './dungeon-removal';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseWorldDocument } from '../shared/world-schema';
import { validateWorld, worldDungeons } from '../shared/world-validation';
import { readActorProject } from './actor-library';

/** Both the CLI and the local Studio use this install/update transaction. Caller holds the data lease. */
export async function installDungeon(draft: DungeonDraft, options: { catalogPath: string; dataPath: string; documentPath?: string; managedPlacement?: boolean; replace?: boolean; check?: boolean }) {
    const parsed = parseDungeonDraft(JSON.stringify(draft));
    const catalog = await readCatalog(options.catalogPath), old = catalog.bundles.find(b => b.definition.id === parsed.id);
    if (old && !options.replace) throw new Error(`ID dungeon già installato: ${parsed.id}. Usa Aggiorna per sostituirlo.`);
    if (!old && options.replace) throw new Error(`Dungeon ${parsed.id} non installato. Usa Installa per aggiungerlo.`);
    const remaining = catalog.bundles.filter(b => b.definition.id !== parsed.id);
    let worldDocument: ReturnType<typeof parseWorldDocument> | undefined;
    try { worldDocument = parseWorldDocument(await readFile(options.documentPath ?? join(dirname(options.catalogPath), 'custom-world.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let placed = true;
    if (worldDocument) {
        const placement = worldDocument.dungeons.find(p => p.dungeonId === parsed.id);
        if (placement) parsed.origin = { x: placement.x, y: placement.y };
        else if (options.managedPlacement && old) parsed.origin = { x: old.definition.layout.bounds.minTx, y: old.definition.layout.bounds.minTy };
        placed = placement?.enabled !== false && (!!placement || !!old || !options.managedPlacement);
        if (!placed && !placement) {
            parsed.origin = { x: 0, y: 0 };
            worldDocument.dungeons.push({ dungeonId: parsed.id, ...parsed.origin, enabled: false });
        }
    }
    const bundle = buildDungeonBundle(parsed, worldDocument ? worldDungeons(worldDocument, remaining.map(b => b.definition)) : remaining.map(b => b.definition),
        { assets: worldDocument?.assets, checkPlacement: placed,
          templates: new Map((await readActorProject(join(dirname(options.catalogPath), 'actor-catalog.json'))).catalog.bosses.map(b => [b.id, b])) });
    if (worldDocument) {
        const issues = validateWorld(worldDocument, [...remaining, bundle].map(b => b.definition));
        if (issues.length) throw new Error(`Dungeon incompatibile con il mondo: ${issues.slice(0, 12).join('\n')}`);
    }
    const result = await changeCatalog({ ...options, id: parsed.id, ...(!placed ? { unplacedDungeonId: parsed.id } : {}) }, catalog.text, [...remaining, bundle], old?.bosses.map(b => b.id) ?? []);
    return { ...result, name: parsed.name, encounters: parsed.encounters.length, bossCount: bundle.bosses.length };
}
