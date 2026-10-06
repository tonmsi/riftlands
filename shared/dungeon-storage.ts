import { ACTOR_CATALOG, type ActorCatalog } from './actor-catalog';
import type { DungeonBundle } from './dungeon-install';
import type { TileKind } from './types';

const kinds = new Set(['grass', 'path', 'rock', 'water', 'bush', 'mud', 'snow', 'ice']);
export function packDraftTiles(tiles: readonly TileKind[]): [TileKind, number][] {
  const runs: [TileKind, number][] = [];
  for (const tile of tiles) { const last = runs.at(-1); if (last?.[0] === tile) last[1]++; else runs.push([tile, 1]); }
  return runs;
}
export function unpackDraftTiles(runs: unknown, count: number): TileKind[] {
  if (!Number.isInteger(count) || count < 1 || count > 9216 || !Array.isArray(runs) || runs.length > count) throw new Error('Terreno dungeon compresso non valido.');
  const tiles: TileKind[] = [];
  for (const run of runs) {
    if (!Array.isArray(run) || run.length !== 2 || !kinds.has(run[0]) || !Number.isInteger(run[1]) || run[1] <= 0 || tiles.length + run[1] > count) throw new Error('Sequenza terreno dungeon non valida.');
    for (let i = 0; i < run[1]; i++) tiles.push(run[0]);
  }
  if (tiles.length !== count) throw new Error('Numero caselle dungeon non equivalente.');
  return tiles;
}

/** Storage only: runtime and editors receive ordinary typed definitions. */
export function unpackDungeonCatalog(value: unknown, catalog: ActorCatalog = ACTOR_CATALOG): DungeonBundle[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Catalogo dungeon non valido.');
  return value.map(raw => {
    const entry = structuredClone(raw);
    if (!entry?.definition?.layout || !Array.isArray(entry.bosses)) throw new Error('Dungeon non valido.');
    const layout = entry.definition.layout;
    if (layout.tileRuns !== undefined) {
      if (!Array.isArray(layout.tileRuns) || layout.tileRuns.length > 9216) throw new Error('Terreno dungeon non valido.');
      const tiles: { x: number; y: number; kind: TileKind }[] = [], seen = new Set<string>();
      for (const run of layout.tileRuns) {
        if (!Array.isArray(run) || run.length !== 4 || !Number.isInteger(run[0]) || !Number.isInteger(run[1])
          || !Number.isInteger(run[2]) || run[2] < 1 || run[2] > 96 || !kinds.has(run[3]) || tiles.length + run[2] > 9216) throw new Error('Sequenza dungeon non valida.');
        for (let i = 0; i < run[2]; i++) {
          const x = run[0] + i, y = run[1], b = layout.bounds;
          if (!b || x < b.minTx || x > b.maxTx || y < b.minTy || y > b.maxTy || seen.has(`${x},${y}`)) throw new Error('Casella dungeon duplicata o fuori mappa.');
          seen.add(`${x},${y}`); tiles.push({ x, y, kind: run[3] });
        }
      }
      layout.tiles = tiles; delete layout.tileRuns;
    }
    if (entry.draft?.tileRuns) {
      entry.draft.tiles = unpackDraftTiles(entry.draft.tileRuns, entry.draft.width * entry.draft.height); delete entry.draft.tileRuns;
    }
    entry.bosses = entry.bosses.map((stored: any) => {
      if (stored.hp !== undefined) return stored;
      const template = catalog.bosses.find(b => b.id === stored.templateId);
      if (!template || typeof stored.id !== 'string') throw new Error(`Template boss assente: ${stored.templateId}`);
      const overrides = stored.overrides ?? {};
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)
        || ['id', 'templateId', 'dungeonId'].some(key => Object.hasOwn(overrides, key))) throw new Error('Override boss non valido.');
      const boss = { ...structuredClone(template), ...overrides, id: stored.id, templateId: template.id, dungeonId: entry.definition.id };
      if (boss.behavior?.unstuck) boss.behavior.unstuck.probeDistance = Math.max(boss.behavior.unstuck.probeDistance, boss.radius + 16);
      return boss;
    });
    for (const entity of entry.draft?.entities ?? []) if (entity.kind === 'boss' && entity.inheritRadius)
      entity.radius = catalog.bosses.find(b => b.id === entity.template)?.radius ?? entity.radius;
    delete entry.storageVersion;
    return entry as DungeonBundle;
  });
}

export function packDungeonCatalog(bundles: readonly DungeonBundle[], catalog: ActorCatalog = ACTOR_CATALOG): unknown[] {
  return bundles.map(bundle => {
    const entry: any = structuredClone(bundle);
    if (!entry.definition.layout) return entry;
    entry.storageVersion = 2;
    const layout = entry.definition.layout;
    if (layout.tiles) {
      const runs: [number, number, number, TileKind][] = [];
      for (const tile of layout.tiles) {
        const last = runs.at(-1);
        if (last && last[1] === tile.y && last[0] + last[2] === tile.x && last[3] === tile.kind) last[2]++;
        else runs.push([tile.x, tile.y, 1, tile.kind]);
      }
      layout.tileRuns = runs; delete layout.tiles;
    }
    if (entry.draft) {
      entry.draft.tileRuns = packDraftTiles(entry.draft.tiles); delete entry.draft.tiles;
    }
    entry.bosses = bundle.bosses.map(boss => {
      const template = catalog.bosses.find(b => b.id === (boss.templateId ?? boss.skin));
      if (!template) throw new Error(`Template boss assente: ${boss.templateId ?? boss.skin}`);
      const overrides: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(boss)) if (!['id', 'templateId', 'dungeonId'].includes(key)
        && JSON.stringify(value) !== JSON.stringify(template[key as keyof typeof template])) overrides[key] = value;
      return { id: boss.id, templateId: template.id, ...(Object.keys(overrides).length ? { overrides } : {}) };
    });
    return entry;
  });
}
export function serializeDungeonCatalog(bundles: readonly DungeonBundle[], catalog: ActorCatalog = ACTOR_CATALOG): string {
  return JSON.stringify(packDungeonCatalog(bundles, catalog)) + '\n';
}
