import { setNpcContentCatalog } from '../core/npc-content';
import { ACTOR_CATALOG, parseActorCatalog, type ActorCatalog } from '../../shared/actor-catalog';
import { NPC_DEFINITIONS, type NpcTemplateId } from '../../shared/npcs';
import { npcVariant } from '../../shared/npc-variants';
import type { NpcSettings } from '../../shared/npc-settings';

let catalog = ACTOR_CATALOG;
export const npcEditorCatalog = () => catalog;
export function setNpcEditorCatalog(value: ActorCatalog): void {
  catalog = parseActorCatalog(value); setNpcContentCatalog(catalog); document.dispatchEvent(new Event('npc-catalog-updated'));
}
export async function loadNpcEditorCatalog(): Promise<void> {
  const response = await fetch('/api/actor-catalog', { cache: 'no-store' });
  if (response.ok) setNpcEditorCatalog((await response.json()).catalog);
}
export function npcChoices(): [string, string][] {
  return [...Object.entries(NPC_DEFINITIONS).map(([id, n]): [string, string] => [id, `${n.disposition === 'neutral' ? 'NPC' : 'Mob'} · ${n.name}`]),
    ...(catalog.npcVariants ?? []).map((v): [string, string] => [`variant:${v.id}`, `${v.group ? v.group + ' · ' : ''}${v.name} · da ${NPC_DEFINITIONS[v.base].name}`])];
}
export function npcChoice(kind: NpcTemplateId, settings?: NpcSettings): string {
  return npcVariant(catalog, kind, settings?.variantId) ? `variant:${settings!.variantId}` : kind;
}
export function readNpcChoice(value: string): { kind: NpcTemplateId; variantId?: string } {
  if (value.startsWith('variant:')) {
    const v = catalog.npcVariants?.find(v => v.id === value.slice(8));
    if (!v) throw new Error('Variante NPC non disponibile. Ricarica il catalogo.');
    return { kind: v.base, variantId: v.id };
  }
  if (!Object.hasOwn(NPC_DEFINITIONS, value)) throw new Error('Modello NPC non valido.');
  return { kind: value as NpcTemplateId };
}
export function refreshNpcSelect(select: HTMLSelectElement): void {
  const previous = select.value;
  select.replaceChildren(...npcChoices().map(([id, name]) => new Option(name, id)));
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}
