import { dungeonPlacementIssue } from './dungeon-placement';
import type { BossDefinition } from './bosses';
import { BOSS_TEMPLATE_BY_ID } from './boss-templates';
import { compileDungeonDraft, type DungeonDraft } from './dungeon-draft';
import { DUNGEON_DEFINITIONS, type DungeonDefinition } from './dungeons';
export interface DungeonBundle {
    definition: DungeonDefinition;
    bosses: BossDefinition[];
    draft?: DungeonDraft;
}
/** Resolve authored placements against implemented behavior; never execute imported code. */
export function buildDungeonBundle(draft: DungeonDraft, existing: readonly DungeonDefinition[] = DUNGEON_DEFINITIONS): DungeonBundle {
    const compiled = compileDungeonDraft(draft), definition = compiled.definition;
    const bounds = definition.layout.bounds;
    for (const other of existing) {
        if (other.id === definition.id)
            throw new Error(`ID dungeon già installato: ${definition.id}. Usa un nuovo ID per non invalidare i salvataggi.`);
        const b = other.layout.bounds;
        // Include procedural exclusion/approach space around both maps.
        if (Math.hypot(other.area.x - definition.area.x, other.area.y - definition.area.y) < other.area.radius + definition.area.radius + 192
            || (bounds.minTx <= b.maxTx && bounds.maxTx >= b.minTx && bounds.minTy <= b.maxTy && bounds.maxTy >= b.minTy))
            throw new Error(`Mappa troppo vicina o sovrapposta a ${other.name}: cambia Origine X/Y.`);
    }
    const placementIssue = dungeonPlacementIssue(draft.origin, draft.width, draft.height, existing);
    if (placementIssue) throw new Error(placementIssue);
    const entrance = definition.passages.find(p => p.tiles.some(t => t.x === bounds.minTx || t.x === bounds.maxTx || t.y === bounds.minTy || t.y === bounds.maxTy));
    if (!entrance)
        throw new Error('Apri almeno una casella sul bordo della mappa per accedere dal mondo.');
    const tile = entrance.tiles[0];
    const normal = tile.x === bounds.minTx ? { x: -1, y: 0 } : tile.x === bounds.maxTx ? { x: 1, y: 0 } : tile.y === bounds.minTy ? { x: 0, y: -1 } : { x: 0, y: 1 };
    definition.approach = { from: { x: entrance.position.x + normal.x * 480, y: entrance.position.y + normal.y * 480 }, to: { ...entrance.position }, halfWidth: 48, corridorHalfWidth: 96, waves: [], markers: [] };
    const outside = { x: entrance.position.x + normal.x * 96, y: entrance.position.y + normal.y * 96 };
    definition.encounter.ejectTo = outside;
    for (const encounter of definition.additionalEncounters ?? [])
        encounter.encounter.ejectTo = { ...outside };
    const bosses = compiled.bosses.map(placement => {
        const template = BOSS_TEMPLATE_BY_ID.get(placement.template);
        if (!template)
            throw new Error(`${placement.name}: segnaposto senza comportamento. Seleziona un boss disponibile prima di installare.`);
        const boss: BossDefinition = { ...structuredClone(template), id: placement.id, dungeonId: definition.id,
            templateId: template.templateId ?? template.id, name: placement.name, radius: placement.radius };
        if (boss.behavior.unstuck)
            boss.behavior.unstuck.probeDistance = Math.max(boss.behavior.unstuck.probeDistance, boss.radius + 16);
        return boss;
    });
    return { definition, bosses, draft: structuredClone(draft) };
}
