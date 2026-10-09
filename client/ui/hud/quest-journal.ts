import { QUEST_DEFINITIONS, newNarrativeProgress, questCompletions, type NarrativeProgress } from '../../../shared/narrative';
import { ITEM_DEFINITIONS, inventoryCount, newInventory, type Inventory } from '../../../shared/items';
import type { PopupManager } from '../popups';
import { drawTransitionOverlay } from '../transition-overlay';

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
  private completion = document.createElement('div');
  private completionCounts: Record<string, number> = {};
  private hasBaseline = false;
  private completionTimer = 0;
  private acceptance = document.createElement('canvas');
  private acceptanceFrame = 0;
  constructor(hud: HTMLElement, private player: HTMLElement, popups: PopupManager) {
    this.panel.className = 'quest-journal glass'; this.panel.id = 'quest-journal'; this.panel.hidden = true;
    this.panel.setAttribute('role', 'region'); this.panel.setAttribute('aria-label', 'Diario delle missioni');
    this.panel.innerHTML = '<header><div><small>IL TUO VIAGGIO</small><strong>Diario delle missioni</strong></div><button type="button" aria-label="Chiudi diario">×</button></header><div class="quest-journal-scroll"><h3>Missioni attive <span data-active-count>0</span></h3><div data-active-quests></div><h3>Missioni completate <span data-completed-count>0</span></h3><div data-completed-quests></div></div>';
    hud.append(this.panel);
    this.acceptance.className = 'quest-acceptance-feedback'; this.acceptance.hidden = true;
    this.acceptance.setAttribute('role', 'status'); this.acceptance.setAttribute('aria-live', 'polite'); hud.append(this.acceptance);
    this.toggle.type = 'button'; this.toggle.className = 'player-journal-toggle'; this.toggle.setAttribute('aria-label', 'Apri missioni e traguardi');
    this.toggle.setAttribute('aria-controls', this.panel.id); this.toggle.setAttribute('aria-expanded', 'false'); this.player.append(this.toggle);
    this.toggle.innerHTML = '<span class="journal-box-hint" aria-hidden="true">▤ DIARIO</span>';
    this.toggle.title = 'Apri il diario delle missioni';
    this.completion.className = 'quest-completion-feedback'; this.completion.hidden = true;
    this.completion.setAttribute('role', 'status'); this.completion.setAttribute('aria-live', 'polite');
    this.completion.setAttribute('aria-atomic', 'true'); this.player.append(this.completion);
    this.toggle.addEventListener('click', () => this.setOpen(this.panel.hidden));
    this.panel.querySelector('button')!.addEventListener('click', () => this.setOpen(false));
    popups.register(this.panel, () => !this.panel.hidden, () => this.setOpen(false), this.toggle);
    this.update();
  }
  private setOpen(open: boolean): void { this.panel.hidden = !open; this.toggle.setAttribute('aria-expanded', String(open)); }
  reset(): void {
    this.narrative = newNarrativeProgress(); this.inventory = newInventory(); this.signature = ''; this.setOpen(false);
    this.resetFeedback(); this.update();
  }
  resetFeedback(): void {
    cancelAnimationFrame(this.acceptanceFrame); this.acceptanceFrame = 0; this.acceptance.hidden = true;
    clearTimeout(this.completionTimer); this.completionTimer = 0; this.completion.hidden = true;
    this.player.classList.remove('quest-completed', 'quest-accepted'); this.hasBaseline = false; this.completionCounts = {};
  }
  private announceAccepted(names: string[]): void {
    cancelAnimationFrame(this.acceptanceFrame);
    this.acceptance.hidden = false; this.acceptance.textContent = `Missione accettata: ${names.join(', ')}`;
    const started = performance.now();
    const draw = (now: number) => {
      const elapsed = now - started;
      if (elapsed >= 4500) { this.acceptance.hidden = true; this.acceptanceFrame = 0; this.player.classList.remove('quest-accepted'); return; }
      this.acceptance.width = this.acceptance.clientWidth; this.acceptance.height = this.acceptance.clientHeight;
      const landscape = this.acceptance.height <= 600 && this.acceptance.width > this.acceptance.height;
      const dialogueTop = this.acceptance.parentElement?.parentElement?.querySelector<HTMLElement>('.npc-dialogue:not([hidden])')?.getBoundingClientRect().top;
      const headingY = Math.max(10, Math.min(35, (dialogueTop ?? 120) - 72));
      drawTransitionOverlay(this.acceptance.getContext('2d')!, this.acceptance.width, this.acceptance.height, {
        heading: 'MISSIONE ACCETTATA', title: names.join(', '), detail: 'Apri il tuo box per consultare il diario',
        opacity: Math.min(1, elapsed / 200, (4500 - elapsed) / 500), veil: 0,
        ...(landscape ? { minY: 0, position: headingY / this.acceptance.height, panelWidth: Math.max(250, this.acceptance.width - 380), scale: .8 } : { position: .22 }),
      });
      this.acceptanceFrame = requestAnimationFrame(draw);
    };
    this.player.classList.add('quest-accepted'); this.acceptanceFrame = requestAnimationFrame(draw);
  }
  update(narrative?: NarrativeProgress, inventory?: Inventory): void {
    if (narrative) {
      const accepted = Object.entries(narrative.quests).filter(([id, q]) => this.hasBaseline && q.status === 'active' && this.narrative.quests[id]?.status !== 'active');
      if (accepted.length) this.announceAccepted(accepted.map(([id]) => QUEST_DEFINITIONS[id]?.name ?? id));
      const counts = Object.fromEntries(Object.entries(narrative.quests).map(([id, q]) => [id, questCompletions(q)]));
      const completed = Object.keys(counts).filter(id => this.hasBaseline && counts[id] > (this.completionCounts[id] ?? 0));
      this.completionCounts = counts; this.hasBaseline = true;
      if (completed.length) {
        const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Apri il diario →';
        open.addEventListener('click', () => this.setOpen(true));
        this.completion.replaceChildren(text('strong', completed.length > 1 ? '✓ Missioni completate!' : '✓ Missione completata!'),
          text('span', completed.map(id => QUEST_DEFINITIONS[id]?.name ?? id).join(', ')), open);
        // Restart the short celebration when another completion arrives before the previous one expires.
        this.completion.hidden = true; this.player.classList.remove('quest-completed');
        void this.player.offsetWidth;
        this.completion.hidden = false; this.player.classList.add('quest-completed');
        clearTimeout(this.completionTimer);
        this.completionTimer = window.setTimeout(() => {
          this.completion.hidden = true; this.player.classList.remove('quest-completed'); this.completionTimer = 0;
        }, 6500);
      }
    }
    if (narrative) this.narrative = narrative; if (inventory) this.inventory = inventory;
    const active = Object.entries(this.narrative.quests).filter(([, quest]) => quest.status === 'active');
    this.player.classList.toggle('has-active-quests', active.length > 0);
    const completedCount = Object.values(this.narrative.quests).filter(quest => questCompletions(quest) > 0).length;
    this.toggle.setAttribute('aria-label', `Apri il diario. Missioni attive: ${active.length}. Completate: ${completedCount}`);
    const signature = JSON.stringify([this.narrative.quests, this.inventory]); if (signature === this.signature) return; this.signature = signature;
    this.panel.querySelector('[data-active-count]')!.textContent = String(active.length);
    this.panel.querySelector('[data-completed-count]')!.textContent = String(completedCount);
    renderCompletedQuests(this.panel.querySelector<HTMLElement>('[data-completed-quests]')!, this.narrative);
    const list = this.panel.querySelector<HTMLElement>('[data-active-quests]')!; list.replaceChildren();
    for (const [id, progress] of active) {
      const quest = QUEST_DEFINITIONS[id]; if (!quest) continue;
      const row = document.createElement('article'); row.className = 'journal-quest'; row.dataset.questId = id;
      if (quest.objective.kind === 'reach-area') {
        row.append(text('strong', quest.name), text('p', quest.objective.description), text('small', 'Zona indicata sulla mappa · Si completa all’arrivo'));
        list.append(row); continue;
      }
      const delivered = progress.objectives[quest.objective.id] ?? 0, collected = inventoryCount(this.inventory, quest.objective.itemId);
      const meter = document.createElement('progress'); meter.max = quest.objective.quantity; meter.value = Math.min(meter.max, delivered + collected);
      meter.setAttribute('aria-label', quest.name);
      row.append(text('strong', quest.name), text('p', ITEM_DEFINITIONS[quest.objective.itemId]?.name ?? 'Oggetti richiesti'), meter,
        text('small', `Nella sacca: ${collected} · Consegnate: ${delivered}/${quest.objective.quantity}`)); list.append(row);
    }
    if (!list.childElementCount) list.append(text('p', 'Nessuna missione attiva.'));
  }
}
