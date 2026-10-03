import { CAMERA_STORAGE_KEY, parseCameraSettings, type CameraSettings } from './camera-settings';

/** The same device preferences are editable from the lobby and during play. */
export class CameraOptions {
  constructor(root: HTMLElement, settings: CameraSettings, apply: (settings: CameraSettings) => void) {
    const panels: HTMLElement[] = [];
    for (const target of [root.querySelector('[data-hub-panel="settings"]'), root.querySelector('.settings-actions')]) {
      if (!target) continue;
      const panel = document.createElement('div');
      panel.className = 'camera-options';
      panel.innerHTML = `<strong>Visuale e zoom</strong><label>Zoom <output></output><input data-camera-zoom type="range" min="100" max="200" step="5" aria-label="Zoom di gioco"></label><label>Limite della visuale<select data-camera-limit aria-label="Limite della visuale"><option value="standard">2200 × 1400 (predefinito)</option><option value="compact">1920 × 1080</option><option value="close">1600 × 1000</option></select></label><small>Il limite riduce quanto mondo puoi vedere sui grandi schermi. Lo zoom è uguale nel mondo e in arena.</small>`;
      target.append(panel); panels.push(panel);
    }
    const refresh = () => {
      for (const panel of panels) {
        panel.querySelector<HTMLInputElement>('input')!.value = String(Math.round(settings.zoom * 100));
        panel.querySelector('output')!.textContent = `${Math.round(settings.zoom * 100)}%`;
        panel.querySelector<HTMLSelectElement>('select')!.value = settings.viewLimit;
      }
    };
    for (const panel of panels) panel.addEventListener('input', () => {
      settings = parseCameraSettings(JSON.stringify({ zoom: Number(panel.querySelector<HTMLInputElement>('input')!.value) / 100, viewLimit: panel.querySelector<HTMLSelectElement>('select')!.value }));
      apply(settings); refresh();
      try { localStorage.setItem(CAMERA_STORAGE_KEY, JSON.stringify(settings)); } catch { /* Applied for this session. */ }
    });
    refresh();
  }
}
