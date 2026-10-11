import type { Inventory } from '../shared/items';
import type { WorldDocument, WorldWarp } from '../shared/world-schema';
import { warpPosition } from '../shared/warps';
import { WARP_KEY_OPEN_MS, type WarpKeyPickup } from '../shared/warp-keys';
import type { GameplayPersistence } from './gameplay-persistence';

/** One physical key and one shared opening timer for a door, including its return. */
export class WarpKeys {
  private readonly held = new Set<string>();
  private readonly gates = new Map<string, { config: NonNullable<WorldWarp['keyGate']>; name: string }>();
  private readonly opened: Record<string, number>;
  constructor(project: WorldDocument, private readonly persistence?: GameplayPersistence) {
    this.opened = persistence ? (persistence.warpGateStates ??= {}) : {};
    for (const warp of project.warps ?? []) if (warp.keyGate && !this.gates.has(warp.keyGate.id)) {
      this.gates.set(warp.keyGate.id, { config: warp.keyGate, name: warp.name });
    }
    for (const account of persistence?.accounts.values() ?? []) {
      for (const inventory of [account.inventory, ...Object.values(account.characters ?? {}).map(character => character?.inventory)]) {
        for (const key of inventory?.warpKeys ?? []) this.held.add(key.id);
      }
    }
  }
  expire(now: number): void {
    let changed = false;
    for (const id of Object.keys(this.opened)) if (this.opened[id] <= now) { delete this.opened[id]; changed = true; }
    if (changed) this.save();
  }
  pickups(mapId: string, now: number): WarpKeyPickup[] {
    return [...this.gates].filter(([id, gate]) => gate.config.mapId === mapId && !this.held.has(id) && !(this.opened[id] > now))
      .map(([id, gate]) => ({ id, name: `Chiave · ${gate.name}`.slice(0, 160), ...warpPosition(gate.config.position) }));
  }
  collect(id: string, inventory: Inventory, mapId: string, actor: { x: number; y: number }, range: number, now: number): boolean {
    const key = this.pickups(mapId, now).find(key => key.id === id);
    if (!key || Math.hypot(actor.x - key.x, actor.y - key.y) > range) return false;
    const previous = inventory.warpKeys;
    this.held.add(id); inventory.warpKeys = [...(previous ?? []), { id, name: key.name }];
    try { this.save(); } catch (error) { inventory.warpKeys = previous; this.held.delete(id); throw error; }
    return true;
  }
  canPass(warp: WorldWarp, inventory: Inventory, now: number): boolean {
    return !warp.keyGate || this.opened[warp.keyGate.id] > now || !!inventory.warpKeys?.some(key => key.id === warp.keyGate!.id);
  }
  open(warp: WorldWarp, inventory: Inventory, now: number): void {
    if (!warp.keyGate || this.opened[warp.keyGate.id] > now) return;
    if (!this.canPass(warp, inventory, now)) throw new Error('Serve la chiave di questo passaggio.');
    const previous = inventory.warpKeys;
    inventory.warpKeys = inventory.warpKeys?.filter(key => key.id !== warp.keyGate!.id);
    this.held.delete(warp.keyGate.id); this.opened[warp.keyGate.id] = now + WARP_KEY_OPEN_MS;
    try { this.save(); } catch (error) { inventory.warpKeys = previous; this.held.add(warp.keyGate.id); delete this.opened[warp.keyGate.id]; throw error; }
  }
  views(now: number) { return [...this.gates.keys()].map(id => ({ id, openedUntil: this.opened[id] > now ? this.opened[id] : 0 })); }
  private save(): void { this.persistence?.touch(); this.persistence?.flush(); }
}
