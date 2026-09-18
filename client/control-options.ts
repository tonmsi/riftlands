import { activeActions, assignBinding, bindingLabel, changeMovement, CONTROL_LABELS, defaultControls, type ControlAction, type ControlSettings } from './controls';

export class ControlOptions {
  private readonly dialog = document.createElement('dialog');
  private readonly rows = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly mode = document.createElement('select');
  private draft = defaultControls();
  private capturing: { action: ControlAction; index: number } | null = null;
  constructor(root: HTMLElement, private allowed: () => boolean, private save: (settings: ControlSettings) => void) {
    this.dialog.className = 'control-options';
    this.dialog.setAttribute('aria-labelledby', 'control-options-title');
    this.dialog.innerHTML = `<div class="options-heading"><div><span class="eyebrow">OPZIONI</span><h2 id="control-options-title">Controlli</h2></div><button type="button" data-close aria-label="Chiudi opzioni">×</button></div><p>Personalizza i comandi prima di entrare. Durante la partita, torna al menu principale per modificarli.</p>`;
    const label = document.createElement('label'); label.className = 'movement-option'; label.textContent = 'Movimento';
    this.mode.setAttribute('aria-label', 'Modalità di movimento');
    this.mode.innerHTML = '<option value="keyboard">Tastiera</option><option value="mouse">Segui il cursore</option>';
    label.append(this.mode);
    this.rows.className = 'binding-rows';
    this.status.className = 'options-status'; this.status.setAttribute('role', 'status');
    const hint = document.createElement('p'); hint.className = 'options-help';
    hint.textContent = 'Clicca un comando e premi il nuovo tasto, oppure il mouse destro o centrale. Esc annulla, Canc rimuove il comando alternativo. Il clic sinistro seleziona un personaggio; tenendolo premuto attivi la mira manuale con anteprima. Senza mira, attacchi il nemico visibile più vicino. Il movimento col mouse richiede di tenere premuto il comando e si ferma agli ostacoli.';
    const footer = document.createElement('div'); footer.className = 'options-footer';
    footer.innerHTML = '<button type="button" data-reset>Ripristina predefiniti</button><button type="button" data-cancel>Annulla</button><button type="button" data-save>Salva controlli</button>';
    this.dialog.append(label, hint, this.rows, this.status, footer); root.append(this.dialog);
    this.dialog.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    footer.querySelector('[data-cancel]')!.addEventListener('click', () => this.close());
    footer.querySelector('[data-reset]')!.addEventListener('click', () => {
      this.draft = defaultControls(); this.capturing = null; this.render(); this.status.textContent = 'Predefiniti ripristinati. Premi Salva controlli per applicarli.';
    });
    footer.querySelector('[data-save]')!.addEventListener('click', () => {
      if (!this.allowed()) return this.close();
      this.save(structuredClone(this.draft)); this.close();
    });
    this.mode.addEventListener('change', () => {
      changeMovement(this.draft, this.mode.value as ControlSettings['movement']); this.capturing = null; this.render();
      this.status.textContent = 'Modalità aggiornata. I comandi di attacco in conflitto con il movimento sono stati riassegnati: verifica le associazioni.';
    });
    this.dialog.addEventListener('cancel', event => { if (this.capturing) { event.preventDefault(); this.capturing = null; this.render(); } });
    this.dialog.addEventListener('keydown', event => {
      if (!this.capturing) return;
      event.preventDefault(); event.stopPropagation();
      if (event.code === 'Escape') { this.capturing = null; this.render(); return; }
      if (event.code === 'Delete' && this.capturing.index === 1) {
        this.draft.bindings[this.capturing.action].splice(1); this.capturing = null; this.render(); return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      this.capture(event.code);
    });
    this.dialog.addEventListener('pointerdown', event => {
      if (!this.capturing || event.pointerType !== 'mouse' || ![1, 2].includes(event.button)) return;
      event.preventDefault(); this.capture(`Mouse${event.button}`);
    });
    this.dialog.addEventListener('contextmenu', event => event.preventDefault());
    this.dialog.addEventListener('close', () => { this.capturing = null; });
  }
  open(settings: ControlSettings): void {
    if (!this.allowed() || this.dialog.open) return;
    this.draft = structuredClone(settings); this.capturing = null; this.render(); this.dialog.showModal();
  }
  close(): void { this.capturing = null; this.dialog.close(); }
  private capture(code: string): void {
    if (!this.capturing || !this.allowed()) return;
    const error = assignBinding(this.draft, this.capturing.action, this.capturing.index, code);
    if (error) { this.status.textContent = error; return; }
    this.capturing = null; this.render(); this.status.textContent = 'Comando aggiornato. Premi Salva controlli per applicarlo.';
  }
  private render(): void {
    const focused = this.dialog.querySelector<HTMLButtonElement>(':focus')?.dataset.binding;
    this.mode.value = this.draft.movement; this.rows.replaceChildren();
    this.status.textContent = this.capturing ? 'Premi il nuovo comando… Esc per annullare.' : 'Due comandi possibili per ogni azione. Le modifiche si applicano al salvataggio.';
    for (const action of activeActions(this.draft)) {
      const row = document.createElement('div'); row.className = 'binding-row';
      const label = document.createElement('span'); label.textContent = CONTROL_LABELS[action]; row.append(label);
      for (let index = 0; index < 2; index++) {
        const button = document.createElement('button'); button.type = 'button';
        const capturing = this.capturing?.action === action && this.capturing.index === index;
        button.dataset.binding = `${action}-${index}`;
        button.textContent = capturing ? 'Premi un tasto…' : this.draft.bindings[action][index] ? bindingLabel(this.draft.bindings[action][index]) : '+ Alternativo';
        button.setAttribute('aria-label', `${CONTROL_LABELS[action]}: ${index ? 'alternativo' : 'principale'}, ${button.textContent}`);
        button.classList.toggle('is-capturing', capturing);
        button.addEventListener('click', () => { this.capturing = { action, index }; this.render(); this.rows.querySelector<HTMLButtonElement>(`[data-binding="${action}-${index}"]`)!.focus(); });
        row.append(button);
      }
      this.rows.append(row);
    }
    if (focused) this.rows.querySelector<HTMLButtonElement>(`[data-binding="${focused}"]`)?.focus();
  }
}
