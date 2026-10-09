import { atWarp, WARP_FADE_MS } from '../../shared/warps';
import type { World } from '../../shared/world';
import type { Actor } from '../../shared/types';
import type { WorldWarp } from '../../shared/world-schema';
import './warp-ui.css';

export class WarpUI {
  private readonly veil = document.createElement('div');
  private readonly button = document.createElement('button');
  private warp?: WorldWarp;
  private started = 0;
  private waiting = false;
  private timer?: ReturnType<typeof setTimeout>;
  blocked = false;
  constructor(private readonly enter: (id: string) => void) {
    this.veil.className = 'warp-veil'; this.veil.setAttribute('aria-hidden', 'true');
    this.button.className = 'warp-enter'; this.button.hidden = true;
    this.button.onclick = () => { if (this.warp && !this.blocked) this.enter(this.warp.id); };
    document.body.append(this.veil, this.button);
    window.addEventListener('keydown', event => {
      if (event.code !== 'KeyF' || event.repeat || !this.warp || this.button.hidden || this.blocked
        || (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault(); this.enter(this.warp.id);
    });
  }
  start(): void {
    clearTimeout(this.timer); this.started = performance.now(); this.blocked = true; this.waiting = true;
    this.veil.classList.add('visible'); this.button.hidden = true;
    this.timer = setTimeout(() => this.cancel(), 12_000);
  }
  arrive(): void {
    if (!this.waiting) return;
    this.waiting = false; clearTimeout(this.timer);
    this.timer = setTimeout(() => this.reveal(), Math.max(0, WARP_FADE_MS - (performance.now() - this.started)) + 60);
  }
  private reveal(): void {
    this.veil.classList.remove('visible');
    this.timer = setTimeout(() => { this.blocked = false; }, WARP_FADE_MS);
  }
  cancel(): void { clearTimeout(this.timer); this.waiting = false; this.veil.classList.remove('visible'); this.blocked = false; this.button.hidden = true; }
  update(world: World, self: Actor | null, warps: readonly WorldWarp[], mapId: string, available: boolean): void {
    this.warp = available && self && self.hp > 0 ? warps.find(w => w.from === mapId && w.activation === 'interact' && atWarp(self, w)) : undefined;
    this.button.hidden = !this.warp || this.blocked;
    this.button.textContent = this.warp ? `${this.warp.name} · F` : '';
  }
}
