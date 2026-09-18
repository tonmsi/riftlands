import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDungeonDraft, draftFromDungeon, DraftWorld, newDungeonDraft, parseDungeonDraft, validateDungeonDraft } from '../shared/dungeon-draft';
import { DUNGEON_DEFINITIONS, dungeonTile, type DungeonDefinition } from '../shared/dungeons';
import { World } from '../shared/world';
import { moveWithCollisions } from '../shared/physics';
import { parseDungeonFile } from '../shared/dungeon-import';

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
  const imported = draftFromDungeon(compileDungeonDraft(draft).definition);
  assert.equal(imported.tiles[0], 'rock');
  assert.equal(imported.entities.filter(e => e.kind === 'boss').length, 1);
  assert.equal(imported.origin.y, draft.origin.y);
});

test('more than five activation points and per-boss aggro survive draft and runtime round trips', () => {
  const draft = ready();
  draft.entities[1].aggroRadius = 2000; // The circle may exceed the map; runtime intersects it with combat.
  for(let x=2;x<12;x++) draft.entities.push({id:`trigger-${x}`,kind:'activation',template:'',label:'Trigger',x,y:5,level:1,radius:15});
  const compiled = compileDungeonDraft(draft);
  assert.equal(compiled.definition.encounter.activationPoints?.length,10);
  assert.equal(compiled.definition.encounter.regions.bossAggro.kind,'circle');
  const imported = parseDungeonFile(JSON.stringify(compiled)).draft;
  assert.equal(imported.entities.filter(e=>e.kind==='activation').length,10);
  assert.equal(imported.entities.find(e=>e.kind==='boss')?.aggroRadius,2000);
  assert.deepEqual(compileDungeonDraft(imported).definition.encounter,compiled.definition.encounter);
  for(const bad of [-1,0,10001]) {
    draft.entities[1].aggroRadius=bad;
    assert.throws(()=>parseDungeonDraft(JSON.stringify(draft)));
  }
});

test('painted visitor areas preserve the terrain and roundtrip through runtime and draft, with bounded tile coordinates', () => {
  const draft=ready(), before=[...draft.tiles];
  draft.encounters[0].visitorTiles=[{x:2,y:3},{x:3,y:3},{x:2,y:4}];
  const compiled=compileDungeonDraft(draft);
  assert.deepEqual(draft.tiles,before);
  assert.deepEqual(compiled.definition.encounter.visitorTiles,draft.encounters[0].visitorTiles.map(p=>({x:p.x+draft.origin.x,y:p.y+draft.origin.y})));
  const imported=parseDungeonFile(JSON.stringify(compiled)).draft;
  assert.deepEqual(imported.encounters[0].visitorTiles,draft.encounters[0].visitorTiles);
  draft.encounters[0].visitorTiles.push({x:2,y:3});
  assert.throws(()=>parseDungeonDraft(JSON.stringify(draft)));
  draft.encounters[0].visitorTiles=[{x:10000,y:3}];
  assert.throws(()=>parseDungeonDraft(JSON.stringify(draft)));
  draft.encounters[0].visitorTiles=[{x:1,y:3}]; draft.encounters[0].x=2; draft.encounters[0].width-=2;
  assert.ok(validateDungeonDraft(draft).some(issue=>issue.includes('zona visitatori')));
});
