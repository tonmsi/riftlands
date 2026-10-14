import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDungeonDraft, draftFromDungeon, DraftWorld, newDungeonDraft, parseDungeonDraft, reachableDraftTiles, validateDungeonDraft } from '../shared/dungeon-draft';
import { parseDungeonFile } from '../shared/dungeon-import';
import { relocateDungeon } from '../shared/dungeon-relocation';
import { packDungeonCatalog, unpackDungeonCatalog } from '../shared/dungeon-storage';
import { buildDungeonBundle } from '../shared/dungeon-install';
import { createDungeonPlaytest } from '../client/editors/dungeon/dungeon-playtest';
import { moveWithCollisions } from '../shared/physics';
import { BASE_SURFACE } from '../shared/world-surfaces';
import { studioDraft } from './fixtures/studio-draft';
import { newSurfaceDemoDungeon } from '../shared/dungeon-surface-demo';
import { atDungeonActivation, touchesDungeonFlame } from '../shared/dungeons';
import { planBridge } from '../client/editors/surface-authoring';

function layeredDraft() {
  const draft = studioDraft(); draft.surfaceCells = []; draft.surfaceLinks = [];
  for (let y = 6; y <= 8; y++) for (let x = 4; x <= 16; x++) {
    const bridge = x >= 7 && x <= 13;
    draft.surfaceCells.push({ x, y, surfaceId: bridge ? 'bridge-one' : BASE_SURFACE, elevation: 2, kind: bridge ? 'bridge' : 'ground', material: bridge ? 'wood' : x < 7 ? 'grass' : 'stone', wallMaterial: x < 7 ? 'rock' : 'brick' });
  }
  draft.surfaceLinks = [
    { id: 'stairs', kind: 'stairs', from: { x: 3, y: 7, surfaceId: BASE_SURFACE }, to: { x: 4, y: 7, surfaceId: BASE_SURFACE } },
    { id: 'bridge-left', kind: 'bridge-entry', from: { x: 6, y: 7, surfaceId: BASE_SURFACE }, to: { x: 7, y: 7, surfaceId: 'bridge-one' } },
    { id: 'bridge-right', kind: 'bridge-entry', from: { x: 13, y: 7, surfaceId: 'bridge-one' }, to: { x: 14, y: 7, surfaceId: BASE_SURFACE } },
    { id: 'ramp', kind: 'ramp', from: { x: 16, y: 7, surfaceId: BASE_SURFACE }, to: { x: 17, y: 7, surfaceId: BASE_SURFACE } },
  ];
  draft.entities.push(
    { id: 'under', kind: 'npc', template: 'slime', label: 'Sotto', x: 10, y: 7, radius: 13, level: 1 },
    { id: 'above', kind: 'npc', template: 'slime', label: 'Sopra', x: 10, y: 7, surfaceId: 'bridge-one', elevation: 2, radius: 13, level: 1 },
  );
  return draft;
}

test('dungeon elevation, top and wall materials, bridges and spawn levels survive every storage boundary', () => {
  const draft = layeredDraft(); draft.surfaceCells![0].wallSkin = 'wall-roccia';
  assert.deepEqual(validateDungeonDraft(draft), []);
  assert.deepEqual(parseDungeonDraft(JSON.stringify(draft)), draft);
  const compiled = compileDungeonDraft(draft), restored = parseDungeonFile(JSON.stringify(compiled)).draft;
  assert.deepEqual(restored.surfaceCells, draft.surfaceCells); assert.deepEqual(restored.surfaceLinks, draft.surfaceLinks);
  assert.equal(restored.entities.find(e => e.id === 'above')?.surfaceId, 'bridge-one');
  assert.equal(restored.entities.find(e => e.id === 'above')?.elevation, 2);
  const moved = relocateDungeon(compiled.definition, { x: 400, y: -300 });
  assert.equal(moved.surfaceCells![0].x, 404); assert.equal(moved.surfaceCells![0].y, -294);
  assert.equal(moved.surfaceLinks![0].from.x, 403); assert.equal(moved.surfaceLinks![0].to.x, 404);
  assert.deepEqual(draftFromDungeon(moved).surfaceCells, draft.surfaceCells);
  assert.deepEqual(draftFromDungeon(moved).surfaceLinks, draft.surfaceLinks);
  const bundle = buildDungeonBundle(draft, [], { checkPlacement: false });
  const unpacked = unpackDungeonCatalog(packDungeonCatalog([bundle]))[0];
  assert.deepEqual(unpacked.definition.surfaceCells, bundle.definition.surfaceCells);
  assert.deepEqual(unpacked.draft!.surfaceLinks, draft.surfaceLinks);
});

