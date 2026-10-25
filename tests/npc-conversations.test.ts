import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTOR_CATALOG, parseActorCatalog } from '../shared/actor-catalog';
import { validNpcConversation, type NpcConversation } from '../shared/npc-conversation-schema';
import { duplicateNpcVariant } from '../shared/npc-variants';
import { npcDialogueId, npcSpeech, resolveNpcDialogue } from '../shared/npc-conversations';
import { WorldSimulation } from '../server/simulation';
import { newWorldDocument } from '../shared/world-schema';
import { World } from '../shared/world';
import { AmbientSpeech, SPEECH_COOLDOWN_MS } from '../client/core/ambient-speech';
import { setNpcContentCatalog } from '../client/core/npc-content';
import { questMapNpcs } from '../shared/quest-areas';

const conversation: NpcConversation = {
  speech: { intro: 'Benvenuto!', lines: [] },
  dialogue: { kind: 'custom', start: 'intro', nodes: {
    intro: { text: 'Che cosa cerchi?', choices: [{ id: 'rumors', label: 'Notizie.', next: 'rumors' }, { id: 'leave', label: 'Niente, grazie.' }] },
    rumors: { text: 'Hanno riaperto la locanda.', choices: [{ id: 'leave', label: 'Grazie.' }] },
  } },
};

test('conversations validate graph edges, limits and text, rejecting quest/reward actions', () => {
  assert.equal(validNpcConversation(conversation), true);
  const catalog = structuredClone(ACTOR_CATALOG), v = duplicateNpcVariant(catalog, 'custom-npc', 'citizen'); v.conversation = structuredClone(conversation);
  assert.deepEqual(parseActorCatalog(catalog).npcVariants?.[0].conversation, conversation);
  for (const change of [
    (c: any) => c.dialogue.nodes.intro.choices[0].next = 'missing',
    (c: any) => c.dialogue.start = 'missing',
    (c: any) => c.dialogue.nodes.intro.text = '',
    (c: any) => c.dialogue.nodes.intro.choices[0].action = { kind: 'give-item', itemId: 'gold' },
    (c: any) => c.dialogue.nodes.intro.rewardQuestId = 'stinking-bait',
    (c: any) => c.speech.intro = 'a'.repeat(401),
    (c: any) => c.dialogue.nodes.intro.choices.push(c.dialogue.nodes.intro.choices[0]),
  ]) { const c = structuredClone(conversation); change(c); assert.equal(validNpcConversation(c), false); }
  const copy = duplicateNpcVariant(catalog, v, 'citizen-copy'); copy.conversation!.speech = null;
  assert.deepEqual(v.conversation, conversation);
});

test('dialogue and bubbles inherit independently and instance overrides can disable or select quests', () => {
  const catalog = structuredClone(ACTOR_CATALOG);
  catalog.npcConversations = { 'old-fisher': structuredClone(conversation) };
  const v = duplicateNpcVariant(catalog, 'old-fisher', 'fisher-copy'); v.conversation = { dialogue: { kind: 'none' } };
  assert.equal(npcSpeech('old-fisher', v.id, catalog)?.intro, 'Benvenuto!');
  assert.equal(npcDialogueId('old-fisher', { variantId: v.id }, catalog), undefined);
  assert.equal(npcDialogueId('old-fisher', undefined, catalog), 'npc:b:old-fisher');
  assert.deepEqual(questMapNpcs([{ id: 'npc', x: 0, y: 0, level: 1, npcKind: 'old-fisher' }], { version: 1, quests: {} }, 100, catalog), []);
  assert.equal(npcDialogueId('old-fisher', { dialogueId: '' }, catalog), undefined);
  assert.equal(npcDialogueId('old-fisher', { dialogueId: 'old-fisher', variantId: v.id }, catalog), 'old-fisher');
  v.conversation = { speech: null, dialogue: { kind: 'existing', id: 'old-fisher' } };
  assert.equal(npcSpeech('old-fisher', v.id, catalog), undefined);
  assert.equal(npcDialogueId('old-fisher', { variantId: v.id }, catalog), 'old-fisher');
  assert.ok(resolveNpcDialogue('old-fisher', catalog)?.nodes);
});

test('custom conversations run on the server, branch, reject forged choices and never create quests or rewards', t => {
  const previous = ACTOR_CATALOG.npcVariants;
  const v = duplicateNpcVariant(ACTOR_CATALOG, 'custom-npc', 'talk-test'); v.name = 'Locandiere'; v.conversation = structuredClone(conversation);
  t.after(() => { ACTOR_CATALOG.npcVariants = previous; delete ACTOR_CATALOG.skins[v.skin]; setNpcContentCatalog(ACTOR_CATALOG); });
  const doc = newWorldDocument();
  for (let y = -10; y < 12; y++) for (let x = -10; x < 12; x++) doc.tiles.push({ x, y, terrain: 'grass', suppressAssets: true });
  doc.npcs = [{ id: 'host', x: 1, y: 0, npcKind: 'custom-npc', level: 1, settings: { variantId: v.id, speed: 0 } }];
  const sim = new WorldSimulation(doc.seed, 1000, undefined, 'world', { world: new World(doc.seed, 16, 'world', doc, []), spawn: { x: 24, y: 24 }, dungeons: [], bosses: new Map() });
  sim.addPlayer({ id: 'viewer', name: 'Viewer', nameLower: 'viewer', salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, gold: 10, friends: [], requests: [], lastSeen: 0 }, 'warrior');
  sim.step(.05);
  const npc = sim.npcs.get('authored:host')!, player = sim.players.get('viewer')!;
  assert.equal(npc.dialogueId, 'npc:v:talk-test');
  const bubbles = new AmbientSpeech(undefined, () => 0);
  assert.equal(bubbles.update(player, [npc], sim.now, true)?.text, 'Benvenuto!');
  bubbles.update({ ...player, x: -500 }, [npc], sim.now + SPEECH_COOLDOWN_MS, true);
  assert.equal(bubbles.update(player, [npc], sim.now + SPEECH_COOLDOWN_MS + 1, true)?.text, 'Benvenuto!');
  sim.interact(player.id, { kind: 'talk', targetId: npc.id });
  let view = sim.interactions.view(player.id, sim.now)!;
  assert.equal(view.text, 'Che cosa cerchi?'); assert.equal(view.choices.length, 2);
  assert.throws(() => sim.interact(player.id, { kind: 'choose', sessionId: view.sessionId, choiceId: 'accept-quest' }));
  sim.interact(player.id, { kind: 'choose', sessionId: view.sessionId, choiceId: 'rumors' });
  view = sim.interactions.view(player.id, sim.now)!; assert.equal(view.text, 'Hanno riaperto la locanda.');
  sim.interact(player.id, { kind: 'choose', sessionId: view.sessionId, choiceId: 'leave' });
  assert.equal(sim.interactions.view(player.id, sim.now), null);
  assert.deepEqual(sim.accounts.get(player.id)!.narrative?.quests, {}); assert.equal(sim.accounts.get(player.id)!.gold, 10);
  assert.equal(sim.snapshotFor(player.id)!.actors.find(a => a.id === npc.id)?.questMarker, undefined);
});
