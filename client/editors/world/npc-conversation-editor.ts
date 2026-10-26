import type { ActorCatalog, NpcVariant } from '../../../shared/actor-catalog';
import { NPC_DEFINITIONS, type NpcTemplateId } from '../../../shared/npcs';
import { DIALOGUE_DEFINITIONS } from '../../../shared/narrative';
import { VENDOR_DEFINITIONS } from '../../../shared/vendors';
import type { NpcConversation } from '../../../shared/npc-conversation-schema';
import { npcConversation, npcSpeech } from '../../../shared/npc-conversations';
import { duplicateNpcVariant } from '../../../shared/npc-variants';

interface Host {
  catalog(): ActorCatalog; selection(): { kind: NpcTemplateId; variant?: NpcVariant };
  changed(): void; created(id: string): void; report(e: unknown): void;
}
/** Data-only dialogue authoring: each answer links to a node or closes the conversation. */
export function installNpcConversationEditor(dialog: HTMLElement, host: Host) {
  const section = document.createElement('section'); section.className = 'npc-only npc-conversation-editor';
  section.innerHTML = `<details id="npc-new-panel"><summary>＋ Nuovo NPC</summary>
    <label>ID<input id="npc-new-id" maxlength="64" placeholder="es. locandiere"></label>
    <label>Nome<input id="npc-new-name" maxlength="80" placeholder="Nome del personaggio"></label>
    <label>Comportamento di base<select id="npc-new-base"></select></label><button id="npc-new-create" type="button">Crea NPC</button>
    <p>Parte senza fumetti, missioni o dialoghi. Personalizza gli sprite nella scheda, poi salva il catalogo.</p></details>
    <h3>Fumetti automatici</h3><label>Fumetti<select id="npc-speech-mode"><option value="inherit">Eredita dal modello</option><option value="none">Disattivati</option><option value="custom">Personalizzati</option></select></label>
    <div id="npc-speech-fields"><label>Prima frase<textarea id="npc-speech-intro" maxlength="400" rows="3"></textarea></label>
    <label>Frasi successive · una per riga<textarea id="npc-speech-lines" rows="4"></textarea></label></div>
    <h3>Dialogo di interazione</h3><label><input id="npc-dialogue-ring" type="checkbox">Mostra cerchio attorno all’NPC</label><label>Dialogo<select id="npc-dialogue-mode"><option value="inherit">Eredita dal modello</option><option value="none">Nessuno</option><option value="existing">Usa un dialogo esistente</option><option value="custom">Dialogo personalizzato</option></select></label>
    <label id="npc-existing-label">Dialogo esistente<select id="npc-dialogue-existing"></select></label>
    <div id="npc-dialogue-fields"><p>Risposte a scelta senza missioni o ricompense. Ogni risposta porta a un'altra frase oppure chiude il dialogo.</p>
      <label>Frase iniziale<select id="npc-dialogue-start"></select></label><label>Frase da modificare<select id="npc-dialogue-node"></select></label>
      <div class="pair"><button id="npc-node-add" type="button">Aggiungi frase</button><button id="npc-node-delete" type="button">Rimuovi frase</button></div>
      <label>Testo NPC<textarea id="npc-node-text" maxlength="2000" rows="5"></textarea></label>
      <div id="npc-node-choices"></div><button id="npc-choice-add" type="button">Aggiungi risposta</button>
      <details><summary>Prova il dialogo</summary><button id="npc-dialogue-restart" type="button">Ricomincia</button><p id="npc-dialogue-preview-text"></p><div id="npc-dialogue-preview-choices"></div></details>
    </div><p>Le modifiche si applicano a questo modello NPC. Per i personaggi già piazzati scegli “Eredita dal modello NPC” nel campo Dialogo della singola istanza. Premi Salva catalogo NPC per confermare.</p>`;
  dialog.querySelector('.boss-workspace > aside')!.append(section);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => section.querySelector<T>(`#${id}`)!;
  const value = (id: string) => el<HTMLInputElement>(id).value;
  let selectedNode = '', previewNode = '';
  let context = '';
  const config = () => { const s = host.selection(); return npcConversation(s.kind, s.variant?.id, host.catalog()) ?? {}; };
  const edit = (): NpcConversation => {
    const { kind, variant } = host.selection(), catalog = host.catalog();
    if (variant) return variant.conversation ??= structuredClone(catalog.npcConversations?.[kind] ?? {});
    return (catalog.npcConversations ??= {})[kind] ??= {};
  };
  const custom = () => { const d = edit().dialogue; return d?.kind === 'custom' ? d : undefined; };
  function options(select: HTMLSelectElement, list: [string, string][], chosen: string) {
    select.replaceChildren(...list.map(([id, name]) => new Option(name, id))); select.value = chosen;
  }
  function preview() {
    const d = custom(), node = d?.nodes[previewNode];
    el('npc-dialogue-preview-text').textContent = node?.text ?? 'Conversazione conclusa.';
    el('npc-dialogue-preview-choices').replaceChildren(...(node?.choices ?? []).map(choice => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.label;
      button.onclick = () => { previewNode = choice.next ?? ''; preview(); }; return button;
    }));
  }
  function refreshNode() {
    const d = custom(); if (!d) return;
    if (!d.nodes[selectedNode]) selectedNode = d.start;
    const nodes = Object.entries(d.nodes).map(([id, node]): [string, string] => [id, `${id} · ${node.text.slice(0, 40) || 'Nuova frase'}`]);
    options(el<HTMLSelectElement>('npc-dialogue-start'), nodes, d.start);
    options(el<HTMLSelectElement>('npc-dialogue-node'), nodes, selectedNode);
    el<HTMLTextAreaElement>('npc-node-text').value = d.nodes[selectedNode].text;
    el<HTMLButtonElement>('npc-node-delete').disabled = nodes.length <= 1;
    el<HTMLButtonElement>('npc-node-add').disabled = nodes.length >= 64;
    const choices = d.nodes[selectedNode].choices;
    el<HTMLButtonElement>('npc-choice-add').disabled = choices.length >= 8;
    el('npc-node-choices').replaceChildren(...choices.map(choice => {
      const row = document.createElement('div'); row.className = 'npc-choice-row';
      const label = document.createElement('label'); label.textContent = 'Risposta del giocatore';
      const input = document.createElement('input'); input.maxLength = 160; input.value = choice.label; input.dataset.choiceLabel = choice.id;
      input.oninput = () => { choice.label = input.value; host.changed(); preview(); }; label.append(input);
      const destination = document.createElement('label'); destination.textContent = 'Poi';
      const select = document.createElement('select'); select.dataset.choiceNext = choice.id;
      options(select, [['', 'Chiudi dialogo'], ...nodes], choice.next ?? '');
      select.onchange = () => { if (select.value) choice.next = select.value; else delete choice.next; host.changed(); preview(); }; destination.append(select);
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Rimuovi risposta'; remove.disabled = choices.length <= 1;
      remove.onclick = () => { d.nodes[selectedNode].choices = choices.filter(c => c !== choice); host.changed(); refreshNode(); };
      row.append(label, destination, remove); return row;
    }));
    preview();
  }
  function refresh() {
    const { kind, variant } = host.selection(), key = variant?.id ?? kind;
    if (context !== key) { context = key; selectedNode = ''; previewNode = ''; }
    const c = config();
    el<HTMLInputElement>('npc-dialogue-ring').checked = c.showDialogueRing !== false;
    el<HTMLSelectElement>('npc-speech-mode').value = c.speech === undefined ? 'inherit' : c.speech === null ? 'none' : 'custom';
    el('npc-speech-fields').hidden = !c.speech;
    el<HTMLTextAreaElement>('npc-speech-intro').value = c.speech?.intro ?? '';
    el<HTMLTextAreaElement>('npc-speech-lines').value = c.speech?.lines.join('\n') ?? '';
    const d = c.dialogue;
    el<HTMLSelectElement>('npc-dialogue-mode').value = d?.kind ?? 'inherit';
    el('npc-existing-label').hidden = d?.kind !== 'existing'; el('npc-dialogue-fields').hidden = d?.kind !== 'custom';
    if (d?.kind === 'existing') el<HTMLSelectElement>('npc-dialogue-existing').value = d.id;
    if (d?.kind === 'custom') { if (!previewNode) previewNode = d.start; refreshNode(); }
  }
  options(el<HTMLSelectElement>('npc-new-base'), Object.entries(NPC_DEFINITIONS).map(([id, n]) => [id, n.name]), 'custom-npc');
  options(el<HTMLSelectElement>('npc-dialogue-existing'), [...new Set([...Object.keys(DIALOGUE_DEFINITIONS), ...Object.keys(VENDOR_DEFINITIONS)])].map(id => [id, id]), '');
  el('npc-new-create').onclick = () => {
    try {
      const name = value('npc-new-name').trim(); if (!name) throw new Error('Inserisci il nome del nuovo NPC.');
      const v = duplicateNpcVariant(host.catalog(), value('npc-new-base') as NpcTemplateId, value('npc-new-id').trim());
      v.name = name; v.conversation = { speech: null, dialogue: { kind: 'none' } };
      host.created(v.id);
    } catch (e) { host.report(e); }
  };
  el('npc-dialogue-ring').onchange = () => { edit().showDialogueRing = el<HTMLInputElement>('npc-dialogue-ring').checked; host.changed(); };
  el('npc-speech-mode').onchange = () => {
    const mode = value('npc-speech-mode'), { kind, variant } = host.selection();
    const inherited = npcSpeech(kind, variant?.id, host.catalog());
    if (mode === 'inherit') delete edit().speech;
    else edit().speech = mode === 'none' ? null : structuredClone(inherited ?? { intro: 'Ciao, viaggiatore.', lines: [] });
    host.changed(); refresh();
  };
  const speechInput = () => { edit().speech = { intro: value('npc-speech-intro'), lines: value('npc-speech-lines').split('\n').map(s => s.trim()).filter(Boolean) }; host.changed(); };
  el('npc-speech-intro').oninput = speechInput; el('npc-speech-lines').oninput = speechInput;
  el('npc-dialogue-mode').onchange = () => {
    const mode = value('npc-dialogue-mode');
    if (mode === 'inherit') delete edit().dialogue;
    else edit().dialogue = mode === 'custom' ? { kind: 'custom', start: 'intro', nodes: { intro: { text: 'Ciao, viaggiatore.', choices: [{ id: 'leave', label: 'A presto.' }] } } }
      : mode === 'none' ? { kind: 'none' } : { kind: 'existing', id: Object.keys(DIALOGUE_DEFINITIONS)[0] };
    selectedNode = ''; previewNode = ''; host.changed(); refresh();
  };
  el('npc-dialogue-existing').onchange = () => { edit().dialogue = { kind: 'existing', id: value('npc-dialogue-existing') }; host.changed(); };
  el('npc-dialogue-node').onchange = () => { selectedNode = value('npc-dialogue-node'); refreshNode(); };
  el('npc-dialogue-start').onchange = () => { const d = custom(); if (d) { d.start = value('npc-dialogue-start'); previewNode = d.start; host.changed(); refreshNode(); } };
  el('npc-node-text').oninput = () => { const d = custom(); if (d) { d.nodes[selectedNode].text = value('npc-node-text'); host.changed(); preview(); } };
  el('npc-node-add').onclick = () => {
    const d = custom(); if (!d || Object.keys(d.nodes).length >= 64) return;
    let i = 1; while (Object.hasOwn(d.nodes, `frase-${i}`)) i++;
    selectedNode = `frase-${i}`; d.nodes[selectedNode] = { text: '', choices: [{ id: 'leave', label: 'A presto.' }] }; host.changed(); refreshNode();
  };
  el('npc-node-delete').onclick = () => {
    const d = custom(); if (!d || Object.keys(d.nodes).length <= 1) return;
    const removed = selectedNode; delete d.nodes[removed]; if (d.start === removed) d.start = Object.keys(d.nodes)[0];
    for (const n of Object.values(d.nodes)) for (const c of n.choices) if (c.next === removed) delete c.next;
    selectedNode = d.start; previewNode = d.start; host.changed(); refreshNode();
  };
  el('npc-choice-add').onclick = () => {
    const d = custom(); if (!d) return; const choices = d.nodes[selectedNode].choices; if (choices.length >= 8) return;
    let i = 1; while (choices.some(c => c.id === `risposta-${i}`)) i++;
    choices.push({ id: `risposta-${i}`, label: 'Nuova risposta' }); host.changed(); refreshNode();
  };
  el('npc-dialogue-restart').onclick = () => { previewNode = custom()?.start ?? ''; preview(); };
  return { refresh };
}