test('dungeon footbridges at water level validate, compile and cross while flat walls and higher water remain invalid', () => {
  const draft = newDungeonDraft(8, 8); draft.encounters = [];
  draft.tiles.fill('path');
  draft.tiles[4 * draft.width + 2] = 'water'; draft.tiles[4 * draft.width + 3] = 'water';
  draft.entities = [{ id: 'bank-guide', kind: 'npc', template: 'slime', label: 'Guida', x: 1, y: 4, radius: 13, level: 1 }];
  const banks = new DraftWorld(draft);
  const plan = planBridge({ x: 1, y: 4 }, { x: 4, y: 4 }, p => banks.surfaceAt(p.x, p.y, p.surfaceId), { material: 'wood', wallMaterial: 'wood' });
  draft.surfaceCells = plan.cells; draft.surfaceLinks = plan.links;
  assert.deepEqual(validateDungeonDraft(draft), []);
  assert.doesNotThrow(() => compileDungeonDraft(parseDungeonDraft(JSON.stringify(draft))));
  const world = new DraftWorld(draft);
  const deck = moveWithCollisions({ x: 1.5 * 48, y: 4.5 * 48, surfaceId: 'ground', elevation: 0, radius: 13 }, 1, 0, 48, world);
  assert.equal(deck.surfaceId, plan.cells[0].surfaceId); assert.equal(deck.elevation, 0);
  const finish = moveWithCollisions({ ...deck, radius: 13 }, 1, 0, 2 * 48, world);
  assert.equal(finish.surfaceId, 'ground'); assert.ok(Math.abs(finish.x - 4.5 * 48) < 1e-6);
  for (const ground of [
    { material: 'path' as const, elevation: 0 },
    { material: 'rock' as const, elevation: 0, blocked: true },
    { material: 'water' as const, elevation: 1 },
  ]) {
    const obstructed = structuredClone(draft);
    obstructed.surfaceCells!.push({ x: 2, y: 4, surfaceId: 'ground', kind: 'ground', wallMaterial: 'earth', ...ground });
    assert.ok(validateDungeonDraft(obstructed).some(issue => issue.startsWith('Ponte ')), `${ground.material} at height ${ground.elevation} must intersect the deck`);
  }
});

test('reachability follows stairs and bridge access while below-deck traversal stays independent', () => {
  const draft = layeredDraft(), from = draft.entities[0];
  const reached = reachableDraftTiles(draft, from);
  assert.ok(reached.has('10,7@ground')); assert.ok(reached.has('10,7@bridge-one'));
  const connectedWorld = new DraftWorld(draft);
  const crossing = moveWithCollisions({ x: 3.5 * 48, y: 7.5 * 48, radius: 13 }, 1, 0, 14 * 48, connectedWorld);
  assert.ok(Math.abs(crossing.x - 17.5 * 48) < 1e-6); assert.equal(crossing.surfaceId ?? BASE_SURFACE, BASE_SURFACE); assert.equal(crossing.elevation ?? 0, 0);
  draft.surfaceLinks = [];
  const disconnected = reachableDraftTiles(draft, from);
  assert.ok(disconnected.has('10,7@ground')); assert.equal(disconnected.has('10,7@bridge-one'), false);
  assert.ok(validateDungeonDraft(draft).some(issue => issue.startsWith('Sopra: non raggiungibile')));
  const world = new DraftWorld(draft);
  const below = moveWithCollisions({ x: 9.5 * 48, y: 7.5 * 48, radius: 13 }, 1, 0, 48, world);
  assert.ok(Math.abs(below.x - 10.5 * 48) < 1e-6); assert.equal(below.surfaceId ?? BASE_SURFACE, BASE_SURFACE); assert.equal(below.elevation ?? 0, 0);
  const above = moveWithCollisions({ x: 9.5 * 48, y: 7.5 * 48, surfaceId: 'bridge-one', elevation: 2, radius: 13 }, 1, 0, 48, world);
  assert.ok(Math.abs(above.x - 10.5 * 48) < 1e-6); assert.equal(above.surfaceId, 'bridge-one'); assert.equal(above.elevation, 2);
  draft.tiles[7 * draft.width + 10] = 'water';
  assert.ok(validateDungeonDraft(draft).some(issue => issue.startsWith('Sotto: ingombro')));
  assert.equal(validateDungeonDraft(draft).some(issue => issue.startsWith('Sopra: ingombro')), false);
});

test('local dungeon playtest carries above and below NPC surfaces into the real simulation', () => {
  const preview = createDungeonPlaytest(layeredDraft());
  const above = preview.simulation.npcs.get('above')!;
  const below = preview.simulation.npcs.get('under')!;
  assert.ok(above && below); assert.equal(above.surfaceId, 'bridge-one'); assert.equal(above.elevation, 2);
  assert.equal(preview.world.sameLevel(above, below), false);
  assert.equal(preview.world.surfaceFor(above)?.material, 'wood');
});

