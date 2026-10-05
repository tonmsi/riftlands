interface Popup {
  surface: HTMLElement;
  open: () => boolean;
  close: () => void;
}

/** One dismissal policy for mouse, touch, keyboard and native dialog backdrops. */
export class PopupManager {
  private popups: Popup[] = [];
  constructor(private root: HTMLElement) {
    root.addEventListener('pointerdown', event => {
      const target = event.target as Element;
      const open = this.popups.filter(popup => popup.open());
      const inside = open.some(({ surface }) => {
        if (!surface.contains(target)) return false;
        if (!(surface instanceof HTMLDialogElement)) return true;
        const bounds = surface.getBoundingClientRect();
        return event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      });
      if (inside || target.closest('[data-popup-trigger],.inventory-panel,.mobile-joystick,.combat-hud,.character-effects')) return;
      this.dismiss();
    }, true);
    root.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.key !== 'Escape' || !this.popups.some(popup => popup.open())) return;
      event.preventDefault(); this.dismiss();
    });
  }
  register(surface: HTMLElement, open: () => boolean, close: () => void, trigger?: HTMLElement): void {
    if (trigger) trigger.dataset.popupTrigger = '';
    this.popups.push({ surface, open, close });
  }
  dismiss(): void {
    for (const popup of this.popups) if (popup.open()) popup.close();
  }
}
