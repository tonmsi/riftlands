import { NPC_DEFINITIONS, type NpcTemplateId } from '../../shared/npcs';
import { DIALOGUE_DEFINITIONS } from '../../shared/narrative';
import { validNpcSettings, type NpcSettings } from '../../shared/npc-settings';

export function npcPropertiesMarkup(prefix: string): string {
  return `<label>Personaggio / creatura<select id="${prefix}-kind">${Object.entries(NPC_DEFINITIONS).map(([id, npc]) => `<option value="${id}">${npc.disposition === 'neutral' ? 'NPC' : 'Mob'} · ${npc.name}</option>`).join('')}</select></label><label>Nome nel gioco<input id="${prefix}-name" maxlength="80"></label><details class="selection-advanced"><summary>Avanzate · comportamento</summary><label id="${prefix}-dialogue-label">Dialogo<select id="${prefix}-dialogue"><option value="">Nessun dialogo</option>${Object.keys(DIALOGUE_DEFINITIONS).map(id => `<option value="${id}">${id}</option>`).join('')}</select></label>${[['speed','Velocità · unità/s'],['wanderRadius','Raggio di movimento · unità (0 = fermo)'],['aggroRadius','Raggio aggro · unità'],['leashRadius','Distanza massima dall’origine · unità'],['respawnMs','Respawn · millisecondi'],['initialAngle','Direzione iniziale · gradi']].map(([key,label]) => `<label id="${prefix}-${key}-label">${label}<input id="${prefix}-${key}" type="number" min="0" placeholder="Eredita dal modello"></label>`).join('')}<p class="hint">48 unità = una casella. I campi vuoti ereditano il modello; ruolo e missioni dipendono dal dialogo scelto.</p></details>`;
}
export function fillNpcProperties(root: HTMLElement, prefix: string, kind: NpcTemplateId, settings: NpcSettings = {}): void {
  const field = (key: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${prefix}-${key}`)!;
  const spec = NPC_DEFINITIONS[kind]; field('kind').value = kind; field('name').value = settings.name ?? spec.name;
  field('dialogue').value = settings.dialogueId ?? spec.dialogueId ?? '';
  for (const key of ['speed','wanderRadius','aggroRadius','leashRadius','respawnMs','initialAngle'] as const) field(key).value = settings[key] === undefined ? '' : String(settings[key]);
  for (const key of ['aggroRadius','leashRadius','respawnMs']) root.querySelector<HTMLElement>(`#${prefix}-${key}-label`)!.hidden = spec.disposition === 'neutral';
  for (const key of ['dialogue','wanderRadius']) root.querySelector<HTMLElement>(`#${prefix}-${key}-label`)!.hidden = spec.disposition === 'hostile';
}
export function readNpcProperties(root: HTMLElement, prefix: string): { kind: NpcTemplateId; settings: NpcSettings } {
  const value = (key: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${prefix}-${key}`)!.value;
  const kind = value('kind') as NpcTemplateId, settings: NpcSettings = { name: value('name').trim(), dialogueId: value('dialogue') };
  for (const key of ['speed','wanderRadius','aggroRadius','leashRadius','respawnMs','initialAngle'] as const) if (value(key) !== '') settings[key] = Number(value(key));
  if (!validNpcSettings(settings)) throw new Error('Proprietà non valide: usa valori positivi entro i limiti consentiti.');
  return { kind, settings };
}
