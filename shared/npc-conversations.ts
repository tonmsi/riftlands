import { ACTOR_CATALOG, type ActorCatalog } from './actor-catalog';
import { AMBIENT_SPEECH } from './ambient-speech';
import { NPC_DEFINITIONS, type NpcTemplateId } from './npcs';
import { DIALOGUE_DEFINITIONS, type DialogueDefinition } from './narrative';
import type { NpcConversation } from './npc-conversation-schema';
import type { NpcSettings } from './npc-settings';
import { npcVariant } from './npc-variants';

export function npcConversation(kind: NpcTemplateId, variantId?: string, catalog = ACTOR_CATALOG): NpcConversation | undefined {
  const base = catalog.npcConversations?.[kind], variant = npcVariant(catalog, kind, variantId)?.conversation;
  return base || variant ? { ...base, ...variant } : undefined;
}
export function npcSpeech(kind: NpcTemplateId, variantId?: string, catalog = ACTOR_CATALOG) {
  const speech = npcConversation(kind, variantId, catalog)?.speech;
  return speech === undefined ? AMBIENT_SPEECH[kind] : speech ?? undefined;
}
export function npcDialogueRing(kind: NpcTemplateId, settings?: NpcSettings, catalog = ACTOR_CATALOG): boolean | undefined {
  return settings?.showDialogueRing ?? npcConversation(kind, settings?.variantId, catalog)?.showDialogueRing;
}
export function npcDialogueId(kind: NpcTemplateId, settings?: NpcSettings, catalog = ACTOR_CATALOG): string | undefined {
  if (settings?.dialogueId !== undefined) return settings.dialogueId || undefined;
  const d = npcConversation(kind, settings?.variantId, catalog)?.dialogue;
  if (!d) return NPC_DEFINITIONS[kind].dialogueId;
  if (d.kind === 'none') return undefined;
  if (d.kind === 'existing') return d.id;
  return npcVariant(catalog, kind, settings?.variantId)?.conversation?.dialogue?.kind === 'custom'
    ? `npc:v:${settings!.variantId}` : `npc:b:${kind}`;
}
export function resolveNpcDialogue(id: string, catalog = ACTOR_CATALOG): (DialogueDefinition & { startNode?: string }) | undefined {
  if (!id.startsWith('npc:')) return DIALOGUE_DEFINITIONS[id];
  const conversation = id.startsWith('npc:v:') ? catalog.npcVariants?.find(v => v.id === id.slice(6))?.conversation
    : id.startsWith('npc:b:') ? catalog.npcConversations?.[id.slice(6) as NpcTemplateId] : undefined;
  const d = conversation?.dialogue;
  return d?.kind === 'custom' ? { id, questId: '', showQuestMarker: false, entries: [], startNode: d.start, nodes: d.nodes } : undefined;
}
