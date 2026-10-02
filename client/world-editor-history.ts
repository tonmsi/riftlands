import type { WorldDocument } from '../shared/world-schema';

/** Full transactions, bounded by bytes as well as count. A brush stroke is one undo operation. */
export class WorldEditorHistory {
  private past: string[] = [];
  private future: string[] = [];
  private bytes = 0;
  get canUndo(): boolean { return !!this.past.length; }
  get canRedo(): boolean { return !!this.future.length; }
  commit(before: WorldDocument, after: WorldDocument): boolean {
    const previous = JSON.stringify(before); if (previous === JSON.stringify(after)) return false;
    this.past.push(previous); this.bytes += previous.length * 2; this.future = [];
    while (this.past.length > 1 && (this.past.length > 40 || this.bytes > 24_000_000)) this.bytes -= this.past.shift()!.length * 2;
    return true;
  }
  undo(current: WorldDocument): WorldDocument {
    const previous = this.past.pop(); if (!previous) return current;
    this.bytes -= previous.length * 2; this.future.push(JSON.stringify(current)); return JSON.parse(previous);
  }
  redo(current: WorldDocument): WorldDocument {
    const next = this.future.pop(); if (!next) return current;
    const previous = JSON.stringify(current); this.past.push(previous); this.bytes += previous.length * 2; return JSON.parse(next);
  }
  clear(): void { this.past = []; this.future = []; this.bytes = 0; }
}
