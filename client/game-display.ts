/** Browser presentation only; a future native wrapper can replace this boundary. */
export class GameDisplay {
  private playing = false;
  private guarded = false;
  private readonly historyKey = `riftlands-game-${Math.random().toString(36).slice(2)}`;
  private readonly touchQuery = matchMedia('(pointer: coarse)');
  private fullscreenPending = false;
  private fullscreenWanted = false;
  private readonly fullscreenButton: HTMLButtonElement;
  constructor(private root: HTMLElement, private interrupt: () => void, private requestExit: () => void, private notify: (message: string) => void) {
    this.fullscreenButton = document.createElement('button');
    this.fullscreenButton.type = 'button'; this.fullscreenButton.className = 'glass hud-menu-button fullscreen-toggle';
    this.fullscreenButton.textContent = '⛶ Schermo intero'; this.fullscreenButton.title = 'Schermo intero'; this.fullscreenButton.setAttribute('aria-label', 'Schermo intero');
    root.querySelector('.settings-actions')!.prepend(this.fullscreenButton);
    this.fullscreenButton.addEventListener('click', () => void this.enterFullscreen());
    const resize = () => {
      root.style.setProperty('--game-height', `${window.visualViewport?.height ?? innerHeight}px`);
      root.classList.toggle('touch-layout', this.touch);
      this.interrupt();
    };
    resize(); window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize);
    this.touchQuery.addEventListener('change', resize);
    document.addEventListener('fullscreenchange', () => { this.updateFullscreen(); resize(); });
    window.addEventListener('popstate', () => {
      if (!this.playing || !this.guarded) return;
      this.guarded = false; this.interrupt(); this.requestExit();
    });
    this.updateFullscreen();
  }
  get touch(): boolean { return this.touchQuery.matches; }
  private get standalone(): boolean {
    return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches
      || !!(navigator as Navigator & { standalone?: boolean }).standalone;
  }
  private fullscreenHelp(): void {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.notify(ios
      ? 'Per giocare senza la barra di Safari: Condividi → Aggiungi alla schermata Home, poi apri Riftlands dalla nuova icona.'
      : 'Schermo intero non disponibile. Puoi continuare a giocare o riprovare dal pulsante ⛶.');
  }
  async enterFullscreen(): Promise<void> {
    this.fullscreenWanted = true;
    if (this.standalone || document.fullscreenElement || this.fullscreenPending) return;
    if (!document.documentElement.requestFullscreen) { this.fullscreenHelp(); return; }
    this.fullscreenPending = true;
    try {
      // Called directly in the join/click event, before asset loading or authentication.
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (!this.fullscreenWanted) { await document.exitFullscreen(); return; }
      if (this.touch) {
        const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
        try { await orientation?.lock?.('landscape'); } catch { /* Portrait layout remains usable. */ }
      }
    } catch { if (this.fullscreenWanted) this.fullscreenHelp(); }
    finally { this.fullscreenPending = false; this.updateFullscreen(); }
  }
  setPlaying(playing: boolean): void {
    this.playing = playing;
    document.documentElement.classList.toggle('game-active', playing);
    if (playing) this.armBackGuard();
    else {
      this.fullscreenWanted = false;
      const shouldPop = this.guarded && history.state?.riftlandsGame === this.historyKey;
      this.guarded = false;
      if (shouldPop) history.back();
      try { screen.orientation?.unlock?.(); } catch { /* Unsupported or hidden document. */ }
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    }
    this.updateFullscreen();
  }
  resume(): void { if (this.playing) this.armBackGuard(); }
  private armBackGuard(): void {
    if (this.guarded) return;
    history.pushState({ ...history.state, riftlandsGame: this.historyKey }, '', location.href);
    this.guarded = true;
  }
  private updateFullscreen(): void { this.fullscreenButton.hidden = this.standalone || !!document.fullscreenElement; }
}
