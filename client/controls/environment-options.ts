export const ENVIRONMENT_ANIMATIONS_KEY = 'riftlands.environment.animations';
export function readEnvironmentAnimations(): boolean {
  try { return localStorage.getItem(ENVIRONMENT_ANIMATIONS_KEY) !== 'false'; } catch { return true; }
}
export function installEnvironmentOptions(root: HTMLElement, initial: boolean, apply: (enabled: boolean) => void): void {
  const fields: HTMLInputElement[] = [];
  for (const parent of [root.querySelector('[data-hub-panel="settings"]'), root.querySelector('.settings-actions')]) {
    if (!parent) continue;
    const panel = document.createElement('div'); panel.className = 'camera-options';
    panel.innerHTML = '<strong>Animazioni dell’ambiente</strong><label><input data-environment-animations type="checkbox" style="width:auto">Animazioni ambientali JS</label><small>Cespugli al vento, fuochi, bracieri, onde e precipitazioni in movimento. Disattiva per usare versioni ferme più leggere. Personaggi, spritesheet e combattimenti restano attivi. Salvato su questo dispositivo.</small>';
    const input = panel.querySelector('input')!; input.checked = initial; fields.push(input); parent.append(panel);
    input.onchange = () => {
      for (const other of fields) other.checked = input.checked;
      apply(input.checked);
      try { localStorage.setItem(ENVIRONMENT_ANIMATIONS_KEY, String(input.checked)); } catch { /* Session preference still applies. */ }
    };
  }
}
