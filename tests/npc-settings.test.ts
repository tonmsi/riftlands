import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldSimulation } from '../server/simulation';
import { newWorldDocument, parseWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { newDungeonDraft, parseDungeonDraft, compileDungeonDraft, draftFromDungeon } from '../shared/dungeon-draft';
import { validNpcSettings } from '../shared/npc-settings';

test('spawn overrides survive world and dungeon authoring roundtrips', () => {
  const settings = { name: 'Custode', speed: 0, aggroRadius: 96, leashRadius: 144, respawnMs: 3000, initialAngle: 90 };
  const document = newWorldDocument(); document.npcs = [{ id: 'guard', npcKind: 'sentinel', level: 3, x: 4, y: 4, settings }];
  assert.deepEqual(parseWorldDocument(document).npcs[0].settings, settings);
  const draft = newDungeonDraft(); draft.entities.push({ id: 'guard', kind: 'npc', template: 'sentinel', label: 'Custode', x: 4, y: 4, level: 3, radius: 19, settings });
  draft.entities.push({ id: 'boss', kind: 'boss', template: '', label: 'Boss', x: 17, y: 12, level: 1, radius: 36 });
  const parsed = parseDungeonDraft(JSON.stringify(draft));
  assert.deepEqual(draftFromDungeon(compileDungeonDraft(parsed).definition).entities.find(e => e.id === 'guard')?.settings, settings);
  assert.equal(validNpcSettings({ speed: -1 }), false); assert.equal(validNpcSettings({ respawnMs: Infinity }), false);
});
test('runtime uses authored name, dialogue, speed and direction rather than modifying the species', () => {
  const document = newWorldDocument();
  for (let y = -10; y < 12; y++) for (let x = -10; x < 12; x++) document.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  document.npcs = [{ id: 'custom', npcKind: 'old-fisher', level: 2, x: 2, y: 2, settings: { name: 'Pescatore della grotta', dialogueId: '', speed: 0, wanderRadius: 0, initialAngle: 90 } }];
  const world = new World(document.seed, 16, 'world', document, []);
  const simulation = new WorldSimulation(document.seed, 1000, undefined, 'world', { world, spawn: { x: 24, y: 24 }, dungeons: [], bosses: new Map() });
  simulation.addPlayer({ id: 'test', name: 'Test', nameLower: 'test', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 }, 'warrior');
  simulation.step(.05);
  const npc = simulation.npcs.get('authored:custom')!;
  assert.equal(npc.name, 'Pescatore della grotta'); assert.equal(npc.dialogueId, undefined); assert.equal(npc.speed, 0); assert.equal(npc.aim, Math.PI / 2);
});
