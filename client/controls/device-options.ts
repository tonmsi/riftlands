import type { GameAudio } from '../core/audio';
import { applyMobileLayout, MOBILE_LAYOUT_STORAGE_KEY, parseMobileLayout, type MobileLayoutSettings } from './mobile-settings';
import { MOBILE_FRAME_RATE_KEY, parseMobileFrameRate, type MobileFrameRateMode } from './mobile-performance';

/** Mirrored settings in lobby and HUD, stored only on this device. */
export class DeviceOptions {
  private panels: HTMLElement[] = [];
  private layout = parseMobileLayout(null);
  mobileFrameRate: MobileFrameRateMode = 'auto';
  constructor(private root: HTMLElement, private audio: GameAudio, muteChanged: () => void, private release: () => void) {
    try { this.layout = parseMobileLayout(localStorage.getItem(MOBILE_LAYOUT_STORAGE_KEY)); } catch { /* Optional storage. */ }
    try { this.mobileFrameRate = parseMobileFrameRate(localStorage.getItem(MOBILE_FRAME_RATE_KEY)); } catch { /* Optional storage. */ }
    applyMobileLayout(root, this.layout);
    const range = (key: string, label: string, max: number) => `<label>${label}<output data-output="${key}"></output><input data-device="${key}" type="range" min="0" max="${max}" step="1" aria-label="${label}"></label>`;
    for (const target of [root.querySelector('[data-hub-panel="settings"]'), root.querySelector('.settings-actions')]) {
      if (!target) continue;
      const panel = document.createElement('div'); panel.className = 'device-options';
      panel.innerHTML = `<details open><summary>Audio</summary><div class="camera-options"><button type="button" data-device-mute></button>${range('effects', 'Volume effetti', 100)}${range('music', 'Volume musica', 100)}<small>Riattivando la musica il volume torna in 5 secondi, mantenendo il punto della traccia.</small></div></details><details class="mobile-layout-options"><summary>Controlli mobile</summary><div class="camera-options"><strong>Joystick movimento</strong>${range('moveX', 'Movimento verso il centro', 30)}${range('moveY', 'Movimento più in alto', 30)}<strong>Attacchi</strong>${range('attackX', 'Attacchi verso il centro', 30)}${range('attackY', 'Attacchi più in alto', 30)}<button type="button" data-device-reset>Ripristina posizioni</button><small>Posizioni proporzionali allo schermo, salvate su questo dispositivo.</small></div></details>`;
      target.append(panel); this.panels.push(panel);
      panel.insertAdjacentHTML('beforeend', '<details class="mobile-performance-options"><summary>Prestazioni mobile</summary><div class="camera-options"><label>Fluidità<select data-device="fps" aria-label="Fluidità mobile"><option value="auto">Automatica</option><option value="60">60 FPS</option><option value="30">30 FPS stabili</option></select></label><small>Automatica passa a 30 FPS quando il telefono fatica. Movimento e comandi mantengono la stessa velocità.</small></div></details>');
      panel.addEventListener('input', event => {
        const input = event.target as HTMLInputElement, key = input.dataset.device;
        if (!key) return;
        if (key === 'fps') {
          this.mobileFrameRate = parseMobileFrameRate(input.value);
          try { localStorage.setItem(MOBILE_FRAME_RATE_KEY, String(this.mobileFrameRate)); } catch { /* Applied for this session. */ }
        } else if (key === 'effects' || key === 'music') this.audio.setVolumes({ ...this.audio.settings, [key]: Number(input.value) / 100 });
        else { this.release(); this.layout = parseMobileLayout(JSON.stringify({ ...this.layout, [key]: Number(input.value) })); this.saveLayout(); }
        this.refresh();
      });
      panel.querySelector('[data-device-mute]')!.addEventListener('click', () => { audio.setMuted(!audio.muted); muteChanged(); this.refresh(); });
      panel.querySelector('[data-device-reset]')!.addEventListener('click', () => { this.release(); this.layout = parseMobileLayout(null); this.saveLayout(); this.refresh(); });
    }
    this.refresh();
  }
  refresh(): void {
    for (const panel of this.panels) {
      const mute = panel.querySelector<HTMLButtonElement>('[data-device-mute]')!;
      mute.textContent = this.audio.muted ? 'Riattiva audio' : 'Silenzia audio'; mute.setAttribute('aria-pressed', String(this.audio.muted));
      for (const input of panel.querySelectorAll<HTMLInputElement>('[data-device]')) {
        const key = input.dataset.device!;
        if (key === 'fps') { input.value = String(this.mobileFrameRate); continue; }
        const value = key === 'effects' || key === 'music' ? Math.round(this.audio.settings[key] * 100) : this.layout[key as keyof MobileLayoutSettings];
        input.value = String(value); panel.querySelector(`[data-output="${key}"]`)!.textContent = `${value}%`;
      }
    }
  }
  private saveLayout(): void {
    applyMobileLayout(this.root, this.layout);
    try { localStorage.setItem(MOBILE_LAYOUT_STORAGE_KEY, JSON.stringify(this.layout)); } catch { /* Applied for this session. */ }
  }
}
