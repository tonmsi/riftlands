import { FISH, RARITIES, type FishingView } from '../../shared/fishing/model';
import { drawItemArt } from '../ui/interactions/item-art';
/** Local celebration consumes confirmed catch IDs, never a speculative success. */
export class CatchFeedback {
  private root = document.createElement('div');
  private seen = new Set<string>();
  private raf = 0;
  private counting = false;
  private unlockAt = 0;
  private unlockTimer = 0;
  private blockedPointers = new Set<number>();
  private swallowClick = false;
  get visible(): boolean { return !this.root.hidden; }
  constructor(parent: HTMLElement) {
    this.root.className = 'fishing-catch'; this.root.hidden = true; this.root.setAttribute('role', 'status');
    this.root.innerHTML = '<div class="fishing-catch-confetti" aria-hidden="true"></div><small data-catch-rarity></small><canvas width="144" height="144"></canvas><strong data-catch-name></strong><b data-catch-weight></b><span data-catch-destination></span><small class="fishing-catch-dismiss">Tocca per continuare</small>';
    parent.append(this.root);
    const lossIcon = document.createElement('div'); lossIcon.className = 'fishing-loss-symbol'; lossIcon.hidden = true; lossIcon.setAttribute('aria-hidden', 'true');
    lossIcon.innerHTML = '<svg viewBox="0 0 100 80"><path d="M12 40 28 28v24ZM28 40c12-26 43-26 58 0-15 26-46 26-58 0Z"/><path d="m67 33 8 8m0-8-8 8M48 4l-7 15 13 6-12 14 14 7-8 25"/></svg>';
    this.root.insertBefore(lossIcon, this.root.querySelector('canvas'));
    document.addEventListener('pointerdown', e => {
      this.swallowClick = false;
      if (!this.visible) return;
      this.blockedPointers.add(e.pointerId); e.preventDefault(); e.stopImmediatePropagation(); this.dismiss();
    }, true);
    for (const type of ['pointermove', 'pointerup', 'pointercancel'] as const) document.addEventListener(type, e => {
      if (!this.visible && !this.blockedPointers.has(e.pointerId)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (type !== 'pointermove') { this.blockedPointers.delete(e.pointerId); this.swallowClick = type === 'pointerup'; }
    }, true);
    document.addEventListener('click', e => {
      if (!this.visible && !this.swallowClick) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.swallowClick = false;
      if (this.visible) this.dismiss();
    }, true);
    document.addEventListener('keydown', e => {
      if (!this.visible || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (['Escape', 'Enter', ' '].includes(e.key)) this.dismiss();
    }, true);
  }
  private dismiss(force = false): void {
    if (!force && (this.counting || performance.now() < this.unlockAt)) return;
    cancelAnimationFrame(this.raf); clearTimeout(this.unlockTimer); this.counting = false; this.unlockAt = 0;
    this.root.hidden = true; this.root.querySelector('.fishing-catch-confetti')!.replaceChildren();
  }
  reset(): void { this.dismiss(true); this.seen.clear(); this.blockedPointers.clear(); this.swallowClick = false; }
  update(view: FishingView): void {
    if (view.resultId && ['broken', 'escaped', 'missed'].includes(view.outcome ?? '')) { this.showLoss(view); return; }
    if (!view.catchId || view.outcome !== 'caught' || this.seen.has(view.catchId)) return;
    this.seen.add(view.catchId); if (this.seen.size > 64) this.seen.delete(this.seen.values().next().value!);
    cancelAnimationFrame(this.raf);
    clearTimeout(this.unlockTimer); this.unlockAt = 0; this.counting = true;
    const fish = FISH.find(f => f.id === view.fishId); if (!fish) return;
    const rarity = RARITIES[fish.rarity], canvas = this.root.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    this.root.classList.remove('is-lost'); this.root.querySelector<HTMLElement>('.fishing-loss-symbol')!.hidden = true; canvas.hidden = false; this.root.querySelector<HTMLElement>('[data-catch-weight]')!.hidden = false;
    this.root.dataset.catchId = view.catchId; this.root.style.setProperty('--rarity', rarity.color);
    this.root.querySelector('[data-catch-rarity]')!.textContent = `CATTURA · ${rarity.label.toUpperCase()}`;
    this.root.querySelector('[data-catch-name]')!.textContent = fish.name;
    this.root.querySelector('.fishing-catch-dismiss')!.textContent = 'Pesatura in corso…';
    this.root.querySelector('[data-catch-destination]')!.textContent = view.catchOnGround ? 'Sacca piena · Il pesce è a terra per 45 secondi' : 'Aggiunto alla sacca';
    const confetti = this.root.querySelector('.fishing-catch-confetti')!; confetti.replaceChildren();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) for (let i = 0; i < 72; i++) { const piece = document.createElement('i'); piece.style.setProperty('--x', `${Math.cos(i * 2.4) * (100 + i % 24 * 5)}px`); piece.style.setProperty('--y', `${Math.sin(i * 2.4) * (90 + i % 9 * 10) - 40}px`); piece.style.background = [rarity.color, '#e8d3a2', '#9fdac2', '#ef947e'][i % 4]; piece.style.animationDelay = `${i % 12 * 50}ms`; confetti.append(piece); }
    this.root.hidden = false; this.root.getAnimations().forEach(a => a.cancel());
    if (!reduced) this.root.animate([{ opacity: 0, scale: '.8' }, { opacity: 1, scale: '1.05', offset: .25 }, { opacity: 1, scale: '1' }], { duration: 400, easing: 'ease-out' });
    const start = performance.now(), duration = reduced ? 0 : 2600, weight = view.weightKg ?? 0;
    const frame = (now: number) => { const p = duration ? Math.min(1, (now - start) / duration) : 1, counted = p < .5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2; ctx.clearRect(0, 0, 144, 144); drawItemArt(ctx, fish.id, 144); this.root.querySelector('[data-catch-weight]')!.textContent = `${(weight * counted).toFixed(2)} kg`; if (p < 1) this.raf = requestAnimationFrame(frame); else { this.counting = false; this.root.querySelector('.fishing-catch-dismiss')!.textContent = 'Tocca per continuare'; } };
    frame(start);
  }
  private showLoss(view: FishingView): void {
    if (this.seen.has(view.resultId!)) return;
    this.seen.add(view.resultId!); if (this.seen.size > 64) this.seen.delete(this.seen.values().next().value!);
    this.dismiss(true); this.root.getAnimations().forEach(a => a.cancel());
    this.root.classList.add('is-lost'); this.root.dataset.outcome = view.outcome; this.root.style.setProperty('--rarity', '#ef947e');
    this.root.querySelector<HTMLCanvasElement>('canvas')!.hidden = true; this.root.querySelector<HTMLElement>('[data-catch-weight]')!.hidden = true; this.root.querySelector<HTMLElement>('.fishing-loss-symbol')!.hidden = false;
    this.root.querySelector('[data-catch-rarity]')!.textContent = 'PESCE PERSO';
    this.root.querySelector('[data-catch-name]')!.textContent = view.outcome === 'broken' ? 'Filo spezzato!' : view.outcome === 'escaped' ? 'Pesce slamato!' : 'Ferrata mancata!';
    this.root.querySelector('[data-catch-destination]')!.textContent = 'Esca persa · Montane un’altra per riprovare';
    this.unlockAt = performance.now() + 1500;
    this.root.querySelector('.fishing-catch-dismiss')!.textContent = 'Attendi…';
    this.unlockTimer = window.setTimeout(() => { this.root.querySelector('.fishing-catch-dismiss')!.textContent = 'Tocca per continuare'; }, 1500);
    this.root.hidden = false;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) this.root.animate([{ opacity: 0, scale: '.9' }, { opacity: 1, scale: '1' }], { duration: 300, easing: 'ease-out' });
  }
}
