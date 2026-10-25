import { ACTOR_CATALOG, type ActorCatalog, type ActorVisual, type NpcVariant } from './actor-catalog';
import { NPC_DEFINITIONS, type NpcTemplateId } from './npcs';
import type { NpcSettings } from './npc-settings';

export function npcVariant(catalog: ActorCatalog, kind: NpcTemplateId, id?: string): NpcVariant | undefined {
  return id ? catalog.npcVariants?.find(v => v.id === id && v.base === kind) : undefined;
}
export function npcDisplayName(kind: NpcTemplateId, settings?: NpcSettings, catalog = ACTOR_CATALOG): string {
  return settings?.name || npcVariant(catalog, kind, settings?.variantId)?.name || NPC_DEFINITIONS[kind].name;
}
/** Clone artwork, never alias the source skin. Variants always reference a built-in behavior. */
export function duplicateNpcVariant(catalog: ActorCatalog, source: NpcTemplateId | NpcVariant, id: string, visual?: ActorVisual): NpcVariant {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || Object.hasOwn(NPC_DEFINITIONS, id)
    || catalog.npcVariants?.some(v => v.id === id)) throw new Error('ID NPC già usato o non valido.');
  const base = typeof source === 'string' ? source : source.base;
  const sourceSkin = typeof source === 'string' ? catalog.npcSkins?.[source] : source.skin;
  const original = visual ?? (sourceSkin ? catalog.skins[sourceSkin] : undefined) ?? ACTOR_CATALOG.skins['npc-old-fisher'];
  let skin = `npc-${id}`.slice(0, 64), suffix = 2;
  while (Object.hasOwn(catalog.skins, skin)) skin = `npc-${id}`.slice(0, 58) + `-${suffix++}`;
  const variant: NpcVariant = { id, base, skin, name: `Copia di ${typeof source === 'string' ? NPC_DEFINITIONS[base].name : source.name}`.slice(0, 80), ...(typeof source !== 'string' && source.group ? { group: source.group } : {}) };
  const conversation = typeof source === 'string' ? catalog.npcConversations?.[base] : source.conversation ?? catalog.npcConversations?.[base];
  if (conversation) variant.conversation = structuredClone(conversation);
  catalog.skins[skin] = structuredClone(original);
  (catalog.npcVariants ??= []).push(variant);
  return variant;
}
