import { SOUL_FAREWELL_MS } from '../../../shared/soul-escort';

/** A quiet farewell over the world, without taking movement or input away. */
export class SoulFarewellUI {
  private readonly panel = document.createElement('div');
  private readonly words = document.createElement('p');
  private frame = 0;
  constructor(hud: HTMLElement) {
    this.panel.className = 'soul-farewell'; this.panel.hidden = true;
    this.panel.setAttribute('role', 'status'); this.panel.setAttribute('aria-live', 'polite');
    const heading = document.createElement('small'); heading.textContent = 'LE ANIME RITROVANO CASA';
    this.panel.append(heading, this.words); hud.append(this.panel);
  }
  start(): void {
    this.reset(); this.panel.hidden = false;
    const start = performance.now();
    const draw = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= SOUL_FAREWELL_MS) { this.reset(); return; }
      const phrase = elapsed < 2800 ? '«Riconosco questo posto… siamo a casa.»'
        : elapsed < 5900 ? '«Non ricordavamo più la strada. Tu non ci hai lasciati soli.»'
          : '«Grazie. Ora possiamo riposare.»';
      if (this.words.textContent !== phrase) this.words.textContent = phrase;
      this.panel.style.opacity = String(Math.min(1, elapsed / 700, (SOUL_FAREWELL_MS - elapsed) / 1100));
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }
  reset(): void { cancelAnimationFrame(this.frame); this.frame = 0; this.panel.hidden = true; }
}
