import type { InventoryAction } from '../../../shared/interactions';
import { ITEM_DEFINITIONS } from '../../../shared/items';
import { drawItemArt } from './item-art';

/** One short badge for confirmed transactions; repeated snapshots never repeat the animation. */
export class InventoryFeedback {
  private key?: string;
  private seen = new Set<string>();
  private timer = 0;
  private badge = document.createElement('div');
  constructor(private backpack: HTMLElement, private slots: HTMLElement) {
    this.badge.className = 'inventory-feedback'; this.badge.hidden = true; this.badge.setAttribute('role', 'status');
    this.badge.innerHTML = '<canvas width="32" height="32"></canvas><strong></strong><span></span>';
    backpack.parentElement!.append(this.badge);
  }
  reset(): void {
    this.key = undefined; this.seen.clear(); clearTimeout(this.timer); this.badge.hidden = true;
    this.badge.getAnimations().forEach(animation => animation.cancel()); this.backpack.getAnimations().forEach(animation => animation.cancel());
  }
  update(key: string, actions: readonly InventoryAction[]): void {
    if (this.key !== key) { this.reset(); this.key = key; actions.forEach(action => this.seen.add(action.id)); return; }
    for (const action of actions) {
      if (this.seen.has(action.id)) continue;
      this.seen.add(action.id); if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!);
      this.show(action);
    }
  }
  private show(action: InventoryAction): void {
    const item = ITEM_DEFINITIONS[action.itemId]; if (!item) return;
    const incoming = action.kind === 'purchase' || action.kind === 'collect';
    const label = action.kind === 'purchase' ? item.backpackSlots ? 'Zaino cambiato' : 'Acquistato' : action.kind === 'consume' ? 'Usato' : action.kind === 'drop' ? 'Gettato' : action.kind === 'deliver' ? 'Consegnato' : 'Raccolto';
    const canvas = this.badge.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 32, 32); drawItemArt(ctx, action.itemId, 32);
    this.badge.querySelector('strong')!.textContent = `${incoming ? '+' : '−'}${action.quantity}`;
    this.badge.querySelector('span')!.textContent = label;
    this.badge.setAttribute('aria-label', `${label}: ${item.name}, ${action.quantity}`);
    this.badge.dataset.actionId = action.id; this.badge.dataset.kind = action.kind;
    this.badge.hidden = false; this.position(); clearTimeout(this.timer);
    this.badge.getAnimations().forEach(animation => animation.cancel()); this.backpack.getAnimations().forEach(animation => animation.cancel());
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.badge.animate([{ opacity: 0, transform: 'translateY(7px) scale(.85)' }, { opacity: 1, transform: 'translateY(0) scale(1.05)', offset: .12 }, { opacity: 1, transform: 'translateY(0) scale(1)', offset: .8 }, { opacity: 0, transform: 'translateY(-8px) scale(.98)' }], { duration: 2100, easing: 'ease-out' });
      this.backpack.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.13) rotate(-4deg)', offset: .35 }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
      const slot = action.slot === undefined ? undefined : this.slots.querySelector<HTMLElement>(`[data-item-slot="${action.slot}"]`);
      slot?.animate([{ boxShadow: 'inset 0 0 0 2px #a8e5cf', filter: 'brightness(1.5)' }, { boxShadow: 'inset 0 0 0 0px transparent', filter: 'brightness(1)' }], { duration: 650, easing: 'ease-out' });
    }
    this.timer = window.setTimeout(() => { this.badge.hidden = true; }, 2100);
  }
  private position(): void {
    const anchor = this.backpack.getBoundingClientRect(), panel = this.backpack.parentElement!.getBoundingClientRect(), bounds = this.badge.getBoundingClientRect();
    const controls = [...document.querySelectorAll('.mobile-joystick,[data-ref=ability-bar]')].map(element => element.getBoundingClientRect());
    const candidates = [{ x: anchor.right - bounds.width, y: panel.bottom + 5 }, { x: panel.left, y: panel.bottom + 5 }, { x: anchor.left - bounds.width - 8, y: anchor.top }].map(point => ({ x: Math.max(8, Math.min(innerWidth - bounds.width - 8, point.x)), y: Math.max(8, Math.min(innerHeight - bounds.height - 8, point.y)) }));
    const point = candidates.find(point => controls.every(rect => !rect.width || !rect.height || point.x + bounds.width <= rect.left || point.x >= rect.right || point.y + bounds.height <= rect.top || point.y >= rect.bottom)) ?? candidates[0];
    this.badge.style.left = `${point.x}px`; this.badge.style.top = `${point.y}px`;
  }
}
