import { QUEST_DEFINITIONS, newNarrativeProgress, questCompletions, type NarrativeProgress } from '../../../shared/narrative';
import { ITEM_DEFINITIONS, inventoryCount, newInventory, type Inventory } from '../../../shared/items';
import type { PopupManager } from '../popups';

const text = (tag: string, value: string) => { const node = document.createElement(tag); node.textContent = value; return node; };

export function renderCompletedQuests(container: HTMLElement, narrative: NarrativeProgress): void {
  container.replaceChildren();
  for (const [id, progress] of Object.entries(narrative.quests)) {
    const count = questCompletions(progress); if (!count) continue;
    const quest = QUEST_DEFINITIONS[id], row = document.createElement('div'); row.className = 'hub-row'; row.dataset.questId = id;
    row.append(text('strong', quest?.name ?? 'Missione archiviata'), text('span', quest?.repeatable || count > 1 ? `Completata ${count} ${count === 1 ? 'volta' : 'volte'}` : 'Completata'));
    container.append(row);
  }
  if (!container.childElementCount) container.append(text('p', 'Non hai ancora completato missioni.'));
}

/** Private progress is retained between sparse updates; inventory advances collection live. */
export class QuestJournalUI {
  private narrative = newNarrativeProgress();
  private inventory = newInventory();
  private signature = '';
  private panel = document.createElement('section');
  private toggle = document.createElement('button');
  constructor(hud: HTMLElement, private player: HTMLElement, popups: PopupManager) {
    this.panel.className = 'quest-journal glass'; this.panel.id = 'quest-journal'; this.panel.hidden = true;
    this.panel.setAttribute('role', 'region'); this.panel.setAttribute('aria-label', 'Il tuo viaggio');
    this.panel.innerHTML = '<header><strong>Il tuo viaggio</strong><button type="button" aria-label="Chiudi diario">×</button></header><div class="quest-journal-scroll"><h3>Missioni attive</h3><div data-active-quests></div><h3>Traguardi in corso</h3><p>Non ci sono traguardi in corso.</p></div>';
    hud.append(this.panel);
    this.toggle.type = 'button'; this.toggle.className = 'player-journal-toggle'; this.toggle.setAttribute('aria-label', 'Apri missioni e traguardi');
    this.toggle.setAttribute('aria-controls', this.panel.id); this.toggle.setAttribute('aria-expanded', 'false'); this.player.append(this.toggle);
    this.toggle.addEventListener('click', () => this.setOpen(this.panel.hidden));
    this.panel.querySelector('button')!.addEventListener('click', () => this.setOpen(false));
    popups.register(this.panel, () => !this.panel.hidden, () => this.setOpen(false), this.toggle);
    this.update();
  }
  private setOpen(open: boolean): void { this.panel.hidden = !open; this.toggle.setAttribute('aria-expanded', String(open)); }
  reset(): void { this.narrative = newNarrativeProgress(); this.inventory = newInventory(); this.signature = ''; this.setOpen(false); this.update(); }
  update(narrative?: NarrativeProgress, inventory?: Inventory): void {
    if (narrative) this.narrative = narrative; if (inventory) this.inventory = inventory;
    const active = Object.entries(this.narrative.quests).filter(([, quest]) => quest.status === 'active');
    this.player.classList.toggle('has-active-quests', active.length > 0);
    this.toggle.setAttribute('aria-label', active.length ? `Missioni attive: ${active.length}. Apri il diario` : 'Apri missioni e traguardi');
    const signature = JSON.stringify([active, this.inventory]); if (signature === this.signature) return; this.signature = signature;
    const list = this.panel.querySelector<HTMLElement>('[data-active-quests]')!; list.replaceChildren();
    for (const [id, progress] of active) {
      const quest = QUEST_DEFINITIONS[id]; if (!quest) continue;
      const row = document.createElement('article'); row.className = 'journal-quest'; row.dataset.questId = id;
      const delivered = progress.objectives[quest.objective.id] ?? 0, collected = inventoryCount(this.inventory, quest.objective.itemId);
      const meter = document.createElement('progress'); meter.max = quest.objective.quantity; meter.value = Math.min(meter.max, delivered + collected);
      meter.setAttribute('aria-label', quest.name);
      row.append(text('strong', quest.name), text('p', ITEM_DEFINITIONS[quest.objective.itemId]?.name ?? 'Oggetti richiesti'), meter,
        text('small', `Nella sacca: ${collected} · Consegnate: ${delivered}/${quest.objective.quantity}`)); list.append(row);
    }
    if (!list.childElementCount) list.append(text('p', 'Nessuna missione attiva.'));
  }
}
