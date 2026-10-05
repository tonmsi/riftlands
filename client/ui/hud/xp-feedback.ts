import { xpProgress } from '../../../shared/config';

/** Feedback only for confirmed gains; entering a character never replays rewards. */
export class XpFeedback {
  private key?: string;
  private confirmed = 0;
  private displayed = 0;
  private displayedLevel = 1;
  private frame = 0;
  private gainTimer = 0;
  private levelTimer = 0;
  private accumulated = 0;
  private readonly animations = new Set<Animation>();
  private readonly gain = document.createElement('span');
  private readonly label = document.createElement('span');
  private readonly confetti = document.createElement('span');
  private readonly celebration = document.createElement('div');
  constructor(private fill: HTMLElement, private level: HTMLElement) {
    const meter = fill.parentElement!;
    this.gain.className = 'xp-gain'; this.gain.setAttribute('role', 'status'); this.gain.hidden = true;
    this.label.className = 'xp-progress-label';
    this.confetti.className = 'xp-confetti'; this.confetti.setAttribute('aria-hidden', 'true');
    meter.append(this.gain, this.label, this.confetti);
    this.celebration.className = 'xp-level-up'; this.celebration.hidden = true;
    this.celebration.setAttribute('role', 'status'); this.celebration.setAttribute('aria-live', 'polite');
    this.celebration.innerHTML = '<div class="level-up-emblem" aria-hidden="true">✦</div><span class="level-up-heading">LIVELLO RAGGIUNTO</span><strong class="level-up-number"></strong><span class="level-up-unlock"></span><div class="level-up-rule" aria-hidden="true"></div>';
    (fill.closest('.game-hud') ?? document.body).append(this.celebration);
  }
  reset(): void {
    cancelAnimationFrame(this.frame); clearTimeout(this.gainTimer); clearTimeout(this.levelTimer);
    this.frame = this.gainTimer = this.levelTimer = 0; this.key = undefined; this.accumulated = 0;
    this.animations.forEach(animation => animation.cancel()); this.animations.clear();
    this.gain.hidden = this.celebration.hidden = true; this.confetti.replaceChildren();
  }
  update(key: string, xp: number): void {
    if (this.key !== key || xp < this.confirmed) {
      this.reset(); this.key = key; this.confirmed = this.displayed = xp; this.paint(xp); return;
    }
    if (xp === this.confirmed) return;
    this.accumulated += xp - this.confirmed; this.confirmed = xp;
    this.gain.textContent = `+${this.accumulated} XP`; this.gain.hidden = false;
    cancelAnimationFrame(this.frame); clearTimeout(this.gainTimer);
    this.gain.getAnimations().forEach(animation => animation.cancel());
    const start = performance.now(), from = this.displayed, reduced = this.reducedMotion();
    this.animate(this.gain, [
      { opacity: 0, transform: 'translateY(8px) scale(.75)' },
      { opacity: 1, transform: 'translateY(-2px) scale(1.15)', offset: .12 },
      { opacity: 1, transform: 'translateY(0) scale(1)', offset: .75 },
      { opacity: 0, transform: 'translateY(-12px) scale(.95)' },
    ], 1850);
    this.gainTimer = window.setTimeout(() => { this.gain.hidden = true; this.accumulated = 0; this.gainTimer = 0; }, 1850);
    const animate = (now: number) => {
      const progress = reduced ? 1 : Math.min(1, (now - start) / 900);
      const value = from + (xp - from) * (1 - (1 - progress) ** 2);
      this.paint(value, true); this.displayed = value;
      if (progress < 1) this.frame = requestAnimationFrame(animate);
      else this.frame = 0;
    };
    this.frame = requestAnimationFrame(animate);
  }
  private reducedMotion(): boolean { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
  private animate(element: HTMLElement, frames: Keyframe[], duration: number): void {
    if (this.reducedMotion()) return;
    const animation = element.animate(frames, { duration, easing: 'ease-out', fill: 'both' });
    this.animations.add(animation);
    animation.oncancel = () => { this.animations.delete(animation); };
    animation.onfinish = () => { this.animations.delete(animation); animation.cancel(); };
  }
  private paint(value: number, celebrate = false): void {
    const progress = xpProgress(Math.round(value));
    this.fill.style.width = `${progress.fraction * 100}%`;
    this.label.textContent = progress.required ? `${progress.current} / ${progress.required} XP` : 'Livello massimo';
    this.level.textContent = String(progress.level);
    this.level.setAttribute('aria-label', `Livello ${progress.level}`); this.level.title = `Livello ${progress.level}`;
    this.fill.parentElement!.setAttribute('aria-label', progress.required ? `Livello ${progress.level}: ${progress.current} di ${progress.required} XP` : 'Livello massimo');
    if (celebrate && progress.level > this.displayedLevel) this.levelUp(progress.level);
    this.displayedLevel = progress.level;
  }
  private levelUp(level: number): void {
    clearTimeout(this.levelTimer);
    this.celebration.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    this.celebration.querySelector('.level-up-number')!.textContent = String(level);
    this.celebration.querySelector('.level-up-unlock')!.textContent = level === 2 ? 'Una nuova abilità da scegliere' : level === 5 ? 'Secondo slot sbloccato' : level === 10 ? 'Nuovi attacchi disponibili' : level === 20 ? 'Livello massimo raggiunto' : 'Il viaggio continua';
    this.celebration.hidden = false;
    this.animate(this.celebration, [
      { opacity: 0, transform: 'translate(-50%, -44%) scale(.82)', filter: 'blur(6px)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.04)', filter: 'blur(0)', offset: .18 },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', filter: 'blur(0)', offset: .72 },
      { opacity: 0, transform: 'translate(-50%, -56%) scale(1.02)', filter: 'blur(2px)' },
    ], 2400);
    this.level.getAnimations().forEach(animation => animation.cancel());
    this.animate(this.level, [{ scale: '1', filter: 'brightness(1)' }, { scale: '1.18', filter: 'brightness(1.25)', offset: .4 }, { scale: '1', filter: 'brightness(1)' }], 450);
    this.levelTimer = window.setTimeout(() => { this.celebration.hidden = true; this.levelTimer = 0; }, 2400);
    if (!this.reducedMotion()) this.burst();
  }
  private burst(): void {
    const colors = ['#ffe69b', '#93ebc1', '#a9cfff', '#eba7e5', '#fff6dc'];
    // Bounded, local DOM particles: no render loop survives their short burst.
    for (let i = 0; i < 22; i++) {
      const piece = document.createElement('i'); piece.style.background = colors[i % colors.length];
      piece.style.left = `${25 + i % 7 * 10}%`; piece.style.width = `${3 + i % 3}px`;
      this.confetti.append(piece);
      const x = (i % 11 - 5) * 13, height = 24 + i % 6 * 9, turn = (i % 2 ? 1 : -1) * (90 + i * 23);
      const animation = piece.animate([
        { opacity: 0, transform: 'translate(0, 0) rotate(0deg) scale(.5)' },
        { opacity: 1, transform: `translate(${x * .4}px, -${height}px) rotate(${turn * .4}deg) scale(1)`, offset: .35 },
        { opacity: 0, transform: `translate(${x}px, 28px) rotate(${turn}deg) scale(.7)` },
      ], { duration: 850 + i % 4 * 80, delay: i % 5 * 18, easing: 'cubic-bezier(.2,.7,.45,1)', fill: 'both' });
      this.animations.add(animation);
      animation.oncancel = () => { this.animations.delete(animation); };
      animation.onfinish = () => { piece.remove(); this.animations.delete(animation); animation.cancel(); };
    }
  }
}
