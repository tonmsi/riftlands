import { npcChoices, npcChoice, readNpcChoice, npcEditorCatalog, refreshNpcSelect } from './npc-catalog';
import { npcDisplayName } from '../../shared/npc-variants';
import { NPC_DEFINITIONS, type NpcTemplateId } from '../../shared/npcs';
import { DIALOGUE_DEFINITIONS } from '../../shared/narrative';
import { validNpcSettings, type NpcSettings } from '../../shared/npc-settings';

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function npcPropertiesMarkup(prefix: string): string {
  return `<label>Personaggio / creatura<select id="${prefix}-kind">${npcChoices().map(([id, label]) => `<option value="${id}">${escape(label)}</option>`).join('')}</select></label><label>Nome nel gioco<input id="${prefix}-name" maxlength="80"></label><label>Cerchio dialogo<select id="${prefix}-dialogue-ring"><option value="@inherit">Eredita dal modello NPC</option><option value="true">Mostra</option><option value="false">Nascondi</option></select></label><details class="selection-advanced"><summary>Avanzate · comportamento</summary><label id="${prefix}-dialogue-label">Dialogo<select id="${prefix}-dialogue"><option value="@inherit">Eredita dal modello NPC</option><option value="">Nessun dialogo</option>${Object.keys(DIALOGUE_DEFINITIONS).map(id => `<option value="${id}">${id}</option>`).join('')}</select></label>${[['speed','Velocità · unità/s'],['wanderRadius','Raggio di movimento · unità (0 = fermo)'],['aggroRadius','Raggio aggro · unità'],['leashRadius','Distanza massima dall’origine · unità'],['respawnMs','Respawn · millisecondi'],['initialAngle','Direzione iniziale · gradi']].map(([key,label]) => `<label id="${prefix}-${key}-label">${label}<input id="${prefix}-${key}" type="number" min="0" placeholder="Eredita dal modello"></label>`).join('')}<p class="hint">48 unità = una casella. I campi vuoti ereditano il modello; ruolo e missioni dipendono dal dialogo scelto.</p></details>`;
}
export function fillNpcProperties(root: HTMLElement, prefix: string, kind: NpcTemplateId, settings: NpcSettings = {}): void {
  const field = (key: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${prefix}-${key}`)!;
  refreshNpcSelect(field('kind') as HTMLSelectElement);
  const spec = NPC_DEFINITIONS[kind]; field('kind').value = npcChoice(kind, settings); field('name').value = npcDisplayName(kind, settings, npcEditorCatalog());
  field('dialogue').value = settings.dialogueId ?? '@inherit';
  field('dialogue-ring').value = settings.showDialogueRing === undefined ? '@inherit' : String(settings.showDialogueRing);
  for (const key of ['speed','wanderRadius','aggroRadius','leashRadius','respawnMs','initialAngle'] as const) field(key).value = settings[key] === undefined ? '' : String(settings[key]);
  for (const key of ['aggroRadius','leashRadius','respawnMs']) root.querySelector<HTMLElement>(`#${prefix}-${key}-label`)!.hidden = spec.disposition === 'neutral';
  for (const key of ['dialogue','wanderRadius']) root.querySelector<HTMLElement>(`#${prefix}-${key}-label`)!.hidden = spec.disposition === 'hostile';
}
export function readNpcProperties(root: HTMLElement, prefix: string): { kind: NpcTemplateId; settings: NpcSettings } {
  const value = (key: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${prefix}-${key}`)!.value;
  const { kind, variantId } = readNpcChoice(value('kind')), settings: NpcSettings = { name: value('name').trim(), ...(value('dialogue') !== '@inherit' ? { dialogueId: value('dialogue') } : {}), ...(variantId ? { variantId } : {}) };
  for (const key of ['speed','wanderRadius','aggroRadius','leashRadius','respawnMs','initialAngle'] as const) if (value(key) !== '') settings[key] = Number(value(key));
  if (value('dialogue-ring') !== '@inherit') settings.showDialogueRing = value('dialogue-ring') === 'true';
  if (!validNpcSettings(settings)) throw new Error('Proprietà non valide: usa valori positivi entro i limiti consentiti.');
  return { kind, settings };
}
