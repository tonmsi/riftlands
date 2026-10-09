/** Touch ranges defer edits until a tap ends or horizontal drag intent is clear.
 * pan-y leaves vertical scrolling and inertia to the browser. */
export function installScrollSafeRanges(panel: HTMLElement): void {
  let lastScroll = -Infinity;
  window.addEventListener('scroll', event => {
    if (event.target === document || event.target instanceof Element && event.target.contains(panel)) lastScroll = performance.now();
  }, { capture: true, passive: true });
  for (const input of panel.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
    input.style.touchAction = 'pan-y';
    // Native ranges can change on touchstart even when pointerdown is cancelled.
    // A transparent touch surface lets us decide intent before the range is hit.
    const wrapper = document.createElement('span'), surface = document.createElement('span');
    wrapper.style.cssText = 'position:relative;display:block;width:100%;min-width:0';
    surface.style.cssText = 'position:absolute;inset:0;touch-action:pan-y';
    surface.setAttribute('aria-hidden', 'true');
    input.before(wrapper); wrapper.append(input, surface);
    const touch = matchMedia('(any-pointer:coarse)');
    const refresh = () => { surface.hidden = !touch.matches; };
    touch.addEventListener('change', refresh); refresh();
    let gesture: { id: number; x: number; y: number; intent: 'pending' | 'scroll' | 'drag'; changed: boolean } | undefined;
    const update = (x: number) => {
      const rect = input.getBoundingClientRect(), min = Number(input.min || 0), max = Number(input.max || 100);
      // Leave half a native thumb at each end of the track.
      const inset = Math.min(10, rect.width / 4);
      let fraction = Math.max(0, Math.min(1, (x - rect.left - inset) / (rect.width - inset * 2)));
      if (getComputedStyle(input).direction === 'rtl') fraction = 1 - fraction;
      const step = input.step === 'any' ? 0 : Number(input.step || 1);
      const value = min + fraction * (max - min);
      const next = Math.max(min, Math.min(max, step ? min + Math.round((value - min) / step) * step : value));
      if (Number(input.value) === next) return;
      input.value = String(next); gesture!.changed = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    surface.addEventListener('pointerdown', event => {
      if (input.disabled || !event.isPrimary) return;
      event.preventDefault();
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, intent: event.pointerType === 'mouse' ? 'drag' : performance.now() - lastScroll < 180 ? 'scroll' : 'pending', changed: false };
      surface.setPointerCapture(event.pointerId);
      if (gesture.intent === 'drag') { input.focus({ preventScroll: true }); update(event.clientX); }
    });
    surface.addEventListener('pointermove', event => {
      if (event.pointerId !== gesture?.id) return;
      const dx = Math.abs(event.clientX - gesture.x), dy = Math.abs(event.clientY - gesture.y);
      if (gesture.intent === 'pending' && Math.max(dx, dy) >= 10) gesture.intent = dx > dy * 1.2 ? 'drag' : 'scroll';
      if (gesture.intent === 'drag') { event.preventDefault(); input.focus({ preventScroll: true }); update(event.clientX); }
    });
    surface.addEventListener('pointerup', event => {
      if (event.pointerId !== gesture?.id) return;
      event.preventDefault();
      // Check final travel too: a browser can coalesce move events before release.
      if (gesture.intent === 'pending' && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 10) { input.focus({ preventScroll: true }); update(event.clientX); }
      if (gesture.changed) input.dispatchEvent(new Event('change', { bubbles: true }));
      gesture = undefined;
    });
    surface.addEventListener('click', event => event.preventDefault());
    for (const name of ['pointercancel', 'lostpointercapture']) surface.addEventListener(name, () => { gesture = undefined; });
  }
}
