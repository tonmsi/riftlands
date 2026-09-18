import { TILE_SIZE } from './config';
import { compileDungeonDraft, draftFromDungeon, newDungeonDraft, parseDungeonDraft, type DungeonDraft } from './dungeon-draft';
import { assertValidDungeonDefinition, dungeonEncounters, type DungeonDefinition } from './dungeons';
/** Accept both files emitted by the editor, never treating imported JSON as executable behavior. */
export function parseDungeonFile(raw: string): {
    draft: DungeonDraft;
    warnings: string[];
} {
    if (raw.length > 2000000)
        throw new Error('File troppo grande (massimo 2 MB).');
    let value: any;
    try {
        value = JSON.parse(raw.replace(/^\uFEFF/, ''));
    }
    catch {
        throw new Error('JSON non valido: controlla virgole, parentesi e virgolette.');
    }
    if (!value || !Object.hasOwn(value, 'definition'))
        return { draft: parseDungeonDraft(JSON.stringify(value)), warnings: [] };
    try {
        const definition = value.definition as DungeonDefinition;
        const bounds = definition.layout.bounds;
        newDungeonDraft(bounds.maxTx - bounds.minTx + 1, bounds.maxTy - bounds.minTy + 1);
        if (!Array.isArray(value.bosses) || !value.bosses.length || value.bosses.length > 32
            || (definition.additionalEncounters?.length ?? 0) > 31)
            throw new Error('Elenco boss mancante o troppo lungo.');
        const encounters = dungeonEncounters(definition);
        if (new Set(value.bosses.map((b: any) => b.id)).size !== encounters.length || value.bosses.length !== encounters.length)
            throw new Error('I collegamenti dei boss non corrispondono agli incontri.');
        for (const encounter of encounters) {
            assertValidDungeonDefinition(encounter);
            // This importer recovers editor exports, not arbitrary hand-written runtime mechanics.
            const region = encounter.encounter.regions.combat;
            if (region.kind !== 'polygon' || region.points.length !== 4 || encounter.encounter.preparationMs !== 5000
                || Object.entries(encounter.encounter.regions).some(([key,r]) => key !== 'bossAggro' && JSON.stringify(r) !== JSON.stringify(region))
                || encounter.passages.some(p => p.fightState === 'stone'))
                throw new Error('Regole personalizzate non rappresentabili nella bozza: usa il file bozza originale.');
            const aggro = encounter.encounter.regions.bossAggro;
            if (aggro.kind === 'circle' ? aggro.center.x !== encounter.spawnPoints.boss.x || aggro.center.y !== encounter.spawnPoints.boss.y
                : JSON.stringify(aggro) !== JSON.stringify(region)) throw new Error('Aggro non centrato sul boss: usa la bozza originale.');
            const xs = [...new Set(region.points.map(p => p.x))].sort((a, b) => a - b), ys = [...new Set(region.points.map(p => p.y))].sort((a, b) => a - b);
            if (xs.length !== 2 || ys.length !== 2 || [...xs, ...ys].some(n => n % TILE_SIZE !== 0)
                || xs[0] < bounds.minTx * TILE_SIZE || xs[1] > (bounds.maxTx + 1) * TILE_SIZE || ys[0] < bounds.minTy * TILE_SIZE || ys[1] > (bounds.maxTy + 1) * TILE_SIZE)
                throw new Error('Regione non rettangolare o fuori dai limiti della mappa.');
            for (const point of [encounter.spawnPoints.boss, ...encounter.spawnPoints.party, ...(encounter.encounter.activationPoints ?? []), ...(encounter.npcSpawns ?? [])]) {
                if ((point.x - TILE_SIZE / 2) % TILE_SIZE || (point.y - TILE_SIZE / 2) % TILE_SIZE)
                    throw new Error('Spawn non allineati alla griglia: usa la bozza originale.');
            }
        }
        const draft = draftFromDungeon(definition);
        for (const [index, entity] of draft.entities.filter(e => e.kind === 'boss').entries()) {
            const placement = value.bosses.find((b: any) => b.id === encounters[index].bossId);
            if (!placement)
                throw new Error(`Modello boss mancante: ${entity.template}.`);
            entity.template = placement.template;
            entity.label = placement.name;
            entity.radius = placement.radius;
        }
        const parsed = parseDungeonDraft(JSON.stringify(draft));
        const normalized = compileDungeonDraft(parsed).definition;
        const warnings = ['Esportazione runtime riconosciuta e recuperata come bozza; posizione derivata dai tile della mappa.'];
        if (definition.area.x !== normalized.area.x || definition.area.y !== normalized.area.y || definition.area.radius !== normalized.area.radius) {
            warnings.push(`area non coerente con il terreno: centro ricalcolato (${normalized.area.x}, ${normalized.area.y}). Per spostare il dungeon scegli la posizione nel maker; modificare area non sposta terreno e spawn.`);
        }
        return { draft: parsed, warnings };
    }
    catch (error) {
        throw new Error(`Esportazione runtime non importabile: ${error instanceof Error && !(error instanceof TypeError) ? error.message : 'struttura incompleta o campi non validi.'}`);
    }
}
