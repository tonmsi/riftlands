import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptQuest, advanceQuest, newNarrativeProgress, questCompletions, questStatus, validNarrativeProgress, QUEST_DEFINITIONS } from '../shared/narrative';

test('one-off completion counts once, rejects duplicate completion and preserves prior accounts', () => {
  const progress = newNarrativeProgress(), quest = { ...QUEST_DEFINITIONS['stinking-bait'], repeatable: false };
  acceptQuest(progress, quest); advanceQuest(progress, quest, 1);
  assert.equal(questCompletions(progress.quests[quest.id]), 0);
  advanceQuest(progress, quest, 2);
  assert.equal(questCompletions(progress.quests[quest.id]), 1);
  assert.throws(() => advanceQuest(progress, quest, 3)); assert.throws(() => acceptQuest(progress, quest));
  assert.equal(progress.revision, 3); assert.ok(validNarrativeProgress(progress));
  const legacy = { version: 1, quests: { [quest.id]: { status: 'completed', objectives: { 'innards-delivered': 3 } } } };
  assert.ok(validNarrativeProgress(legacy)); assert.equal(questCompletions(legacy.quests[quest.id]), 1);
});

test('repeatable missions retain history during subsequent runs and count completed runs only', () => {
  const progress = newNarrativeProgress(), quest = { ...QUEST_DEFINITIONS['stinking-bait'], repeatable: true, repeatAfterMs: undefined };
  for (let i = 0; i < 3; i++) {
    acceptQuest(progress, quest); assert.equal(questCompletions(progress.quests[quest.id]), i);
    assert.deepEqual(progress.quests[quest.id].objectives, {});
    assert.throws(() => acceptQuest(progress, quest)); advanceQuest(progress, quest, 3);
    assert.equal(questCompletions(progress.quests[quest.id]), i + 1);
  }
  const restored = JSON.parse(JSON.stringify(progress)); assert.ok(validNarrativeProgress(restored));
  acceptQuest(restored, quest); assert.equal(questCompletions(restored.quests[quest.id]), 3);
});

test('invalid completion counters and revision cannot enter persisted narrative state', () => {
  for (const count of [-1, .5, Infinity, 1_000_001, '1']) {
    assert.equal(validNarrativeProgress({ version: 1, quests: { quest: { status: 'completed', objectives: {}, completions: count } } }), false);
  }
  for (const revision of [-1, .5, '1']) assert.equal(validNarrativeProgress({ version: 1, quests: {}, revision }), false);
});


test('Nereo unlocks exactly five minutes after completion, including offline time and subsequent runs', () => {
  const quest = QUEST_DEFINITIONS['stinking-bait'], progress = newNarrativeProgress(), start = 1_000_000;
  const cooldown = 5 * 60 * 1000;
  acceptQuest(progress, quest, start); advanceQuest(progress, quest, 1, start);
  assert.equal(questStatus(progress, quest.id, start + cooldown), 'active');
  assert.equal(progress.quests[quest.id].objectives[quest.objective.id], 1);
  advanceQuest(progress, quest, 2, start + cooldown);
  const completed = start + cooldown, restored = JSON.parse(JSON.stringify(progress));
  assert.ok(validNarrativeProgress(restored));
  assert.equal(restored.quests[quest.id].completedAt, completed);
  assert.equal(questStatus(restored, quest.id, completed + cooldown - 1), 'completed');
  assert.throws(() => acceptQuest(restored, quest, completed + cooldown - 1));
  assert.equal(questStatus(restored, quest.id, completed + cooldown), 'available');
  acceptQuest(restored, quest, completed + cooldown);
  assert.deepEqual(restored.quests[quest.id].objectives, {});
  assert.equal(questCompletions(restored.quests[quest.id]), 1);
  advanceQuest(restored, quest, 3, completed + cooldown);
  assert.equal(questCompletions(restored.quests[quest.id]), 2);
  assert.equal(questStatus(restored, quest.id, completed + cooldown + 1), 'completed');
});

test('legacy completions can repeat immediately while preserving history', () => {
  const quest = QUEST_DEFINITIONS['stinking-bait'], progress = newNarrativeProgress();
  progress.quests[quest.id] = { status: 'completed', objectives: { 'innards-delivered': 3 } };
  assert.equal(questStatus(progress, quest.id, 1000), 'available');
  acceptQuest(progress, quest, 1000);
  assert.equal(questCompletions(progress.quests[quest.id]), 1);
  for (const completedAt of [-1, .5, Infinity, '1']) {
    assert.equal(validNarrativeProgress({ version: 1, quests: { quest: { status: 'completed', objectives: {}, completedAt } } }), false);
  }
});
