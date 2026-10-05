/** Animate confirmed wallet gains from every source; initial/reconnected balances never replay. */
export class GoldFeedback {
  private key?: string;
  private confirmed = 0;
  private displayed = 0;
  private accumulated = 0;
  private frame = 0;
  private timer = 0;
  private readonly gain = document.createElement('span');
  constructor(private wallet: HTMLElement) {
    this.gain.className = 'gold-gain'; this.gain.hidden = true; this.gain.setAttribute('role', 'status');
    wallet.parentElement!.append(this.gain);
  }
  reset(): void {
    cancelAnimationFrame(this.frame); clearTimeout(this.timer); this.frame = this.timer = 0;
    this.key = undefined; this.accumulated = 0; this.gain.hidden = true;
    this.gain.getAnimations().forEach(animation => animation.cancel()); this.wallet.getAnimations().forEach(animation => animation.cancel());
  }
  update(key: string, gold: number): void {
    if (this.key !== key || gold < this.confirmed) {
      this.reset(); this.key = key; this.confirmed = this.displayed = gold; this.wallet.textContent = String(gold); return;
    }
    if (gold === this.confirmed) return;
    this.accumulated += gold - this.confirmed; this.confirmed = gold;
    this.gain.textContent = `+${this.accumulated} GOLD`; this.gain.hidden = false;
    cancelAnimationFrame(this.frame); clearTimeout(this.timer);
    this.gain.getAnimations().forEach(animation => animation.cancel()); this.wallet.getAnimations().forEach(animation => animation.cancel());
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      this.gain.animate([
        { opacity: 0, transform: 'translateY(8px) scale(.75)' },
        { opacity: 1, transform: 'translateY(-2px) scale(1.12)', offset: .12 },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: .75 },
        { opacity: 0, transform: 'translateY(-12px) scale(.95)' },
      ], { duration: 1850, easing: 'ease-out', fill: 'both' });
      this.wallet.animate([{ scale: '1' }, { scale: '1.18', offset: .4 }, { scale: '1' }], { duration: 450, easing: 'ease-out' });
    }
    this.timer = window.setTimeout(() => { this.gain.hidden = true; this.accumulated = 0; this.timer = 0; }, 1850);
    const from = this.displayed, start = performance.now();
    const paint = (now: number) => {
      const progress = reduced ? 1 : Math.min(1, (now - start) / 900);
      this.displayed = from + (gold - from) * (1 - (1 - progress) ** 2);
      this.wallet.textContent = String(Math.round(this.displayed));
      this.frame = progress < 1 ? requestAnimationFrame(paint) : 0;
    };
    this.frame = requestAnimationFrame(paint);
  }
}
