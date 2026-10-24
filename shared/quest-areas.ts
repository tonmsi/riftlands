import { dialogueQuestMarker, QUEST_DEFINITIONS, type NarrativeProgress } from './narrative';
import type { WorldNpc, WorldZone } from './world-schema';
import { NPC_DEFINITIONS } from './npcs';

export function activeQuestAreas(zones: readonly WorldZone[], progress?: NarrativeProgress): WorldZone[] {
  return progress ? zones.filter(zone => zone.questId && progress.quests[zone.questId]?.status === 'active'
    && QUEST_DEFINITIONS[zone.questId]?.objective.kind === 'reach-area') : [];
}

/** Authored positions remain known even when an NPC is outside snapshot range. */
export function questMapNpcs(npcs: readonly WorldNpc[], progress?: NarrativeProgress, now = Date.now()): { npc: WorldNpc; marker: 'available' | 'active' }[] {
  if (!progress) return [];
  return npcs.flatMap(npc => {
    const dialogue = npc.settings?.dialogueId ?? NPC_DEFINITIONS[npc.npcKind].dialogueId;
    const marker = dialogue ? dialogueQuestMarker(progress, dialogue, now) : undefined;
    return marker === 'available' || marker === 'active' ? [{ npc, marker }] : [];
  });
}
