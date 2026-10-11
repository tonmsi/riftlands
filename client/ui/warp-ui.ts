import type { WarpKeyPickup, WarpGateView, WarpKeyItem } from '../../shared/warp-keys';
import { INTERACTION_RANGE } from '../../shared/interactions';
import { warpPosition, atWarp, WARP_FADE_MS } from '../../shared/warps';
import type { World } from '../../shared/world';
import type { Actor } from '../../shared/types';
import type { WorldWarp } from '../../shared/world-schema';
import './warp-ui.css';

export class WarpUI {
  private readonly veil = document.createElement('div');
  private readonly button = document.createElement('button');
  private warp?: WorldWarp;
  private key?: WarpKeyPickup;
  private started = 0;
  private waiting = false;
  private timer?: ReturnType<typeof setTimeout>;
  blocked = false;
  constructor(private readonly enter: (id: string) => void, private readonly collect: (id: string) => void = () => {}) {
    this.veil.className = 'warp-veil'; this.veil.setAttribute('aria-hidden', 'true');
    this.button.className = 'warp-enter'; this.button.hidden = true;
    this.button.onclick = () => this.activate();
    document.body.append(this.veil, this.button);
    window.addEventListener('keydown', event => {
      if (event.code !== 'KeyF' || event.repeat || (!this.warp && !this.key) || this.button.hidden || this.blocked
        || (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); this.activate();
    });
  }
  private activate(): void { if (this.blocked) return; if (this.key) this.collect(this.key.id); else if (this.warp) this.enter(this.warp.id); }
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
  update(world: World, self: Actor | null, warps: readonly WorldWarp[], mapId: string, available: boolean,
    keys: readonly WarpKeyPickup[] = [], gates: readonly WarpGateView[] = [], owned: readonly WarpKeyItem[] = [], now = Date.now()): void {
    this.key = available && self && self.hp > 0 ? keys.filter(key => world.sameRoom(self, key) && Math.hypot(key.x - self.x, key.y - self.y) <= INTERACTION_RANGE)
      .sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y))[0] : undefined;
    this.warp = available && self && self.hp > 0 ? warps.find(w => w.from === mapId && (w.activation === 'interact' || !!w.keyGate) && world.sameRoom(self, warpPosition(w.entry)) && atWarp(self, w)) : undefined;
    this.button.hidden = (!this.warp && !this.key) || this.blocked;
    if (this.key) this.button.textContent = `Raccogli ${this.key.name} · F`;
    else if (this.warp) {
      const gate = this.warp.keyGate, until = gates.find(state => state.id === gate?.id)?.openedUntil ?? 0;
      const seconds = Math.max(0, Math.ceil((until - now) / 1000));
      const status = !gate ? '' : seconds ? ` · Aperta ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
        : owned.some(key => key.id === gate.id) ? ' · Apri con chiave' : ' · Richiede chiave';
      this.button.textContent = `${this.warp.name}${status} · F`;
    } else this.button.textContent = '';
  }
}