test('surface imports reject unbounded height, duplicate layers, invalid material and missing bridge endpoints', () => {
  for (const mutate of [
    (d: ReturnType<typeof layeredDraft>) => { d.surfaceCells![0].elevation = 17; },
    (d: ReturnType<typeof layeredDraft>) => { d.surfaceCells!.push({ ...d.surfaceCells![0] }); },
    (d: ReturnType<typeof layeredDraft>) => { (d.surfaceCells![0] as any).material = 'unknown'; },
    (d: ReturnType<typeof layeredDraft>) => { d.surfaceCells![0].wallSkin = '../wall-roccia'; },
    (d: ReturnType<typeof layeredDraft>) => { d.surfaceLinks![0].to.surfaceId = 'absent'; },
    (d: ReturnType<typeof layeredDraft>) => { d.surfaceLinks![0].to.x += 4; },
  ]) { const draft = layeredDraft(); mutate(draft); assert.throws(() => parseDungeonDraft(JSON.stringify(draft)), /Superfici.*non valide/); }
});

test('the editable demo validates and starts outside with stacked bonuses and no encounters', () => {
  const draft = newSurfaceDemoDungeon(); assert.deepEqual(validateDungeonDraft(draft), []);
  const preview = createDungeonPlaytest(draft);
  assert.equal(preview.simulation.bosses.size, 0);
  assert.equal(preview.definition.surfaceCells!.some(c => c.wallMaterial === 'brick'), true);
  assert.equal(preview.world.sameLevel(preview.simulation.pickups.get('above')!, preview.simulation.pickups.get('below')!), false);
  assert.ok(preview.player.x < preview.definition.layout.bounds.minTx * 48);
});

test('a raised dungeon entrance gets a temporary staging landing at the correct level', () => {
  const draft = studioDraft(); draft.encounters = []; draft.entities = [{ id: 'guide', kind: 'npc', template: 'slime', label: 'Guida', x: 4, y: 4, elevation: 2, level: 1, radius: 13 }];
  draft.surfaceCells = draft.tiles.flatMap((material, i) => material === 'rock' ? [] : [{ x: i % draft.width, y: Math.floor(i / draft.width), surfaceId: BASE_SURFACE, elevation: 2, material, wallMaterial: 'brick' as const, kind: 'ground' as const }]);
  const preview = createDungeonPlaytest(draft);
  assert.equal(preview.world.surfaceFor(preview.player)?.elevation, 2); assert.equal(preview.player.elevation, 2);
  const moved = moveWithCollisions(preview.player, 1, 0, 200, preview.world);
  assert.ok(moved.x > preview.definition.layout.bounds.minTx * 48); assert.equal(moved.elevation, 2);
  assert.equal(preview.definition.surfaceCells!.some(c => c.x < preview.definition.layout.bounds.minTx), false);
});

test('activation markers and flame barriers on a deck do not affect the passage below', () => {
  const draft = layeredDraft(); draft.entities.push(
    { id: 'deck-activation', kind: 'activation', template: '', label: 'Attivazione ponte', x: 8, y: 7, surfaceId: 'bridge-one', elevation: 2, level: 1, radius: 15 },
    { id: 'deck-flame', kind: 'flame', template: '', label: 'Fiamma ponte', x: 9, y: 7, surfaceId: 'bridge-one', elevation: 2, level: 1, radius: 15, span: 1, vertical: false },
  );
  const compiled = compileDungeonDraft(draft), activation = compiled.definition.encounter.activationPoints![0];
  assert.equal(atDungeonActivation(compiled.definition, activation, 15), true);
  assert.equal(atDungeonActivation(compiled.definition, { ...activation, surfaceId: BASE_SURFACE, elevation: 0 }, 15), false);
  const barrier = compiled.definition.passages.find(p => p.id === 'deck-flame')!;
  assert.equal(touchesDungeonFlame(compiled.definition, { ...barrier.position, surfaceId: 'bridge-one', elevation: 2 }, 15), true);
  assert.equal(touchesDungeonFlame(compiled.definition, { ...barrier.position, surfaceId: BASE_SURFACE, elevation: 0 }, 15), false);
  const restored = parseDungeonFile(JSON.stringify(compiled)).draft;
  assert.equal(restored.entities.find(e => e.kind === 'flame')?.surfaceId, 'bridge-one');
  assert.equal(restored.entities.find(e => e.kind === 'flame')?.elevation, 2);
});
