import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDungeonDraft, newDungeonDraft } from '../shared/dungeon-draft';
import { parseDungeonFile } from '../shared/dungeon-import';
import { buildDungeonBundle } from '../shared/dungeon-install';
import { dungeonOriginAt, dungeonPlacementIssue } from '../shared/dungeon-placement';
import { STONE_WARDEN } from '../shared/boss-templates';
function ready() {
    const draft = newDungeonDraft();
    draft.entities = [
        { id: 'p', kind: 'party', label: 'Ingresso', template: '', x: 3, y: 3, level: 1, radius: 15 },
        { id: 'b', kind: 'boss', label: 'Custode', template: STONE_WARDEN.id, x: 12, y: 9, level: 1, radius: 28 },
        { id: 'f', kind: 'flame', label: 'Barriera', template: '', x: 5, y: 8, level: 1, radius: 15, span: 3, vertical: true },
    ];
    draft.tiles[3 * draft.width] = 'path';
    return draft;
}
test('both editor exports import into an installable dungeon, with BOM support', () => {
    const draft = ready();
    assert.deepEqual(parseDungeonFile('\uFEFF' + JSON.stringify(draft)).draft, draft);
    const runtime = compileDungeonDraft(draft), recovered = parseDungeonFile(JSON.stringify(runtime));
    const bundle = buildDungeonBundle(recovered.draft, []);
    assert.equal(bundle.bosses[0].skin, STONE_WARDEN.skin);
    assert.equal(bundle.bosses[0].name, 'Custode');
    assert.equal(bundle.bosses[0].radius, 28);
    assert.deepEqual(bundle.definition.layout.tiles, runtime.definition.layout.tiles);
    assert.deepEqual(bundle.definition.spawnPoints, runtime.definition.spawnPoints);
    assert.equal(recovered.draft.entities.find(e => e.kind === 'flame')?.span, 3);
});
test('editing runtime area cannot silently move terrain away from its boss spawns', () => {
    const runtime = compileDungeonDraft(ready());
    runtime.definition.area.x += 2000;
    runtime.definition.area.y += 4000;
    const recovered = parseDungeonFile(JSON.stringify(runtime)), compiled = compileDungeonDraft(recovered.draft);
    assert.equal(recovered.warnings.length, 2);
    assert.deepEqual(compiled.definition.spawnPoints, runtime.definition.spawnPoints);
    assert.deepEqual(compiled.definition.area, { x: 576, y: -6480, radius: 720 });
});
test('bad runtime structures and unsupported mechanics fail with an actionable error', () => {
    assert.throws(() => parseDungeonFile('{'), /JSON non valido/);
    assert.throws(() => parseDungeonFile('{"definition":{}}'), /struttura incompleta/);
    const runtime = compileDungeonDraft(ready());
    runtime.definition.encounter.preparationMs = 12000;
    assert.throws(() => parseDungeonFile(JSON.stringify(runtime)), /Regole personalizzate/);
    runtime.definition.encounter.preparationMs = 5000;
    runtime.bosses[0].template = 'missing';
    assert.throws(() => buildDungeonBundle(parseDungeonFile(JSON.stringify(runtime)).draft, []), /senza comportamento/);
});
test('world selection moves all geometry together and shares installation collision checks', () => {
    const draft = ready(), before = compileDungeonDraft(draft);
    const origin = dungeonOriginAt({ x: 5000, y: -10000 }, draft.width, draft.height);
    assert.equal(dungeonPlacementIssue(origin, draft.width, draft.height, []), undefined);
    const after = compileDungeonDraft({ ...draft, origin });
    const dx = (origin.x - draft.origin.x) * 48, dy = (origin.y - draft.origin.y) * 48;
    assert.equal(after.definition.spawnPoints.boss.x, before.definition.spawnPoints.boss.x + dx);
    assert.equal(after.definition.spawnPoints.boss.y, before.definition.spawnPoints.boss.y + dy);
    assert.equal(after.definition.layout.bounds.minTx, before.definition.layout.bounds.minTx + dx / 48);
    const home = dungeonOriginAt({ x: 0, y: 0 }, draft.width, draft.height);
    assert.match(dungeonPlacementIssue(home, draft.width, draft.height, [])!, /avamposto/);
    assert.throws(() => buildDungeonBundle({ ...draft, origin: home }, []), /avamposto/);
});
