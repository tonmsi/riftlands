import { QUEST_DEFINITIONS, type NarrativeProgress } from './narrative';
import type { WorldZone } from './world-schema';

export function activeQuestAreas(zones: readonly WorldZone[], progress?: NarrativeProgress): WorldZone[] {
  return progress ? zones.filter(zone => zone.questId && progress.quests[zone.questId]?.status === 'active'
    && QUEST_DEFINITIONS[zone.questId]?.objective.kind === 'reach-area') : [];
}
