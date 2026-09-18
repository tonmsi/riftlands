import { parseDungeonDraft, type DungeonDraft } from '../shared/dungeon-draft';
import { buildDungeonBundle } from '../shared/dungeon-install';
import { changeCatalog, readCatalog } from './dungeon-removal';

/** Both the CLI and the local Studio use this install/update transaction. Caller holds the data lease. */
export async function installDungeon(draft: DungeonDraft, options: { catalogPath: string; dataPath: string; replace?: boolean; check?: boolean }) {
    const parsed = parseDungeonDraft(JSON.stringify(draft));
    const catalog = await readCatalog(options.catalogPath), old = catalog.bundles.find(b => b.definition.id === parsed.id);
    if (old && !options.replace) throw new Error(`ID dungeon già installato: ${parsed.id}. Usa Aggiorna per sostituirlo.`);
    if (!old && options.replace) throw new Error(`Dungeon ${parsed.id} non installato. Usa Installa per aggiungerlo.`);
    const remaining = catalog.bundles.filter(b => b.definition.id !== parsed.id);
    const bundle = buildDungeonBundle(parsed, remaining.map(b => b.definition));
    const result = await changeCatalog({ ...options, id: parsed.id }, catalog.text, [...remaining, bundle], old?.bosses.map(b => b.id) ?? []);
    return { ...result, name: parsed.name, encounters: parsed.encounters.length, bossCount: bundle.bosses.length };
}
