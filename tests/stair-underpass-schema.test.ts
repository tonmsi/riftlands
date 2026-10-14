import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/world';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { compactWorldTiles, serializeWorldDocument } from '../shared/world-tiles';
import { planStair } from '../shared/surface-stairs';
import { compileDungeonDraft, draftFromDungeon, newDungeonDraft, parseDungeonDraft, serializeDungeonDraft } from '../shared/dungeon-draft';
import { relocateDungeon } from '../shared/dungeon-relocation';

function fixture(underpass?: boolean) {
  const document = newWorldDocument();
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.surfaceCells = [{ x: 6, y: 5, surfaceId: 'ground', elevation: 3, material: 'grass', wallMaterial: 'rock', kind: 'ground' }];
  const world = new World(document.seed, 16, 'world', document, []);
  const plan = planStair({ x: 2, y: 5, surfaceId: 'ground' }, { x: 6, y: 5, surfaceId: 'ground' },
    (x, y, id) => world.surfaceAt(x, y, id), { id: 'underpass-roundtrip', underpass, cells: document.surfaceCells });
  document.surfaceCells.push(...plan.cells); document.surfaceLinks = plan.links; document.surfaceStairs = [plan.stair];
  const draft = newDungeonDraft(12, 12); draft.id = 'underpass-roundtrip'; draft.encounters = []; draft.tiles.fill('grass');
  draft.surfaceCells = structuredClone(document.surfaceCells); draft.surfaceLinks = structuredClone(document.surfaceLinks); draft.surfaceStairs = structuredClone(document.surfaceStairs);
  return { document, draft, stair: plan.stair };
}

test('solid defaults and explicit suspended flags survive world and dungeon persistence', () => {
  for (const underpass of [undefined, false, true]) {
    const { document, draft, stair } = fixture(underpass);
    assert.equal(stair.underpass, underpass);
    assert.equal(stair.underpass === true, underpass === true, 'saved structures without the flag remain solid');
    const worldRoundtrip = parseWorldDocument(serializeWorldDocument(compactWorldTiles(document)));
    assert.deepEqual(worldRoundtrip.surfaceStairs, [stair]);
    const draftRoundtrip = parseDungeonDraft(serializeDungeonDraft(draft));
    assert.deepEqual(draftRoundtrip.surfaceStairs, [stair], 'dungeon parsing must not strip the underpass flag');
    const installed = compileDungeonDraft(draftRoundtrip).definition;
    const moved = relocateDungeon(installed, { x: 40, y: 60 });
    assert.equal(moved.surfaceStairs![0].underpass, underpass);
    assert.deepEqual(draftFromDungeon(moved).surfaceStairs, [stair]);
  }
});

test('both import formats reject non-boolean underpass values', () => {
  for (const underpass of ['true', 'false', 0, 1, null, {}]) {
    const { document, draft } = fixture();
    Object.assign(document.surfaceStairs![0], { underpass });
    Object.assign(draft.surfaceStairs![0], { underpass });
    assert.throws(() => parseWorldDocument(document), /Scala non valida/);
    assert.throws(() => parseDungeonDraft(JSON.stringify(draft)), /Scala non valida/);
  }
});
