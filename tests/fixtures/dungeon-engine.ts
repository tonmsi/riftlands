import { newDungeonDraft } from '../../shared/dungeon-draft';
import { buildDungeonBundle } from '../../shared/dungeon-install';
import { DUNGEON_DEFINITIONS, DUNGEON_BY_ID, DUNGEON_BY_BOSS_ID, type DungeonDefinition } from '../../shared/dungeons';
import { BOSS_BY_ID, BOSS_DEFINITIONS, type BossDefinition } from '../../shared/bosses';
import { BOSS_TEMPLATES } from '../../shared/boss-templates';
import { WorldSimulation } from '../../server/simulation';
import type { AccountStore } from '../../server/store';

/** Small synthetic map built with the authoring pipeline, with no retired world content. */
export function engineBundle(templateIndex = 0) {
    const draft = newDungeonDraft(24, 18); draft.id = 'engine-test'; draft.origin = { x: 256, y: 256 };
    draft.tiles[3 * draft.width] = 'path';
    draft.entities = [
        { id: 'activation', kind: 'activation', template: '', label: 'Trigger', x: 5, y: 12, radius: 15, level: 1 },
        { id: 'party', kind: 'party', template: '', label: 'Entry', x: 5, y: 10, radius: 15, level: 1 },
        { id: 'boss', kind: 'boss', template: BOSS_TEMPLATES[templateIndex].id, label: 'Test boss', x: 12, y: 8, radius: 28, level: 1 },
        { id: 'fire', kind: 'flame', template: '', label: 'Barrier', x: 2, y: 5, span: 3, vertical: true, radius: 15, level: 1 },
    ];
    return buildDungeonBundle(draft, []);
}
export function registerEngineBundle(bundle = engineBundle()) {
    (DUNGEON_DEFINITIONS as DungeonDefinition[]).push(bundle.definition);
    DUNGEON_BY_ID.set(bundle.definition.id, bundle.definition);
    DUNGEON_BY_BOSS_ID.set(bundle.definition.bossId, bundle.definition);
    BOSS_BY_ID.set(bundle.bosses[0].id, bundle.bosses[0]);
    (BOSS_DEFINITIONS as BossDefinition[]).push(bundle.bosses[0]);
    return () => {
        const index = DUNGEON_DEFINITIONS.indexOf(bundle.definition);
        if (index >= 0) (DUNGEON_DEFINITIONS as DungeonDefinition[]).splice(index, 1);
        DUNGEON_BY_ID.delete(bundle.definition.id); DUNGEON_BY_BOSS_ID.delete(bundle.definition.bossId); BOSS_BY_ID.delete(bundle.bosses[0].id);
        const bossIndex = BOSS_DEFINITIONS.indexOf(bundle.bosses[0]);
        if (bossIndex >= 0) (BOSS_DEFINITIONS as BossDefinition[]).splice(bossIndex, 1);
    };
}
export function engineFixture(store?: AccountStore, templateIndex = 0) {
    const bundle = engineBundle(templateIndex), cleanup = registerEngineBundle(bundle), sim = new WorldSimulation(734291, 1_000_000, store);
    const account = store ? store.register('TestPlayer', 'test-password').account
        : { id: 'test-player', name: 'TestPlayer', nameLower: 'testplayer', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0, gold: 0 };
    const player = sim.addPlayer(account, 'warrior'), encounter = sim.bosses.get(bundle.definition.bossId)!;
    Object.assign(player, bundle.definition.encounter.activationPoints![0], { spawnProtectedUntil: 0 });
    sim.step();
    return { bundle, cleanup, sim, account, player, encounter, boss: encounter.boss };
}
