import type { Snapshot, Vec2 } from '../../shared/types';
import { ITEM_DEFINITIONS } from '../../shared/items';
import type { FishingCommand, FishingView } from '../../shared/fishing/model';
import { nearbyFishingWater, validFishingCast } from '../../shared/fishing/water';
import type { World } from '../../shared/world';
import { drawItemArt } from '../ui/interactions/item-art';
import { CatchFeedback } from './catch-feedback';
import { formatFishingDistance } from '../../shared/fishing/distance';
export class FishingUI {
  readonly root = document.createElement('section');
  private view: FishingView | null = null;
  private snapshot?: Snapshot;
  private point?: Vec2;
  private holding = false;
  private pulse?: ReturnType<typeof setInterval>;
  private pointer?: { id: number; x: number; y: number; phase: string };
  private signature = '';
  private reel: HTMLButtonElement;
  private catches: CatchFeedback;
  private hapticAt = 0;
  constructor(parent: HTMLElement, private world: () => World, private toWorld: (x: number, y: number) => Vec2, private send: (command: FishingCommand) => void) {
    this.root.className = 'fishing-ui'; this.root.hidden = true;
    this.root.innerHTML = '<div class="fishing-status"><span>PESCA DI RIVA</span><strong data-fishing-message></strong><small data-fishing-help></small><button type="button" data-fishing-close aria-label="Esci dalla pesca">×</button></div><div class="fishing-baits"><span>ESCA</span><div data-fishing-baits></div></div><aside class="fishing-meter" hidden><span>TENSIONE</span><div class="fishing-line-meter" role="meter" aria-label="Tensione del filo" aria-valuemin="0" aria-valuemax="100"><i></i></div><strong data-fishing-tension></strong><small data-fishing-danger></small><label>RECUPERO<progress max="1" value="0" aria-label="Recupero del pesce"></progress></label></aside><button type="button" class="fishing-reel" aria-label="Mulinello"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="29" cy="29" r="20"/><circle cx="29" cy="29" r="10"/><path d="M29 9v10m0 20v10M9 29h10m20 0h10M29 29l19 19h7"/><circle cx="55" cy="48" r="4"/></svg><span>LANCIA</span></button>';
    parent.append(this.root); this.reel = this.root.querySelector('.fishing-reel')!;
    this.catches = new CatchFeedback(this.root);
    window.addEventListener('fishing-art-ready', () => { this.signature = ''; });
    this.root.querySelector('[data-fishing-close]')!.addEventListener('click', () => this.close());
    this.reel.addEventListener('pointerdown', e => {
      if (!this.view || this.reel.disabled || this.pointer) return;
      e.preventDefault(); this.reel.setPointerCapture(e.pointerId);
      this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, phase: this.view.phase };
      if (this.view.phase !== 'ready' && this.view.phase !== 'result') this.press();
    });
    this.reel.addEventListener('pointermove', e => {
      const p = this.pointer; if (!p || p.id !== e.pointerId || !this.snapshot || !['ready', 'result'].includes(p.phase)) return;
      const a = this.toWorld(p.x, p.y), b = this.toWorld(e.clientX, e.clientY), dx = b.x - a.x, dy = b.y - a.y;
      if (Math.hypot(dx, dy) < 12) return;
      const length = Math.min(250, Math.max(70, Math.hypot(dx, dy) * 2.5)), angle = Math.atan2(dy, dx);
      this.aim({ x: this.snapshot.self.x + Math.cos(angle) * length, y: this.snapshot.self.y + Math.sin(angle) * length });
    });
    this.reel.addEventListener('pointerup', e => { const p = this.pointer; if (p?.id !== e.pointerId) return; this.pointer = undefined; if (['ready', 'result'].includes(p.phase)) this.press(); this.release(); });
    for (const event of ['pointercancel', 'lostpointercapture']) this.reel.addEventListener(event, () => { this.pointer = undefined; this.release(); });
    window.addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
  }
  get target(): Vec2 | undefined { return this.view && ['ready', 'result'].includes(this.view.phase) ? this.point : undefined; }
  aim(point: Vec2): void { if (this.catches.visible) return; this.point = point; this.refreshHelp(); }
  reset(): void { this.release(); this.catches.reset(); this.view = null; this.snapshot = undefined; this.point = undefined; this.signature = ''; this.hapticAt = 0; this.root.hidden = true; document.documentElement.classList.remove('fishing-active'); }
  update(snapshot: Snapshot): void {
    const previous = this.view; this.snapshot = snapshot; this.view = snapshot.fishing ?? null;
    if (!this.view) { this.reset(); return; }
    if (previous?.id !== this.view.id) this.point = nearbyFishingWater(this.world(), snapshot.self);
    if (!['bite', 'fight'].includes(this.view.phase) && this.holding) this.release();
    this.root.hidden = false; document.documentElement.classList.add('fishing-active'); this.root.dataset.phase = this.view.phase;
    this.root.dataset.reeling = String(this.view.reeling);
    this.root.style.setProperty('--fight-impact', String(.12 + this.view.tension * .2));
    const hapticNow = performance.now();
    if (!document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches && typeof navigator.vibrate === 'function') {
      if (this.view.phase === 'bite' && previous?.phase !== 'bite') { navigator.vibrate([35, 45, 60]); this.hapticAt = hapticNow; }
      else if (this.view.phase === 'fight' && hapticNow - this.hapticAt > (this.view.tension >= .85 ? 450 : 800)) { navigator.vibrate(this.view.tension >= .85 ? 25 : 12); this.hapticAt = hapticNow; }
    }
    this.catches.update(this.view);
    this.root.querySelector('[data-fishing-message]')!.textContent = this.view.message;
    this.reel.querySelector('span')!.textContent = this.view.phase === 'waiting' ? 'RITIRA' : this.view.phase === 'bite' ? 'FERRA!' : this.view.phase === 'fight' ? 'RECUPERA' : 'LANCIA';
    this.reel.setAttribute('aria-label', this.reel.querySelector('span')!.textContent!);
    this.reel.disabled = ['ready', 'result'].includes(this.view.phase) && !this.view.baitId;
    this.reel.classList.toggle('is-reeling', this.view.reeling);
    const meter = this.root.querySelector<HTMLElement>('.fishing-meter')!; meter.hidden = this.view.phase !== 'fight';
    const tension = Math.round(this.view.tension * 100), line = meter.querySelector<HTMLElement>('.fishing-line-meter')!;
    meter.classList.toggle('is-straining', tension >= 80); meter.classList.toggle('is-critical', tension >= 95);
    meter.style.setProperty('--strain', String(1 + this.view.tension * .18));
    line.setAttribute('aria-valuenow', String(tension)); line.style.setProperty('--tension', `${tension}%`); line.classList.toggle('is-danger', tension >= 85);
    meter.querySelector('[data-fishing-tension]')!.textContent = `${tension}%`;
    meter.querySelector('[data-fishing-danger]')!.textContent = this.view.danger > 0 ? 'IL FILO CEDE!' : tension < 55 ? 'TIRA! SI SLAMA' : tension >= 90 ? 'ALLENTA!' : 'Tira e rilascia';
    meter.querySelector('progress')!.value = this.view.progress;
    const signature = JSON.stringify([snapshot.inventory, snapshot.gold, this.view.baitId, this.view.baitSlot, this.view.baitUsesRemaining, this.view.phase]);
    if (signature !== this.signature) {
      this.signature = signature; const list = this.root.querySelector('[data-fishing-baits]')!; list.replaceChildren();
      const options = (snapshot.inventory?.slots ?? []).flatMap((stack, slot) => stack && ITEM_DEFINITIONS[stack.itemId].fishingBait !== false ? [{ ...stack, slot: slot as number | undefined }] : []);
      const equipped = this.root.querySelector('.fishing-baits>span')!; equipped.textContent = this.view.baitId ? `ESCA · ${ITEM_DEFINITIONS[this.view.baitId].name} · ${this.view.baitUsesRemaining === undefined ? 'RIUTILIZZABILE' : `${this.view.baitUsesRemaining}/3 LANCI`}` : 'SELEZIONA ESCA';
      if ((snapshot.gold ?? 0) > 0) options.push({ itemId: 'gold', quantity: snapshot.gold!, slot: undefined });
      for (const item of options) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.bait = item.itemId; button.dataset.baitSlot = String(item.slot ?? 'gold');
        button.setAttribute('aria-label', `${ITEM_DEFINITIONS[item.itemId].name}, ${item.quantity}`); button.title = `${ITEM_DEFINITIONS[item.itemId].name} · ${ITEM_DEFINITIONS[item.itemId].fishingBait === 'shiny' ? 'Brillante: attira i predatori' : ITEM_DEFINITIONS[item.itemId].fishingBait === 'organic' ? 'Organica: attira i pesci di fondale' : 'Esca insolita'} · ${ITEM_DEFINITIONS[item.itemId].fishingBaitConsumable ? '3/3 lanci' : 'Riutilizzabile'}`;
        button.disabled = ['waiting', 'bite', 'fight'].includes(this.view.phase); button.setAttribute('aria-pressed', String(item.itemId === this.view.baitId && item.slot === this.view.baitSlot));
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 40; drawItemArt(canvas.getContext('2d')!, item.itemId, 40);
        const count = document.createElement('b'); count.textContent = String(item.quantity); button.append(canvas, count);
        button.addEventListener('click', () => { if (this.view) this.send({ kind: 'bait', sessionId: this.view.id, itemId: item.itemId, slot: item.slot }); }); list.append(button);
      }
    }
    this.refreshHelp();
  }
  private refreshHelp(): void {
    if (!this.view || !this.snapshot) return;
    const valid = !!this.point && validFishingCast(this.world(), this.snapshot.self, this.point);
    this.root.querySelector('[data-fishing-help]')!.textContent = ['ready', 'result'].includes(this.view.phase)
      ? `${this.view.baitId ? ITEM_DEFINITIONS[this.view.baitId].name : 'Seleziona un’esca'} · ${valid ? 'Tocca l’acqua o trascina il mulinello per mirare' : 'Punta nell’acqua vicina'}`
      : this.view.phase === 'bite' ? 'Premi subito · Spazio / Mulinello' : this.view.phase === 'fight' ? `${formatFishingDistance(this.view.distanceM)} · Tira sopra il 55%, allenta prima del 99%` : 'Mulinello per ritirare · Esc per uscire';
  }
  press(): void {
    if (!this.view || this.catches.visible) return;
    if (['ready', 'result'].includes(this.view.phase)) { if (this.point) this.send({ kind: 'cast', sessionId: this.view.id, ...this.point }); return; }
    this.send({ kind: 'reel', sessionId: this.view.id, held: true });
    if (this.view.phase === 'bite' || this.view.phase === 'fight') {
      if (this.holding) return; this.holding = true;
      this.pulse = setInterval(() => { if (this.view && this.holding) this.send({ kind: 'reel', sessionId: this.view.id, held: true }); }, 400);
    }
  }
  release(): void { clearInterval(this.pulse); this.pulse = undefined; if (this.holding && this.view) this.send({ kind: 'reel', sessionId: this.view.id, held: false }); this.holding = false; }
  close(): void { if (this.view && !this.catches.visible) { this.release(); this.send({ kind: 'close', sessionId: this.view.id }); } }
}
