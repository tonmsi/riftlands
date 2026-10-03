import { UIRefs } from './ui-dom';
export interface EntranceHooks { prepare(): void; changed(): void; completed(): void; }
export class WorldEntrance {
  private readonly refs: UIRefs;
  private entranceFrame = 0;
  private entranceTimer = 0;
  private entranceStarted = 0;
  private entranceReady = false;
  constructor(private readonly root: HTMLElement, private readonly hooks: EntranceHooks) {
    this.refs = new UIRefs(root.querySelector('.world-entrance')!);
  }
  get visible(): boolean { return !this.ref('world-entrance').hidden; }
  setReady(ready: boolean): void { this.entranceReady = ready; }
  private ref(name: string): HTMLElement { return this.refs.get(name); }
  start(art?: string): void {
    this.cancel();
    const overlay = this.ref('world-entrance');
    overlay.style.backgroundImage = art ? `url(${JSON.stringify(art)})` : 'none';
    overlay.hidden = false;
    overlay.classList.remove('is-leaving');
    this.root.classList.add('is-entering');
    this.entranceReady = false;
    this.entranceStarted = performance.now();
    this.hooks.prepare();
    const progress = this.ref('entrance-progress') as HTMLProgressElement;
    progress.value = 0;
    const advance = () => {
      const elapsed = performance.now() - this.entranceStarted;
      progress.value = Math.min(92, elapsed / 2000 * 92);
      if (elapsed >= 2000 && this.entranceReady) {
        progress.value = 100;
        this.entranceFrame = 0;
        overlay.classList.add('is-leaving');
        this.root.classList.remove('is-entering');
        this.entranceTimer = window.setTimeout(() => {
          overlay.hidden = true;
          this.entranceTimer = 0;
          this.hooks.changed();
          this.hooks.completed();
        }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400);
      } else this.entranceFrame = requestAnimationFrame(advance);
    };
    this.entranceFrame = requestAnimationFrame(advance);
    this.hooks.changed();
  }
  cancel(): void {
    cancelAnimationFrame(this.entranceFrame);
    clearTimeout(this.entranceTimer);
    this.entranceFrame = 0;
    this.entranceTimer = 0;
    this.entranceReady = false;
    this.ref('world-entrance').hidden = true;
    this.root.classList.remove('is-entering');
    this.hooks.changed();
  }
}
