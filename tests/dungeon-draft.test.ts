import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDungeonDraft, draftFromDungeon, DraftWorld, newDungeonDraft, parseDungeonDraft, validateDungeonDraft } from '../shared/dungeon-draft';
import { DUNGEON_DEFINITIONS, dungeonTile, RUINS_DUNGEON, type DungeonDefinition } from '../shared/dungeons';
import { World } from '../shared/world';
import { moveWithCollisions } from '../shared/physics';

function ready() {
  const draft = newDungeonDraft();
  draft.entities = [
    { id: 'party', kind: 'party', template: '', label: 'Ingresso', x: 3, y: 3, level: 1, radius: 15 },
    { id: 'boss', kind: 'boss', template: '', label: 'Boss futuro', x: 18, y: 12, level: 1, radius: 36 },
    { id: 'slime', kind: 'npc', template: 'slime', label: 'Gelatina', x: 10, y: 8, level: 4, radius: 13 },
  ];
  return draft;
}
test('draft roundtrip preserves terrain and placeholder bosses without executable behavior', () => {
  const draft = ready(); draft.tiles[5 * draft.width + 5] = 'mud';
  assert.deepEqual(parseDungeonDraft(JSON.stringify(draft)), draft);
  assert.deepEqual(validateDungeonDraft(draft), []);
  const compiled = compileDungeonDraft(draft);
  assert.equal(compiled.bossTemplate, '');
  assert.equal(compiled.definition.bossId, 'boss:nuovo-dungeon:main');
  assert.equal(dungeonTile(compiled.definition, draft.origin.x + 5, draft.origin.y + 5), 'mud');
});
test('invalid files, dimensions, catalog values and duplicate entity identities fail before import', () => {
  assert.throws(() => newDungeonDraft(100_000, 8));
  assert.throws(() => parseDungeonDraft('null'));
  assert.throws(() => parseDungeonDraft(JSON.stringify({ ...ready(), tiles: ['unknown'] })));
  const draft = ready(); draft.entities[2].template = '__proto__';
  assert.throws(() => parseDungeonDraft(JSON.stringify(draft)));
  draft.entities[2].template = 'slime'; draft.entities[2].id = 'boss';
  assert.throws(() => parseDungeonDraft(JSON.stringify(draft)));
});
test('solid terrain, actor clearance, overlap and disconnected rooms prevent runtime export', () => {
  const draft = ready();
  for (let y = 0; y < draft.height; y++) draft.tiles[y * draft.width + 8] = 'rock';
  assert.ok(validateDungeonDraft(draft).some(issue => issue.includes('non raggiungibile')));
  assert.throws(() => compileDungeonDraft(draft));
  const other = ready(); other.entities[1].x = 1;
  assert.ok(validateDungeonDraft(other).some(issue => issue.includes('ingombro')));
  other.entities[1].x = 3; other.entities[1].y = 3;
  assert.ok(validateDungeonDraft(other).some(issue => issue.includes('sovrapposte')));
});
test('exported tiles and fixed NPC spawns are consumed by the actual world generator', () => {
  const draft = ready(), definition = compileDungeonDraft(draft).definition;
  const catalog = DUNGEON_DEFINITIONS as DungeonDefinition[];
  catalog.push(definition);
  try {
    const world = new World();
    assert.equal(world.getTile(draft.origin.x, draft.origin.y), 'rock');
    const spawn = definition.npcSpawns![0];
    const chunk = world.getChunk(Math.floor(spawn.x / 768), Math.floor(spawn.y / 768));
    assert.ok(chunk.npcs.some(n => n.id === `dungeon:${draft.id}:slime` && n.level === 4 && n.x === spawn.x));
  } finally { catalog.pop(); }
});
test('movement preview uses shared collision integration and catalog geometry can be copied', () => {
  const draft = ready(), world = new DraftWorld(draft);
  const moved = moveWithCollisions({ x: 72, y: 120, radius: 15 }, -1, 0, 500, world);
  assert.ok(moved.x >= 63);
  const imported = draftFromDungeon(RUINS_DUNGEON);
  assert.equal(imported.tiles[0], 'rock');
  assert.equal(imported.entities.filter(e => e.kind === 'boss').length, 1);
  assert.equal(imported.origin.y, -87);
});
