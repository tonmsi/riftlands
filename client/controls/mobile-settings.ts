export const MOBILE_LAYOUT_STORAGE_KEY = 'riftlands.mobile.layout';
export interface MobileLayoutSettings { moveX: number; moveY: number; attackX: number; attackY: number; }
export function parseMobileLayout(raw: string | null): MobileLayoutSettings {
  let value: any; try { value = JSON.parse(raw ?? '{}'); } catch { value = {}; }
  const offset = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(30, n)) : 0;
  return { moveX: offset(value?.moveX), moveY: offset(value?.moveY), attackX: offset(value?.attackX), attackY: offset(value?.attackY) };
}
export function applyMobileLayout(root: HTMLElement, settings: MobileLayoutSettings): void {
  for (const key of ['moveX', 'moveY', 'attackX', 'attackY'] as const)
    root.style.setProperty(`--${key.replace(/[XY]/, axis => `-${axis.toLowerCase()}`)}`, `${settings[key]}%`);
}
