import type { Snapshot } from '../../../shared/types';
import { ITEM_DEFINITIONS, newInventory } from '../../../shared/items';
import type { DialogueView, InteractionCommand } from '../../../shared/interactions';
import { drawItemArt } from './item-art';
import { QuantityStepper } from './quantity-stepper';
import type { PopupManager } from '../popups';
import { InventoryFeedback } from './inventory-feedback';

/** Independent HUD component: snapshot updates never replace a slot during a held pointer. */
export class InteractionUI {
  readonly root = document.createElement('div');
  private inventory = newInventory();
  private dialogue: DialogueView | null = null;
  private panel: HTMLElement;
  private slots: HTMLElement;
  private backpack: HTMLButtonElement;
  private bagOpen = false;
  private alive = true;
  private fishingAvailable = false;
  private feedback: InventoryFeedback;
  private dropPanel: HTMLElement;
  private quantity: QuantityStepper;
  private choiceSignature = '';
  private hold?: { timer: ReturnType<typeof setTimeout>; slot: number; itemId: string; x: number; y: number };
  private suppressClick = false;
  private dropping?: { slot: number; itemId: string };
  private dismissedSession?: string;
  constructor(parent: HTMLElement, private send: (command: InteractionCommand) => void, private notify: (message: string) => void, focusWorld: () => void, popups: PopupManager) {
    window.addEventListener('fishing-art-ready', () => this.slots?.querySelectorAll<HTMLButtonElement>('[data-item-slot]').forEach(button => { delete button.dataset.stack; }));
    this.root.className = 'interaction-ui'; this.root.hidden = true;
    this.root.innerHTML = '<aside class="inventory-panel" aria-label="Inventario"><button type="button" class="backpack-toggle" aria-label="Apri zaino" aria-expanded="false"><canvas width="56" height="56"></canvas><b>1</b></button><div class="inventory-slots" hidden></div><div class="drop-item-panel" role="group" aria-label="Oggetto e quantità da gettare" hidden><strong data-item-name></strong><p data-item-description></p><div class="quantity-stepper"><button type="button" data-quantity-minus aria-label="Diminuisci quantità">−</button><output aria-label="Quantità da gettare" aria-live="polite">0</output><button type="button" data-quantity-plus aria-label="Aumenta quantità">+</button></div><div class="drop-item-actions"><button type="button" data-drop-confirm>Getta</button></div></div></aside><section class="npc-dialogue" role="dialog" aria-label="Conversazione" hidden><div class="npc-portrait" aria-hidden="true"><span>◉</span></div><div class="dialogue-content"><header><strong data-speaker></strong><button type="button" data-dialogue-close aria-label="Chiudi conversazione">×</button></header><div class="dialogue-scroll" tabindex="0"><p data-dialogue-text></p><small class="dialogue-request" hidden></small><div class="dialogue-rewards" hidden></div><div class="vendor-offers" hidden></div></div><div class="dialogue-choices"></div></div></section>';
    parent.append(this.root); this.slots = this.root.querySelector('.inventory-slots')!; this.panel = this.root.querySelector('.npc-dialogue')!;
    this.dropPanel = this.root.querySelector('.drop-item-panel')!; this.quantity = new QuantityStepper(this.dropPanel);
    this.backpack = this.root.querySelector('.backpack-toggle')!;
    this.feedback = new InventoryFeedback(this.backpack, this.slots);
    this.backpack.addEventListener('click', () => this.setBagOpen(!this.bagOpen));
    popups.register(this.root.querySelector('.inventory-panel')!, () => this.bagOpen, () => this.setBagOpen(false), this.backpack);
    document.addEventListener('pointerdown', event => {
      if (this.bagOpen && !(event.target as Element).closest('.inventory-panel')) this.setBagOpen(false);
    }, true);
    // Native top layer prevents HUD stacking contexts (including gold) covering the popover.
    this.dropPanel.setAttribute('popover', 'manual');
    popups.register(this.dropPanel, () => !this.dropPanel.hidden || !!this.hold, () => {
      this.cancelHold(); this.suppressClick = true; this.closeDrop();
    });
    popups.register(this.panel, () => !this.panel.hidden, () => this.closeDialogue());
    window.addEventListener('resize', () => { if (!this.dropPanel.hidden) this.positionDrop(); });
    this.root.querySelector('[data-dialogue-close]')!.addEventListener('click', () => this.closeDialogue());
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
        const item = ITEM_DEFINITIONS[current.itemId];
        this.dropPanel.querySelector('[data-item-name]')!.textContent = item.name;
        this.dropPanel.querySelector('[data-item-description]')!.textContent = item.description;
        this.dropPanel.hidden = false; this.dropPanel.showPopover(); this.positionDrop();
      }, 650) };
    });
    this.slots.addEventListener('pointermove', e => { if (this.hold && Math.hypot(e.clientX - this.hold.x, e.clientY - this.hold.y) > 12) { this.cancelHold(); this.suppressClick = true; } });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) this.slots.addEventListener(event, () => this.cancelHold());
    this.slots.addEventListener('click', e => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-item-slot]'); if (!button) return;
      const slot = Number(button.dataset.itemSlot), stack = this.inventory.slots[slot]; if (!stack) return;
      if (stack.itemId === 'fishing-rod') {
        if (!this.fishingAvailable) { this.notify('Avvicinati a una riva per usare la canna.'); return; }
        this.send({ kind: 'fishing', command: { kind: 'open' } }); this.setBagOpen(false);
      }
      else if (this.dialogue?.request?.itemId === stack.itemId) {
        this.send({ kind: 'use-item', sessionId: this.dialogue.sessionId, slot, itemId: stack.itemId });
      }
      else if (ITEM_DEFINITIONS[stack.itemId].consumable) {
        this.send({ kind: 'consume-item', slot, itemId: stack.itemId });
      }
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
  reset(): void { this.cancelHold(); this.feedback.reset(); this.dialogue = null; this.dismissedSession = undefined; this.panel.hidden = true; this.choiceSignature = ''; this.setBagOpen(false); }
  private setBagOpen(open: boolean): void {
    open = open && this.alive;
    this.bagOpen = open; this.slots.hidden = !open;
    this.backpack.setAttribute('aria-expanded', String(open)); this.backpack.setAttribute('aria-label', `${open ? 'Chiudi' : 'Apri'} zaino, ${this.inventory.capacity} slot`);
    if (!open) { this.cancelHold(); this.closeDrop(); }
  }
  private positionDrop(): void {
    const anchor = (this.slots.querySelector(`[data-item-slot="${this.dropping?.slot}"]`) ?? this.backpack).getBoundingClientRect(), bounds = this.dropPanel.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - bounds.width - 8, anchor.left - bounds.width - 8));
    const top = Math.max(8, Math.min(innerHeight - bounds.height - 8, anchor.top));
    const controls = [...this.root.parentElement!.querySelectorAll('.mobile-joystick,[data-ref=ability-bar]')].map(element => element.getBoundingClientRect());
    const candidates = [{ left, top }, { left, top: 8 }, { left: (innerWidth - bounds.width) / 2, top: 8 }];
    const point = candidates.find(candidate => controls.every(rect => !rect.width || !rect.height || candidate.left + bounds.width <= rect.left || rect.right <= candidate.left || candidate.top + bounds.height <= rect.top || rect.bottom <= candidate.top)) ?? candidates[0];
    this.dropPanel.style.left = `${point.left}px`; this.dropPanel.style.top = `${point.top}px`;
  }
  private closeDrop(): void { this.quantity.cancel(); this.dropPanel.hidePopover(); this.dropPanel.hidden = true; this.dropping = undefined; }
  private closeDialogue(): void {
    if (this.dialogue) { this.dismissedSession = this.dialogue.sessionId; this.send({ kind: 'close', sessionId: this.dialogue.sessionId }); }
    this.dialogue = null; this.choiceSignature = ''; this.panel.hidden = true;
  }
  private cancelHold(): void { if (this.hold) clearTimeout(this.hold.timer); this.hold = undefined; this.slots.querySelectorAll('.is-holding').forEach(button => button.classList.remove('is-holding')); }
  update(snapshot: Snapshot): void {
    this.inventory = snapshot.inventory ?? newInventory();
    this.fishingAvailable = snapshot.fishingAvailable ?? false;
    this.alive = snapshot.self.hp > 0;
    this.backpack.disabled = !this.alive; this.backpack.title = this.alive ? 'Apri lo zaino' : 'Zaino disponibile dopo la rinascita';
    const bagSignature = `${this.inventory.backpackId ?? 'starter'}:${this.inventory.capacity}`;
    if (this.backpack.dataset.bag !== bagSignature) {
      this.backpack.dataset.bag = bagSignature;
      const canvas = this.backpack.querySelector('canvas')!, ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, 56, 56);
      drawItemArt(ctx, this.inventory.backpackId ?? 'backpack-2', 56);
      this.backpack.querySelector('b')!.textContent = String(this.inventory.capacity);
      this.backpack.title = this.inventory.backpackId ? ITEM_DEFINITIONS[this.inventory.backpackId].name : 'Sacca da 1 slot';
      this.backpack.setAttribute('aria-label', `${this.bagOpen ? 'Chiudi' : 'Apri'} zaino, ${this.inventory.capacity} slot`);
    }
    if (snapshot.self.hp <= 0) this.setBagOpen(false);
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
      button.classList.toggle('is-unavailable', stack?.itemId === 'fishing-rod' && !this.fishingAvailable);
    });
    if (this.dropping) { const stack = this.inventory.slots[this.dropping.slot]; if (!stack || stack.itemId !== this.dropping.itemId || snapshot.self.hp <= 0) this.closeDrop(); else this.quantity.set(this.quantity.quantity, stack.quantity); }
    this.feedback.update(`${snapshot.self.id}:${snapshot.self.classId}`, snapshot.inventoryActions ?? []);
    // Ignore a snapshot already in flight when the player dismissed the conversation.
    const dialogue = snapshot.dialogue?.sessionId === this.dismissedSession ? null : snapshot.dialogue ?? null;
    if (!snapshot.dialogue) this.dismissedSession = undefined;
    this.dialogue = dialogue; this.panel.hidden = !dialogue;
    if (!dialogue) { this.choiceSignature = ''; return; }
    const signature = JSON.stringify(dialogue); if (signature === this.choiceSignature) return; this.choiceSignature = signature;
    const scroll = this.panel.querySelector('.dialogue-scroll')!;
    const shopScroll = dialogue.shop && this.panel.dataset.shopTarget === dialogue.targetId ? scroll.scrollTop : 0;
    scroll.scrollTop = 0; this.panel.dataset.shopTarget = dialogue.shop ? dialogue.targetId : '';
    this.panel.querySelector('[data-speaker]')!.textContent = dialogue.speaker; this.panel.querySelector('[data-dialogue-text]')!.textContent = dialogue.text;
    this.panel.classList.toggle('is-shop', !!dialogue.shop);
    const shop = this.panel.querySelector<HTMLElement>('.vendor-offers')!; shop.hidden = !dialogue.shop;
    shop.replaceChildren(...(dialogue.shop ?? []).map(offer => {
      const card = document.createElement('div'); card.className = 'vendor-offer';
      const image = document.createElement('canvas'); image.width = image.height = 48; drawItemArt(image.getContext('2d')!, offer.itemId, 48);
      const name = document.createElement('strong'); name.textContent = offer.unlock === 'world-map' ? 'Mappa del mondo' : ITEM_DEFINITIONS[offer.itemId].name;
      const button = document.createElement('button'); button.type = 'button'; button.dataset.offer = offer.id;
      button.textContent = `${offer.price} gold · Compra`; button.disabled = !!offer.disabledReason;
      const reason = document.createElement('small'); reason.textContent = offer.disabledReason ?? (offer.unlock === 'world-map' ? 'Sblocca la mappa. Non occupa spazio nello zaino.' : ITEM_DEFINITIONS[offer.itemId].description);
      button.onclick = () => { button.disabled = true; this.send({ kind: 'buy-item', sessionId: dialogue.sessionId, offerId: offer.id }); };
      card.append(image, name, reason, button); return card;
    }));
    const rewards = this.panel.querySelector<HTMLElement>('.dialogue-rewards')!; rewards.hidden = !dialogue.rewards?.length && dialogue.rewardGold === undefined;
    rewards.replaceChildren();
    if (!rewards.hidden) {
      const heading = document.createElement('strong'); heading.textContent = 'La tua ricompensa'; rewards.append(heading);
      if (dialogue.rewardGold !== undefined) {
        const gold = document.createElement('span'), image = document.createElement('canvas'); image.width = image.height = 32;
        drawItemArt(image.getContext('2d')!, 'gold', 32); gold.dataset.rewardGold = ''; gold.append(image, `${dialogue.rewardGold} gold ricevuti`); rewards.append(gold);
      }
      if (dialogue.rewards?.length) { const itemLabel = document.createElement('small'); itemLabel.textContent = 'Oggetti della ricompensa · Solo tuoi'; rewards.append(itemLabel); }
      for (const reward of dialogue.rewards ?? []) {
        const chip = document.createElement('span'), image = document.createElement('canvas'); image.width = image.height = 32;
        drawItemArt(image.getContext('2d')!, reward.itemId, 32); chip.append(image, `${ITEM_DEFINITIONS[reward.itemId].name} × ${reward.quantity}`); rewards.append(chip);
      }
    }
    const request = this.panel.querySelector<HTMLElement>('.dialogue-request')!; request.hidden = !dialogue.request;
    request.textContent = dialogue.request ? `${ITEM_DEFINITIONS[dialogue.request.itemId].name} · ancora ${dialogue.request.remaining}` : '';
    this.panel.querySelector('.dialogue-choices')!.replaceChildren(...dialogue.choices.map(choice => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = choice.label; button.dataset.choice = choice.id;
      button.onclick = () => this.send({ kind: 'choose', sessionId: dialogue.sessionId, choiceId: choice.id }); return button;
    }));
    scroll.scrollTop = shopScroll;
  }
}
