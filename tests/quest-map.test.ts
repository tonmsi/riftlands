import test from 'node:test';
import assert from 'node:assert/strict';
import { newNarrativeProgress } from '../shared/narrative';
import { questMapNpcs } from '../shared/quest-areas';
import type { WorldNpc } from '../shared/world-schema';

test('quest NPC pins are independent of exploration and follow quest and dialogue conditions', () => {
  const progress = newNarrativeProgress();
  const npcs: WorldNpc[] = [
    {id:'scout',npcKind:'wounded-scout',x:400,y:400,level:1},
    {id:'fisher',npcKind:'old-fisher',x:500,y:500,level:1},
    {id:'platos',npcKind:'platos',x:600,y:600,level:1},
    {id:'disabled',npcKind:'north-scout',x:700,y:700,level:1,settings:{dialogueId:''}},
  ];
  assert.deepEqual(questMapNpcs(npcs, progress, 100).map(p=>[p.npc.id,p.marker]), [['scout','available'],['fisher','available']]);
  progress.quests['stinking-bait']={status:'active',objectives:{}};
  assert.equal(questMapNpcs(npcs,progress,100).find(p=>p.npc.id==='fisher')!.marker,'active');
  progress.flags=['met-platos'];
  progress.quests['stinking-bait']={status:'completed',objectives:{},completedAt:100};
  assert.deepEqual(questMapNpcs(npcs,progress,100),[]);
  assert.deepEqual(questMapNpcs(npcs,progress,300_100).map(p=>p.npc.id),['fisher']);
});
