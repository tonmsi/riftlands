import type { AbilitySlot, Vec2 } from '../shared/types';

export const CONTROL_LABELS = {
  up: 'Muovi su', down: 'Muovi giù', left: 'Muovi a sinistra', right: 'Muovi a destra',
  movePointer: 'Segui il cursore (tieni premuto)', basic: 'Attacco base', q: 'Abilità 1', e: 'Abilità 2', r: 'Abilità 3',
} as const;
export type ControlAction = keyof typeof CONTROL_LABELS;
export type ControlSettings = { version: 1; movement: 'keyboard' | 'mouse'; bindings: Record<ControlAction, string[]> };
export const CONTROLS_STORAGE_KEY = 'riftlands.controls.v1';
const directions: ControlAction[] = ['up', 'down', 'left', 'right'];
const slots: AbilitySlot[] = ['basic', 'q', 'e', 'r'];

export function defaultControls(): ControlSettings {
  return { version: 1, movement: 'keyboard', bindings: {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    movePointer: ['Mouse2'], basic: ['Space', 'Mouse2'], q: ['KeyQ'], e: ['KeyE'], r: ['KeyR'],
  } };
}
export function activeActions(settings: ControlSettings): ControlAction[] {
  return [...(settings.movement === 'keyboard' ? directions : ['movePointer'] as ControlAction[]), ...slots];
}
// Left click selects actors and enables manual aim while held.
export function isBindable(code: string): boolean {
  return /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal)|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Mouse[12])$/.test(code);
}
export function bindingLabel(code: string): string {
  const labels: Record<string, string> = { Space: 'Spazio', Mouse1: 'Mouse centrale', Mouse2: 'Mouse destro', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift sx', ShiftRight: 'Shift dx' };
  return labels[code] ?? code.replace(/^Key|^Digit/, '');
}
export function parseControls(raw: string | null): ControlSettings {
  try {
    const value = JSON.parse(raw ?? '') as ControlSettings;
    if (value.version !== 1 || !['keyboard', 'mouse'].includes(value.movement)) return defaultControls();
    for (const action of Object.keys(CONTROL_LABELS) as ControlAction[]) {
      const bindings = value.bindings[action];
      if (!Array.isArray(bindings) || bindings.length < 1 || bindings.length > 2 || bindings.some(code => typeof code !== 'string' || !isBindable(code)) || new Set(bindings).size !== bindings.length) return defaultControls();
    }
    const active = activeActions(value).flatMap(action => value.bindings[action]);
    if (new Set(active).size !== active.length) return defaultControls();
    return structuredClone(value);
  } catch { return defaultControls(); }
}
export function assignBinding(settings: ControlSettings, action: ControlAction, index: number, code: string): string | null {
  if (!isBindable(code)) return 'Tasto riservato o non supportato. Scegli una lettera, un numero, Spazio, Shift o un pulsante del mouse.';
  for (const other of activeActions(settings)) {
    if (settings.bindings[other].some((binding, slot) => binding === code && (other !== action || slot !== index))) return `Già assegnato a: ${CONTROL_LABELS[other]}.`;
  }
  settings.bindings[action][index] = code;
  return null;
}
export function changeMovement(settings: ControlSettings, movement: ControlSettings['movement']): void {
  settings.movement = movement;
  // Keep the newly enabled movement bindings, replacing conflicting combat bindings.
  const movementCodes = new Set((movement === 'keyboard' ? directions : ['movePointer'] as ControlAction[]).flatMap(action => settings.bindings[action]));
  for (const slot of slots) settings.bindings[slot] = settings.bindings[slot].filter(code => !movementCodes.has(code));
  const occupied = new Set(activeActions(settings).flatMap(action => settings.bindings[action]));
  for (const slot of slots) {
    if (settings.bindings[slot].length) continue;
    const replacement = [defaultControls().bindings[slot][0], ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `Key${letter}`)].find(code => !occupied.has(code))!;
    settings.bindings[slot] = [replacement]; occupied.add(replacement);
  }
}

/** Device-independent input state: touch movement never changes the aim. */
export class GameControls {
  private pressed = new Set<string>();
  private touchMovement: Vec2 = { x: 0, y: 0 };
  private pointer: Vec2 | null = null;
  private touchAim: number | null = null;
  private pendingCast: AbilitySlot | undefined;
  private pendingTouchAim: number | null = null;
  constructor(public settings: ControlSettings) {}
  press(code: string): boolean {
    if (code === 'Mouse0') { this.pressed.add(code); return true; }
    const action = activeActions(this.settings).find(action => this.settings.bindings[action].includes(code));
    if (!action) return false;
    if (!this.pressed.has(code) && slots.includes(action as AbilitySlot) && action !== 'basic') this.cast(action as AbilitySlot);
    this.pressed.add(code);
    return true;
  }
  release(code: string): void { this.pressed.delete(code); }
  setPointer(position: Vec2): void { this.pointer = position; this.touchAim = null; }
  setTouchMovement(movement: Vec2): void { this.touchMovement = movement; this.pointer = null; }
  setTouchAim(angle: number | null): void { if (angle === null || Number.isFinite(angle)) { this.touchAim = angle; this.pointer = null; } }
  cast(slot: AbilitySlot): void { this.pendingCast = slot; this.pendingTouchAim = this.touchAim; }
  consumeCast(): void { this.pendingCast = undefined; this.pendingTouchAim = null; }
  get manualPointerAim(): boolean { return this.pressed.has('Mouse0') && this.pointer !== null; }
  get previewSlot(): AbilitySlot { return this.pendingCast ?? (['q', 'e', 'r', 'basic'] as const).find(slot => this.settings.bindings[slot].some(code => this.pressed.has(code))) ?? 'basic'; }
  clear(): void { this.pressed.clear(); this.touchMovement = { x: 0, y: 0 }; this.pointer = null; this.touchAim = null; this.consumeCast(); }
  sample(position: Vec2, previousAim: number, screenToWorld: (x: number, y: number) => Vec2): { dx: number; dy: number; aim: number; cast?: AbilitySlot; autoAim: boolean } {
    const held = (action: ControlAction): boolean => this.settings.bindings[action].some(code => this.pressed.has(code));
    const target = this.pointer ? screenToWorld(this.pointer.x, this.pointer.y) : null;
    let dx = this.touchMovement.x, dy = this.touchMovement.y;
    if (this.settings.movement === 'keyboard') {
      dx += Number(held('right')) - Number(held('left')); dy += Number(held('down')) - Number(held('up'));
    } else if (held('movePointer') && target) {
      const x = target.x - position.x, y = target.y - position.y, distance = Math.hypot(x, y);
      if (distance > 12) { dx += x / distance; dy += y / distance; }
    }
    const length = Math.hypot(dx, dy);
    if (length > 1) { dx /= length; dy /= length; }
    const touchAngle = this.pendingTouchAim ?? this.touchAim;
    const aim = this.manualPointerAim && target && Math.hypot(target.x - position.x, target.y - position.y) > 1
      ? Math.atan2(target.y - position.y, target.x - position.x) : touchAngle ?? previousAim;
    return { dx, dy, aim, autoAim: !this.manualPointerAim && touchAngle === null, cast: this.pendingCast ?? (held('basic') ? 'basic' : undefined) };
  }
}
