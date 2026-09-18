import type { AbilityDef, AbilitySlot, Vec2 } from '../shared/types';

export function joystickVector(dx: number, dy: number, radius: number): Vec2 {
  const length = Math.hypot(dx, dy);
  if (length < 8) return { x: 0, y: 0 };
  const scale = Math.max(radius, length);
  return { x: dx / scale, y: dy / scale };
}
interface MobileActions {
  enabled: () => boolean;
  ability: (slot: AbilitySlot) => AbilityDef;
  move: (vector: Vec2) => void;
  aim: (angle: number | null) => void;
  cast: (slot: AbilitySlot) => void;
}
/** Separate pointer ownership lets movement and attacks run simultaneously. */
export class MobileControls {
  readonly joystick = document.createElement('div');
  private knob = document.createElement('span');
  private movePointer: number | null = null;
  private attack: { id: number; slot: AbilitySlot; button: HTMLButtonElement; origin: Vec2 } | null = null;
  private taps = new Map<number, HTMLButtonElement>();
  aimPreview: { slot: AbilitySlot; angle: number } | null = null;
  constructor(root: HTMLElement, private actions: MobileActions) {
    this.joystick.className = 'mobile-joystick'; this.joystick.setAttribute('role', 'group'); this.joystick.setAttribute('aria-label', 'Joystick movimento');
    this.knob.className = 'joystick-knob'; this.joystick.append(this.knob); root.querySelector('.game-hud')!.append(this.joystick);
    this.joystick.addEventListener('pointerdown', event => {
      if (!this.actions.enabled() || event.pointerType === 'mouse' || this.movePointer !== null) return;
      event.preventDefault(); this.movePointer = event.pointerId; this.joystick.setPointerCapture(event.pointerId); this.move(event);
    });
    this.joystick.addEventListener('pointermove', event => { if (event.pointerId === this.movePointer) this.move(event); });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.joystick.addEventListener(name, event => {
      if ((event as PointerEvent).pointerId !== this.movePointer) return;
      this.movePointer = null; this.actions.move({ x: 0, y: 0 }); this.knob.style.transform = '';
    });
    const bar = root.querySelector<HTMLElement>('[data-ref="ability-bar"]')!;
    bar.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || !this.actions.enabled()) return;
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-slot]');
      if (!button) return;
      event.preventDefault();
      const slot = button.dataset.slot as AbilitySlot;
      if (this.actions.ability(slot).targeting === 'directional') {
        if (this.attack) return;
        this.actions.aim(null);
        this.attack = { id: event.pointerId, slot, button, origin: { x: event.clientX, y: event.clientY } };
        button.classList.add('touch-pressed');
      } else {
        if (button.getAttribute('aria-disabled') === 'true' || [...this.taps.values()].includes(button)) return;
        this.taps.set(event.pointerId, button); button.classList.add('touch-pressed');
      }
      button.setPointerCapture(event.pointerId);
    });
    bar.addEventListener('pointermove', event => {
      if (event.pointerId !== this.attack?.id) return;
      const dx = event.clientX - this.attack.origin.x, dy = event.clientY - this.attack.origin.y;
      if (Math.hypot(dx, dy) < 10) return;
      const angle = Math.atan2(dy, dx);
      this.aimPreview = { slot: this.attack.slot, angle }; this.actions.aim(angle);
      this.attack.button.style.setProperty('--aim-angle', `${angle}rad`);
      this.attack.button.classList.add('touch-aiming');
    });
    const finish = (event: PointerEvent, cancelled: boolean) => {
      if (event.pointerId === this.attack?.id) {
        const { button, slot } = this.attack;
        this.attack = null; this.aimPreview = null; button.classList.remove('touch-pressed', 'touch-aiming');
        if (!cancelled && this.actions.enabled() && button.getAttribute('aria-disabled') !== 'true') this.actions.cast(slot);
        this.actions.aim(null);
      }
      const button = this.taps.get(event.pointerId);
      if (button) {
        this.taps.delete(event.pointerId); button.classList.remove('touch-pressed');
        const rect = button.getBoundingClientRect();
        if (!cancelled && this.actions.enabled() && button.getAttribute('aria-disabled') !== 'true' && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) this.actions.cast(button.dataset.slot as AbilitySlot);
      }
    };
    bar.addEventListener('pointerup', event => finish(event, false));
    bar.addEventListener('pointercancel', event => finish(event, true));
    bar.addEventListener('lostpointercapture', event => finish(event, true));
    // Pointer gestures own touch activation; prevent the compatibility click from firing twice.
    bar.addEventListener('click', event => { if ((event as PointerEvent).pointerType === 'touch' || (event as PointerEvent).pointerType === 'pen') { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    root.addEventListener('contextmenu', event => { if (root.classList.contains('is-playing')) event.preventDefault(); });
  }
  private move(event: PointerEvent): void {
    const rect = this.joystick.getBoundingClientRect(), radius = rect.width * 0.34;
    const vector = joystickVector(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2, radius);
    this.actions.move(vector); this.knob.style.transform = `translate(${vector.x * radius}px, ${vector.y * radius}px)`;
  }
  reset(): void {
    this.actions.aim(null);
    this.movePointer = null; this.attack?.button.classList.remove('touch-pressed', 'touch-aiming');
    for (const button of this.taps.values()) button.classList.remove('touch-pressed');
    this.taps.clear(); this.attack = null; this.aimPreview = null; this.knob.style.transform = ''; this.actions.move({ x: 0, y: 0 });
  }
}
