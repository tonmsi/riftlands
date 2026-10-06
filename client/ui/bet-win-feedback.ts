import type { BetWin } from '../../shared/betting';

/** Only server-confirmed wins celebrate; ordinary wallet gains and refunds never do. */
export class BetWinFeedback {
  private readonly receipt = document.createElement('div');
  private readonly overlay = document.createElement('div');
  private readonly seen = new Set<string>();
  private frame = 0;
  private timer = 0;
  private total = 0;
  private queue: BetWin[] = [];
  get visible() { return !this.overlay.hidden; }
  constructor(private root: HTMLElement, private release: () => void) {
    this.receipt.className = 'bet-win-receipt'; this.receipt.hidden = true;
    this.receipt.setAttribute('role', 'status'); this.receipt.setAttribute('aria-live', 'polite');
    root.append(this.receipt);
    window.addEventListener('resize', () => this.positionReceipt());
    this.overlay.className = 'bet-win-overlay'; this.overlay.hidden = true;
    this.overlay.innerHTML = '<div class="bet-win-confetti" aria-hidden="true"></div><section class="bet-win-prize" role="status" aria-live="polite"><div class="bet-win-emblem" aria-hidden="true">✦</div><small>SCOMMESSA VINTA</small><h2>Il tuo campione ha trionfato</h2><strong class="bet-win-count">+0</strong><span>GOLD ACCREDITATI</span><button type="button">Continua</button></section>';
    root.append(this.overlay);
    this.overlay.querySelector('button')!.onclick = () => this.dismiss();
    this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.dismiss(); });
    document.addEventListener('keydown', e => { if (this.visible && ['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); this.dismiss(); } }, true);
  }
  show(win: BetWin) {
    if (this.seen.has(win.id)) return;
    this.seen.add(win.id); if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!);
    this.total += win.amount; clearTimeout(this.timer);
    this.receipt.textContent = `WIN + ${this.total} GOLD`; this.receipt.hidden = false;
    this.positionReceipt();
    this.receipt.getAnimations().forEach(a => a.cancel());
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) this.receipt.animate([{ opacity: 0, transform: 'translateY(-7px) scale(.9)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 300, easing: 'ease-out' });
    this.timer = window.setTimeout(() => { this.receipt.hidden = true; this.total = 0; }, 8000);
    if (!win.celebrate) return;
    if (this.visible) { this.queue.push(win); return; }
    this.celebrate(win.amount);
  }
  combat(inCombat: boolean) { if (inCombat && this.visible) { this.queue = []; this.dismiss(false); } }
  private positionReceipt() {
    if (this.receipt.hidden) return;
    const gold = this.root.querySelector('.gold-counter'); if (!gold) return;
    const wallet = gold.getBoundingClientRect(), parent = this.root.getBoundingClientRect();
    this.receipt.style.top = `${wallet.bottom - parent.top + 7}px`;
    this.receipt.style.right = `${parent.right - wallet.right}px`;
    this.receipt.style.zIndex = '90';
  }
  private celebrate(amount: number) {
    this.release(); this.overlay.hidden = false;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const confetti = this.overlay.querySelector('.bet-win-confetti')!; confetti.replaceChildren();
    if (!reduced) for (let i = 0; i < 64; i++) {
      const piece = document.createElement('i');
      piece.style.setProperty('--x', `${Math.cos(i * 2.4) * (130 + i % 16 * 15)}px`);
      piece.style.setProperty('--y', `${Math.sin(i * 2.4) * 160 - 90}px`);
      piece.style.setProperty('--turn', `${i * 47}deg`);
      piece.style.background = ['#f6d783', '#cc9842', '#98d7c1', '#f4ead1'][i % 4];
      piece.style.animationDelay = `${i % 10 * 40}ms`; confetti.append(piece);
    }
    const counter = this.overlay.querySelector('.bet-win-count')!, start = performance.now();
    const count = (now: number) => {
      const progress = reduced ? 1 : Math.min(1, (now - start) / 1600);
      counter.textContent = `+${Math.round(amount * (1 - (1 - progress) ** 3)).toLocaleString('it-IT')}`;
      this.frame = progress < 1 ? requestAnimationFrame(count) : 0;
    };
    count(start);
  }
  private dismiss(next = true) {
    cancelAnimationFrame(this.frame); this.frame = 0;
    this.overlay.hidden = true; this.overlay.querySelector('.bet-win-confetti')!.replaceChildren();
    if (next && this.queue.length) this.celebrate(this.queue.shift()!.amount);
  }
  reset() { this.queue = []; this.dismiss(false); clearTimeout(this.timer); this.receipt.hidden = true; this.total = 0; }
}
