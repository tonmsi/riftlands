import type { AbilitySlot } from '../../shared/types';
export const SLOTS: AbilitySlot[] = ['basic', 'q', 'e', 'r'];
export function textElement(tag: string, className: string, text: string): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

/** Each view owns its DOM references; state is never shared through this helper. */
export class UIRefs {
  private readonly nodes = new Map<string, HTMLElement>();
  constructor(...roots: HTMLElement[]) {
    for (const root of roots) {
      if (root.dataset.ref) this.nodes.set(root.dataset.ref, root);
      root.querySelectorAll<HTMLElement>('[data-ref]').forEach(node => this.nodes.set(node.dataset.ref!, node));
    }
  }
  set(name: string, node: HTMLElement): void { this.nodes.set(name, node); }
  get(name: string): HTMLElement {
    const node = this.nodes.get(name);
    if (!node) throw new Error('Missing UI reference: ' + name);
    return node;
  }
  write(name: string, value: string): void { const node = this.get(name); if (node.textContent !== value) node.textContent = value; }
  fill(name: string, fraction: number): void { this.get(name).style.width = String(Math.max(0, Math.min(1, fraction)) * 100) + '%'; }
}
