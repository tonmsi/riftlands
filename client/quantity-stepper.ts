/** Holding changes by tens, accelerating to one repeat every 200 ms. */
export const quantityRepeatInterval = (repeats: number): number => Math.max(200, 500 - Math.max(0, repeats) * 75);

export class QuantityStepper {
  private value = 0;
  private maximum = 0;
  private press?: { pointerId: number; button: HTMLButtonElement; timer?: ReturnType<typeof setTimeout>; repeats: number };
  constructor(private root: HTMLElement) {
    for (const direction of [-1, 1]) {
      const button = root.querySelector<HTMLButtonElement>(direction < 0 ? '[data-quantity-minus]' : '[data-quantity-plus]')!;
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || button.disabled) return;
        event.preventDefault(); this.cancel(); button.setPointerCapture(event.pointerId);
        this.change(direction);
        const press = this.press = { pointerId: event.pointerId, button, repeats: 0 } as NonNullable<QuantityStepper['press']>;
        const repeat = () => {
          if (this.press !== press) return;
          if (!this.change(direction * 10)) { this.cancel(); return; }
          press.timer = setTimeout(repeat, quantityRepeatInterval(++press.repeats));
        };
        press.timer = setTimeout(repeat, quantityRepeatInterval(0));
      });
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, e => {
        if ((e as PointerEvent).pointerId === this.press?.pointerId) this.cancel();
      });
      button.addEventListener('pointermove', event => {
        if (event.pointerId !== this.press?.pointerId) return;
        const rect = button.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this.cancel();
      });
      // Pointer activation happens on press; keyboard/assistive activation still changes by one.
      button.addEventListener('click', event => { event.preventDefault(); if (event.detail === 0) this.change(direction); });
    }
  }
  get quantity(): number { return this.value; }
  set(value: number, maximum: number): void { this.maximum = maximum; this.value = Math.max(0, Math.min(maximum, value)); this.draw(); }
  cancel(): void { if (this.press?.timer) clearTimeout(this.press.timer); this.press = undefined; }
  private change(delta: number): boolean {
    const before = this.value; this.value = Math.max(0, Math.min(this.maximum, before + delta)); this.draw(); return this.value !== before;
  }
  private draw(): void {
    const output = this.root.querySelector('output')!;
    if (output.textContent !== String(this.value)) output.textContent = String(this.value);
    this.root.querySelector<HTMLButtonElement>('[data-quantity-minus]')!.disabled = this.value === 0;
    this.root.querySelector<HTMLButtonElement>('[data-quantity-plus]')!.disabled = this.value === this.maximum;
    this.root.querySelector<HTMLButtonElement>('[data-drop-confirm]')!.disabled = this.value === 0;
  }
}
