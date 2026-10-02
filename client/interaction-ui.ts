import type { Snapshot } from '../shared/types';
import { ITEM_DEFINITIONS, newInventory } from '../shared/items';
import type { DialogueView, InteractionCommand } from '../shared/interactions';
import { drawItemArt } from './item-art';
import { QuantityStepper } from './quantity-stepper';
import type { PopupManager } from './popups';

/** Independent HUD component: snapshot updates never replace a slot during a held pointer. */
export class InteractionUI {
  readonly root = document.createElement('div');
  private inventory = newInventory();
  private dialogue: DialogueView | null = null;
  private panel: HTMLElement;
  private slots: HTMLElement;
  private dropPanel: HTMLElement;
  private quantity: QuantityStepper;
  private choiceSignature = '';
  private hold?: { timer: ReturnType<typeof setTimeout>; slot: number; itemId: string; x: number; y: number };
  private suppressClick = false;
  private dropping?: { slot: number; itemId: string };
  private dismissedSession?: string;
  constructor(parent: HTMLElement, private send: (command: InteractionCommand) => void, private notify: (message: string) => void, focusWorld: () => void, popups: PopupManager) {
    this.root.className = 'interaction-ui'; this.root.hidden = true;
    this.root.innerHTML = '<aside class="inventory-panel" aria-label="Inventario"><div class="inventory-slots"></div><div class="drop-item-panel" role="group" aria-label="Quantità da gettare" hidden><div class="quantity-stepper"><button type="button" data-quantity-minus aria-label="Diminuisci quantità">−</button><output aria-label="Quantità da gettare" aria-live="polite">0</output><button type="button" data-quantity-plus aria-label="Aumenta quantità">+</button></div><div class="drop-item-actions"><button type="button" data-drop-confirm>Getta</button><button type="button" data-drop-cancel>Annulla</button></div></div></aside><section class="npc-dialogue" role="dialog" aria-label="Conversazione" hidden><div class="npc-portrait" aria-hidden="true"><span>◉</span></div><div class="dialogue-content"><header><strong data-speaker></strong><button type="button" data-dialogue-close aria-label="Chiudi conversazione">×</button></header><div class="dialogue-scroll" tabindex="0"><p data-dialogue-text></p><small class="dialogue-request" hidden></small></div><div class="dialogue-choices"></div></div></section>';
    parent.append(this.root); this.slots = this.root.querySelector('.inventory-slots')!; this.panel = this.root.querySelector('.npc-dialogue')!;
    this.dropPanel = this.root.querySelector('.drop-item-panel')!; this.quantity = new QuantityStepper(this.dropPanel);
    // Native top layer prevents HUD stacking contexts (including gold) covering the popover.
    this.dropPanel.setAttribute('popover', 'manual');
    popups.register(this.dropPanel, () => !this.dropPanel.hidden || !!this.hold, () => {
      this.cancelHold(); this.suppressClick = true; this.closeDrop();
    });
    popups.register(this.panel, () => !this.panel.hidden, () => this.closeDialogue());
    window.addEventListener('resize', () => { if (!this.dropPanel.hidden) this.positionDrop(); });
    this.root.querySelector('[data-dialogue-close]')!.addEventListener('click', () => this.closeDialogue());
    this.root.querySelector('[data-drop-cancel]')!.addEventListener('click', () => this.closeDrop());
    this.root.querySelector('[data-drop-confirm]')!.addEventListener('click', () => {
      const dropping = this.dropping, quantity = this.quantity.quantity, stack = dropping ? this.inventory.slots[dropping.slot] : undefined;
      if (!dropping || !stack || stack.itemId !== dropping.itemId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > stack.quantity) { this.notify('Scegli una quantità disponibile.'); return; }
      this.send({ kind: 'drop-item', ...dropping, quantity }); this.closeDrop();
    });
    this.slots.addEventListener('pointerdown', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-item-slot]'); if (!button || e.button !== 0) return;
      const slot = Number(button.dataset.itemSlot), stack = this.inventory.slots[slot]; this.cancelHold(); this.suppressClick = false;
      if (!stack) return;
      button.setPointerCapture(e.pointerId); button.classList.add('is-holding');
      this.hold = { slot, itemId: stack.itemId, x: e.clientX, y: e.clientY, timer: setTimeout(() => {
        const hold = this.hold; this.cancelHold(); this.suppressClick = true;
        const current = hold ? this.inventory.slots[hold.slot] : null;
        if (!hold || !current || current.itemId !== hold.itemId) return;
        this.dropping = { slot: hold.slot, itemId: hold.itemId }; this.quantity.set(current.quantity, current.quantity);
        this.dropPanel.hidden = false; this.dropPanel.showPopover(); this.positionDrop();
      }, 650) };
    });
    this.slots.addEventListener('pointermove', e => { if (this.hold && Math.hypot(e.clientX - this.hold.x, e.clientY - this.hold.y) > 12) { this.cancelHold(); this.suppressClick = true; } });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) this.slots.addEventListener(event, () => this.cancelHold());
    this.slots.addEventListener('click', e => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-item-slot]'); if (!button) return;
      const slot = Number(button.dataset.itemSlot), stack = this.inventory.slots[slot]; if (!stack) return;
      if (this.dialogue?.request?.itemId === stack.itemId) this.send({ kind: 'use-item', sessionId: this.dialogue.sessionId, slot, itemId: stack.itemId });
      else this.notify(`${ITEM_DEFINITIONS[stack.itemId].name} × ${stack.quantity}`);
    });
    this.slots.addEventListener('contextmenu', e => e.preventDefault());
    // Explicit activation supports a second finger while the joystick owns the first.
    const touches = new Map<number, HTMLButtonElement>();
    this.root.addEventListener('pointerdown', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (event.pointerType !== 'touch' || !button || button.disabled || button.closest('.quantity-stepper')) return;
      event.preventDefault(); touches.set(event.pointerId, button); button.setPointerCapture(event.pointerId);
    });
    this.root.addEventListener('pointerup', event => {
      const button = touches.get(event.pointerId); touches.delete(event.pointerId); if (!button) return;
      const rect = button.getBoundingClientRect();
      if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) button.click();
    });
    for (const name of ['pointercancel', 'lostpointercapture']) this.root.addEventListener(name, event => touches.delete((event as PointerEvent).pointerId));
    this.root.addEventListener('click', event => { if ((event as PointerEvent).pointerType === 'touch') { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    this.root.addEventListener('click', event => { if ((event.target as HTMLElement).closest('button')) focusWorld(); });
    const cancelPointers = () => { this.cancelHold(); this.quantity.cancel(); touches.clear(); };
    window.addEventListener('blur', cancelPointers);
    document.addEventListener('visibilitychange', () => { if (document.hidden) cancelPointers(); });
  }
  setVisible(visible: boolean): void { this.root.hidden = !visible; if (!visible) this.reset(); }
  reset(): void { this.cancelHold(); this.dialogue = null; this.dismissedSession = undefined; this.panel.hidden = true; this.choiceSignature = ''; this.closeDrop(); }
  private positionDrop(): void {
    const anchor = this.slots.getBoundingClientRect(), bounds = this.dropPanel.getBoundingClientRect();
    this.dropPanel.style.left = `${Math.max(8, Math.min(innerWidth - bounds.width - 8, anchor.left - bounds.width - 8))}px`;
    this.dropPanel.style.top = `${Math.max(8, Math.min(innerHeight - bounds.height - 8, anchor.top - (this.root.parentElement?.classList.contains('touch-layout') ? 12 : 0)))}px`;
  }
  private closeDrop(): void { this.quantity.cancel(); this.dropPanel.hidePopover(); this.dropPanel.hidden = true; this.dropping = undefined; }
  private closeDialogue(): void {
    if (this.dialogue) { this.dismissedSession = this.dialogue.sessionId; this.send({ kind: 'close', sessionId: this.dialogue.sessionId }); }
    this.dialogue = null; this.choiceSignature = ''; this.panel.hidden = true;
  }
  private cancelHold(): void { if (this.hold) clearTimeout(this.hold.timer); this.hold = undefined; this.slots.querySelectorAll('.is-holding').forEach(button => button.classList.remove('is-holding')); }
  update(snapshot: Snapshot): void {
    this.inventory = snapshot.inventory ?? newInventory();
    if (this.slots.children.length !== this.inventory.capacity) {
      this.cancelHold(); this.slots.replaceChildren(...this.inventory.slots.map((_, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'inventory-slot'; button.dataset.itemSlot = String(index);
        const image = document.createElement('canvas'); image.width = image.height = 56; const count = document.createElement('b'); button.append(image, count); return button;
      }));
    }
    [...this.slots.children].forEach((element, index) => {
      const button = element as HTMLButtonElement, stack = this.inventory.slots[index], signature = JSON.stringify(stack);
      if (button.dataset.stack !== signature) {
        button.dataset.stack = signature; const canvas = button.querySelector('canvas')!, ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, 56, 56);
        if (stack) drawItemArt(ctx, stack.itemId, 56);
        button.querySelector('b')!.textContent = stack ? String(stack.quantity) : ''; button.classList.toggle('is-empty', !stack);
        button.setAttribute('aria-label', stack ? `${ITEM_DEFINITIONS[stack.itemId].name}, ${stack.quantity}` : 'Slot inventario vuoto');
        button.title = stack ? `${ITEM_DEFINITIONS[stack.itemId].name} × ${stack.quantity}` : 'Slot inventario vuoto';
      }
      button.classList.toggle('is-requested', !!stack && snapshot.dialogue?.request?.itemId === stack.itemId);
    });
    if (this.dropping) { const stack = this.inventory.slots[this.dropping.slot]; if (!stack || stack.itemId !== this.dropping.itemId || snapshot.self.hp <= 0) this.closeDrop(); else this.quantity.set(this.quantity.quantity, stack.quantity); }
    // Ignore a snapshot already in flight when the player dismissed the conversation.
    const dialogue = snapshot.dialogue?.sessionId === this.dismissedSession ? null : snapshot.dialogue ?? null;
    if (!snapshot.dialogue) this.dismissedSession = undefined;
    this.dialogue = dialogue; this.panel.hidden = !dialogue;
    if (!dialogue) { this.choiceSignature = ''; return; }
    const signature = JSON.stringify(dialogue); if (signature === this.choiceSignature) return; this.choiceSignature = signature;
    this.panel.querySelector('.dialogue-scroll')!.scrollTop = 0;
    this.panel.querySelector('[data-speaker]')!.textContent = dialogue.speaker; this.panel.querySelector('[data-dialogue-text]')!.textContent = dialogue.text;
    const request = this.panel.querySelector<HTMLElement>('.dialogue-request')!; request.hidden = !dialogue.request;
    request.textContent = dialogue.request ? `${ITEM_DEFINITIONS[dialogue.request.itemId].name} · ancora ${dialogue.request.remaining}` : '';
    this.panel.querySelector('.dialogue-choices')!.replaceChildren(...dialogue.choices.map(choice => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.label; button.dataset.choice = choice.id;
      button.onclick = () => this.send({ kind: 'choose', sessionId: dialogue.sessionId, choiceId: choice.id }); return button;
    }));
  }
}
