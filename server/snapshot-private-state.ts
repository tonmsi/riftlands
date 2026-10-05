import type { Inventory } from '../shared/items';
import { newInventory } from '../shared/items';
import { newNarrativeProgress, type NarrativeProgress } from '../shared/narrative';
import type { Account } from './store';

interface PrivateView { inventory: Inventory; narrative: NarrativeProgress; }
interface CachedView extends PrivateView { narrativeSource?: NarrativeProgress; revision: number; }
function sameInventory(a: Inventory, b: Inventory): boolean {
  return a.version === b.version && a.capacity === b.capacity && a.backpackId === b.backpackId && a.slots.length === b.slots.length
    && a.slots.every((slot, i) => slot === null ? b.slots[i] === null : slot.itemId === b.slots[i]?.itemId && slot.quantity === b.slots[i]?.quantity);
}
function copyInventory(source: Inventory): Inventory {
  const result = structuredClone(source);
  for (const slot of result.slots) if (slot) Object.freeze(slot);
  Object.freeze(result.slots); return Object.freeze(result);
}
function copyNarrative(source: NarrativeProgress): NarrativeProgress {
  const result = structuredClone(source);
  for (const quest of Object.values(result.quests)) { Object.freeze(quest.objectives); Object.freeze(quest); }
  Object.freeze(result.quests); return Object.freeze(result);
}

/** Detached immutable views, refreshed only by inventory changes or narrative revision. */
export class SnapshotPrivateState {
  private cache = new Map<string, CachedView>();
  read(id: string, account?: Account): PrivateView {
    const inventory = account?.inventory ?? newInventory(), narrative = account?.narrative ?? newNarrativeProgress();
    const revision = narrative.revision ?? 0, previous = this.cache.get(id);
    const view: CachedView = {
      inventory: previous && sameInventory(inventory, previous.inventory) ? previous.inventory : copyInventory(inventory),
      narrative: previous && previous.narrativeSource === narrative && previous.revision === revision ? previous.narrative : copyNarrative(narrative),
      narrativeSource: narrative, revision,
    };
    this.cache.set(id, view); return { inventory: view.inventory, narrative: view.narrative };
  }
  prune(players: ReadonlyMap<string, unknown>): void {
    for (const id of this.cache.keys()) if (!players.has(id)) this.cache.delete(id);
  }
}
