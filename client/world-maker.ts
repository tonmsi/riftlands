import './world-maker.css';
import { field, tools, terrains, worldMakerLayout } from './world-maker-layout';
import { drawWorldEditorMap, drawAssetGrid as renderAssetGrid, assetView as assetGridView } from './world-editor-canvas';
import { WORLD_DOCUMENT } from '../shared/world-content';
import { World } from '../shared/world';
import { coordinateHash } from '../shared/coordinate-random';
import type { TileKind, Vec2 } from '../shared/types';
import { NPC_CATALOG } from '../shared/npcs';
import { DUNGEON_DEFINITIONS, type DungeonDefinition } from '../shared/dungeons';
import { worldDungeons, validateWorld } from '../shared/world-validation';
import { shapeBounds } from '../shared/world-authoring';
import { newWorldAsset, parseWorldDocument, resizeWorldAsset, worldAssetVisual, DEFAULT_ASSET_FADE, WORLD_TERRAINS, type WorldDocument, type WorldAsset, type WorldZone, type AssetCell } from '../shared/world-schema';
import { brushTiles, strokeTiles, WorldBrush, forkWorldDocument } from '../shared/world-editing';
import { compactWorldTiles, worldTileMetrics, worldDocumentsEqual } from '../shared/world-tiles';
import { WorldAssetArt } from './world-asset-art';
import { WorldEditorHistory } from './world-editor-history';
import { WorldAssetCatalog } from './world-asset-catalog';
import { AssetGridCamera } from './world-asset-view';
import { loadWorldCheckpoint, saveWorldCheckpoint } from './world-editor-storage';
const root = document.getElementById('world-maker')!;
root.innerHTML = worldMakerLayout;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const val = (id: string) => (el(id) as HTMLInputElement | HTMLSelectElement).value;
const num = (id: string) => Number(val(id));
const set = (id: string, value: unknown) => { (el(id) as HTMLInputElement | HTMLSelectElement).value = String(value ?? ''); };
const on = (id: string, action: () => void | Promise<void>) => el(id).addEventListener('click', () => { void Promise.resolve().then(async () => { await settleGesture(); return action(); }).catch(report); });
const report = (e: unknown) => { el('status').textContent = e instanceof Error ? e.message : String(e); };
const status = (s: string) => { el('status').textContent = s; };
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
let draft = forkWorldDocument(compactWorldTiles(WORLD_DOCUMENT)), catalog: readonly DungeonDefinition[] = DUNGEON_DEFINITIONS, token = '', revision = '', installedRevision = '', ready = false;
let world: World, tool = 'select', activeAsset = draft.assets[0]?.id ?? '', selected: {
    kind: 'placement' | 'npc' | 'dungeon' | 'zone';
    id: string;
} | null = null;
let worldDirty = true, framePending = false, dirty = false, checkpointQueue = Promise.resolve();
let animationTimer: ReturnType<typeof setTimeout> | undefined;
let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
let pendingCheckpoint: { document: WorldDocument; revision: string } | undefined;
let compatibleRevisions: string[] = [];
const history = new WorldEditorHistory(), canvas = el<HTMLCanvasElement>('map');
const assetCanvas = el<HTMLCanvasElement>('asset-grid');
const assetCamera = new AssetGridCamera();
let cameraAsset = '';
const assetCatalog = new WorldAssetCatalog(el('asset-list'), id => {
    void settleGesture().then(() => { activeAsset = id; selected = null; selectTool('asset'); refresh(); }).catch(report);
});
const art = new WorldAssetArt(() => schedule());
let view = { x: 0, y: 0, scale: 24 }, pointerTile: Vec2 | null = null;
let gesture: {
    pointer: number;
    before: WorldDocument;
    start: Vec2;
    last: Vec2;
    pan?: Vec2;
    cell?: boolean;
    tool: string;
    mass: boolean;
    brush?: WorldBrush;
    pending?: Vec2[];
    cursor?: number;
    ending?: boolean;
    settings?: { radius: number; density: number; terrain: TileKind; asset?: WorldAsset };
} | null = null;
const keys = new Set<string>();
set('brush-radius', 1);
set('brush-density', 100);
function ensureWorld(): void {
  const updated = gesture?.brush?.flushTiles() ?? [];
  if (updated.length && world && !worldDirty) world.updateAuthoredTiles(draft, updated);
  if (worldDirty) {
    world = new World(draft.seed, 96, 'world', draft, worldDungeons(draft, catalog));
    worldDirty = false;
} }
function schedule(rebuild = false): void { worldDirty ||= rebuild; if (!framePending) {
    framePending = true;
    requestAnimationFrame(() => {
        framePending = false;
        const g = gesture;
        if (g?.pending) {
            const start = performance.now();
            while ((g.cursor ?? 0) < g.pending.length && performance.now() - start < 6) paint(g.pending[g.cursor!++]);
            if (g.cursor === g.pending.length) { g.pending = []; g.cursor = 0; if (g.ending) finishGesture(); }
            else schedule();
        }
        draw(); drawAssetGrid();
    });
} }
function flushCheckpoint(): Promise<void> {
    if (checkpointTimer !== undefined) clearTimeout(checkpointTimer);
    checkpointTimer = undefined;
    const snapshot = pendingCheckpoint;
    pendingCheckpoint = undefined;
    if (!snapshot) return checkpointQueue;
    checkpointQueue = checkpointQueue.catch(() => { }).then(() => saveWorldCheckpoint(snapshot));
    void checkpointQueue.then(() => { if (dirty)
        el('save-state').textContent = 'Bozza salvata · da applicare'; }).catch(() => { el('save-state').textContent = 'Salvataggio fallito · esporta'; });
    return checkpointQueue;
}
function checkpoint(immediate = false): Promise<void> {
    pendingCheckpoint = { document: forkWorldDocument(draft), revision };
    if (immediate) return flushCheckpoint();
    if (checkpointTimer !== undefined) clearTimeout(checkpointTimer);
    checkpointTimer = setTimeout(() => { void flushCheckpoint(); }, 350);
    return checkpointQueue;
}
window.addEventListener('pagehide', () => { void flushCheckpoint(); });
function commit(before: WorldDocument, nativeTiles = false): void {
    try {
        if (nativeTiles) {
            const counts = worldTileMetrics(draft);
            if (counts.cells > 20_000_000 || counts.runs > 2_000_000 || draft.tileChunks!.length > 100_000) throw new Error('Budget terreno raggiunto: annulla o riduci gli interventi.');
        } else draft = parseWorldDocument(draft);
    }
    catch (e) {
        draft = before;
        schedule(true);
        refresh();
        report(e);
        return;
    }
    if (history.commit(before, draft)) {
        dirty = true;
        checkpoint();
    }
    refresh();
    schedule(true);
}
function change(action: () => void): void {
    if (!ready)
        return;
    const before = draft;
    draft = forkWorldDocument(draft);
    try {
        action();
        commit(before);
    }
    catch (e) {
        draft = before;
        refresh();
        schedule(true);
        report(e);
    }
}
function selectTool(next: string): void { tool = next; root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === next))); el('tool-label').textContent = tools.find(t => t[0] === next)?.[2] ?? next; schedule(); }
root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => b.onclick = () => selectTool(b.dataset.tool!));
function active(): WorldAsset | undefined { return draft.assets.find(a => a.id === activeAsset); }
function palette(): void {
    assetCatalog.update(draft.assets, activeAsset, val('asset-search'));
}
function refresh(): void {
    if (!active())
        activeAsset = draft.assets[0]?.id ?? '';
    palette();
    set('seed', draft.seed);
    el<HTMLButtonElement>('undo').disabled = !history.canUndo;
    el<HTMLButtonElement>('redo').disabled = !history.canRedo;
    el<HTMLButtonElement>('apply-world').disabled = !token || !ready;
    const cells = worldTileMetrics(draft).cells;
    el('map-info').textContent = `${cells.toLocaleString('it-IT')} celle · ${draft.placements.length} asset · ${draft.zones.length} zone`;
    const dungeonSelect = el<HTMLSelectElement>('dungeon'), previous = dungeonSelect.value;
    dungeonSelect.replaceChildren(...catalog.map(d => new Option(d.name, d.id)));
    dungeonSelect.value = catalog.some(d => d.id === previous) ? previous : catalog[0]?.id ?? '';
    const zone = selected?.kind === 'zone' ? draft.zones.find(z => z.id === selected!.id) : undefined;
    el('zone-inspector').hidden = !zone;
    if (zone)
        refreshZone(zone);
    el('selection-inspector').hidden = !selected || selected.kind === 'zone';
    if (selected && selected.kind !== 'zone')
        refreshSelection();
    el('asset-inspector').hidden = !!selected || !active();
    if (!selected && active())
        refreshAsset(active()!);
    el('zone-list').replaceChildren(...draft.zones.map(z => { const b = document.createElement('button'); b.textContent = `${z.name} · ${z.priority}`; b.onclick = () => { selected = { kind: 'zone', id: z.id }; const bounds = shapeBounds(z.shape); centerAt((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2); refresh(); }; return b; }));
}
function refreshAsset(a: WorldAsset): void {
    const visual = worldAssetVisual(a);
    set('asset-visual', visual.kind === 'fire' ? visual.style : 'image');
    const fade = a.fade ?? DEFAULT_ASSET_FADE;
    set('fade-opacity', Math.round(fade.opacity * 100_000) / 1000); set('fade-feather', fade.feather); set('fade-duration', fade.durationMs);
    set('asset-name', a.name);
    set('asset-group', a.group);
    el('asset-groups').replaceChildren(...[...new Set(draft.assets.flatMap(a => a.group ? [a.group] : []))].sort().map(group => new Option(group)));
    el('asset-preview-title').textContent = `Celle · ${a.name}`;
    set('asset-width', a.width);
    set('asset-height', a.height);
    set('asset-layer', a.layer);
    set('asset-pivot', a.pivot.y);
    input('gen-enabled').checked = a.generation.enabled;
    set('gen-category', a.generation.category);
    set('gen-temp-min', a.generation.temperature[0]);
    set('gen-temp-max', a.generation.temperature[1]);
    set('gen-moist-min', a.generation.moisture[0]);
    set('gen-moist-max', a.generation.moisture[1]);
    set('gen-density', a.generation.density * 100);
    set('gen-spacing', a.generation.spacing);
    el('gen-terrains').replaceChildren(...WORLD_TERRAINS.map(t => { const l = document.createElement('label'); l.className = 'check'; const c = document.createElement('input'); c.type = 'checkbox'; c.value = t; c.checked = a.generation.terrains.includes(t); l.append(c, terrains[t].name); return l; }));
}
function refreshZone(z: WorldZone): void {
    set('zone-name', z.name);
    set('zone-priority', z.priority);
    set('zone-shape', z.shape.kind);
    set('zone-x', z.shape.x);
    set('zone-y', z.shape.y);
    set('zone-width', z.shape.kind === 'circle' ? z.shape.radius : z.shape.width);
    set('zone-height', z.shape.kind === 'rect' ? z.shape.height : '');
    set('zone-temperature', z.temperature);
    set('zone-moisture', z.moisture);
    set('zone-pvp', z.pvp);
    set('zone-generation', z.generateAssets);
    set('zone-arena', z.arenaId);
    input('zone-npcs').checked = !!z.npcs;
    set('zone-density', z.npcs ? z.npcs.density * 100 : 100);
    set('zone-limit', z.npcs?.maxPerChunk ?? 3);
    for (const k of ['slime', 'wisp', 'sentinel'] as const)
        set(`zone-${k}`, z.npcs?.weights[k] ?? (k === 'slime' ? 100 : 0));
}
function selectionEntity(): any {
    if (!selected)
        return;
    return selected.kind === 'placement' ? draft.placements.find(p => p.id === selected!.id) : selected.kind === 'npc' ? draft.npcs.find(n => n.id === selected!.id)
        : selected.kind === 'dungeon' ? draft.dungeons.find(d => d.dungeonId === selected!.id) ?? (() => { const d = worldDungeons(draft, catalog).find(d => d.id === selected!.id); return d ? { dungeonId: d.id, x: d.layout.bounds.minTx, y: d.layout.bounds.minTy } : undefined; })() : undefined;
}
function refreshSelection(): void {
    const e = selectionEntity();
    if (!e) {
        selected = null;
        el('selection-inspector').hidden = true;
        return;
    }
    el('selection-title').textContent = selected?.kind === 'dungeon' ? 'Posizione dungeon' : selected?.kind === 'npc' ? 'NPC manuale' : 'Istanza asset';
    el('selection-fields').innerHTML = `<div class="pair">${field('entity-x', 'X · celle')}${field('entity-y', 'Y · celle')}</div>${selected?.kind === 'npc' ? field('entity-level', 'Livello') : ''}`;
    set('entity-x', e.x);
    set('entity-y', e.y);
    if (selected?.kind === 'npc')
        set('entity-level', e.level);
    if (selected?.kind === 'placement') {
        const b = document.createElement('button');
        b.textContent = 'Modifica asset nel catalogo';
        b.onclick = () => { activeAsset = e.assetId; selected = null; refresh(); schedule(); };
        el('selection-fields').append(b);
    }
}
function draw(): void {
    ensureWorld();
    const animated = drawWorldEditorMap(canvas, world, draft, view, art, { grid: input('show-grid').checked, cells: input('show-cells').checked,
        zones: input('show-zones').checked, npcs: input('show-npcs').checked, selected, gesture, pointerTile, tool, activeAsset: active() });
    if ((animated || (!el('asset-inspector').hidden && active() && worldAssetVisual(active()!).kind === 'fire')) && animationTimer === undefined)
        animationTimer = setTimeout(() => { animationTimer = undefined; schedule(); }, 33);
    el('zoom-label').textContent = Math.round(view.scale / 24 * 100) + '%';
}
function drawAssetGrid(): void {
    if (el('asset-inspector').hidden) return;
    assetView();
    renderAssetGrid(assetCanvas, art, active(), input('preview-fade').checked, assetCamera);
    el('asset-zoom-label').textContent = `${Math.round(assetCamera.zoom * 100)}%`;
}
function assetView() {
    if (cameraAsset !== activeAsset) { assetCamera.fit(); cameraAsset = activeAsset; }
    return assetGridView(assetCanvas, active(), assetCamera);
}
function zoomAsset(factor: number, x?: number, y?: number): void {
    const v = assetView(); if (!v) return;
    const r = assetCanvas.getBoundingClientRect();
    assetCamera.zoomAt(factor, x ?? r.width / 2, y ?? r.height / 2, r.width, r.height, v.a.columns, v.a.rows);
    schedule();
}
function position(event: PointerEvent): Vec2 { const r = canvas.getBoundingClientRect(); return { x: Math.floor((event.clientX - r.left - view.x) / view.scale), y: Math.floor((event.clientY - r.top - view.y) / view.scale) }; }
function centerAt(x: number, y: number): void { const r = canvas.getBoundingClientRect(); view.x = r.width / 2 - x * view.scale; view.y = r.height / 2 - y * view.scale; schedule(); }
function zoom(factor: number, x?: number, y?: number): void { const r = canvas.getBoundingClientRect(); x ??= r.width / 2; y ??= r.height / 2; const next = Math.max(.75, Math.min(96, view.scale * factor)); view.x = x - (x - view.x) * next / view.scale; view.y = y - (y - view.y) * next / view.scale; view.scale = next; schedule(); }
function selectAt(p: Vec2): void {
    ensureWorld();
    const n = draft.npcs.find(n => n.x === p.x && n.y === p.y);
    const placements = world.authoring.placements.query({ left: p.x, top: p.y, right: p.x + 1, bottom: p.y + 1 });
    const asset = placements.at(-1), dungeon = world.dungeons.find(d => p.x >= d.layout.bounds.minTx && p.x <= d.layout.bounds.maxTx && p.y >= d.layout.bounds.minTy && p.y <= d.layout.bounds.maxTy);
    const zone = world.authoring.zonesAt(p.x + .5, p.y + .5)[0];
    selected = n ? { kind: 'npc', id: n.id } : asset ? { kind: 'placement', id: asset.id } : dungeon ? { kind: 'dungeon', id: dungeon.id } : zone ? { kind: 'zone', id: zone.id } : null;
    refresh();
    schedule();
}
function paint(p: Vec2): void {
    if (!gesture)
        return;
    const radius = gesture.settings?.radius ?? Math.max(0, Math.min(16, Math.round(num('brush-radius'))));
    const asset = gesture.settings?.asset;
    const points = gesture.tool === 'asset' && !gesture.mass ? [p] : brushTiles(p, radius);
    for (const q of points) {
        if (Math.abs(q.x) > 10_000_000 || Math.abs(q.y) > 10_000_000) continue;
        if (!gesture.brush!.visit(q))
            continue;
        if (gesture.tool === 'asset' && coordinateHash(q.x, q.y, draft.seed + gesture.before.placements.length + 2001) >= (gesture.settings?.density ?? 1))
            continue;
        const dungeon = world.dungeons.some(d => q.x >= d.layout.bounds.minTx && q.x <= d.layout.bounds.maxTx && q.y >= d.layout.bounds.minTy && q.y <= d.layout.bounds.maxTy);
        if (dungeon && ['terrain', 'restore', 'asset', 'erase'].includes(gesture.tool))
            continue;
        if (gesture.tool === 'terrain')
            gesture.brush!.tile(q, { terrain: gesture.settings!.terrain, suppressAssets: true });
        else if (gesture.tool === 'restore')
            gesture.brush!.tile(q);
        else if (gesture.tool === 'erase')
            gesture.brush!.erase(q);
        else if (gesture.tool === 'asset' && asset)
            gesture.brush!.stamp(asset, q, uid('asset'));
    }
    schedule(gesture.tool === 'asset' || gesture.tool === 'erase');
}
canvas.addEventListener('pointerdown', event => {
    if (!ready || gesture)
        return;
    canvas.focus();
    const p = position(event);
    ensureWorld();
    if (event.button === 1 || event.button === 2 || keys.has('Space')) {
        gesture = { pointer: event.pointerId, before: draft, start: p, last: p, pan: { x: event.clientX, y: event.clientY }, tool, mass: false };
        canvas.setPointerCapture(event.pointerId);
        return;
    }
    if (tool === 'select') {
        selectAt(p);
        return;
    }
    const before = draft;
    const tilesOnly = tool === 'terrain' || tool === 'restore';
    draft = forkWorldDocument(draft, tilesOnly);
    gesture = { pointer: event.pointerId, before, start: p, last: p, tool, mass: event.ctrlKey || input('mass').checked, brush: new WorldBrush(draft, tilesOnly) };
    gesture.settings = { radius: Math.max(0, Math.min(16, Math.round(num('brush-radius')))), density: Math.max(0, Math.min(1, num('brush-density') / 100)), terrain: val('terrain') as TileKind, asset: active() };
    canvas.setPointerCapture(event.pointerId);
    if (tool === 'npc') {
        if (!draft.npcs.some(n => n.x === p.x && n.y === p.y))
            draft.npcs.push({ ...p, id: uid('npc'), npcKind: val('npc') as keyof typeof NPC_CATALOG, level: 1 });
    }
    else if (tool === 'dungeon') {
        const dungeonId = val('dungeon');
        if (dungeonId) {
            const existing = draft.dungeons.find(d => d.dungeonId === dungeonId);
            if (existing)
            Object.assign(existing, p, { enabled: true });
            else
                draft.dungeons.push({ ...p, dungeonId });
            selected = { kind: 'dungeon', id: dungeonId };
        }
    }
    else if (tool === 'spawn')
        draft.spawn = p;
    else if (tool !== 'zone')
        paint(p);
    schedule(true);
});
canvas.addEventListener('pointermove', event => {
    pointerTile = position(event);
    el('coordinates').textContent = `X ${pointerTile.x} · Y ${pointerTile.y}`;
    if (!gesture) {
        schedule();
        return;
    }
    if (gesture.pointer !== event.pointerId)
        return;
    if (gesture.ending) return;
    if (gesture.pan) {
        view.x += event.clientX - gesture.pan.x;
        view.y += event.clientY - gesture.pan.y;
        gesture.pan = { x: event.clientX, y: event.clientY };
        schedule();
        return;
    }
    if (!['zone', 'npc', 'dungeon', 'spawn'].includes(gesture.tool) && (gesture.tool !== 'asset' || gesture.mass))
        { gesture.pending ??= []; gesture.cursor ??= 0; gesture.pending.push(...strokeTiles(gesture.last, pointerTile)); }
    gesture.last = pointerTile;
    schedule();
});
function finishGesture(event?: PointerEvent, cancel = false): void {
    if (!gesture || (event && gesture.pointer !== event.pointerId))
        return;
    const g = gesture;
    if (!cancel && g.pending && (g.cursor ?? 0) < g.pending.length) { g.ending = true; schedule(); return; }
    g.brush?.flushTiles();
    if (cancel) {
        draft = g.before;
        gesture = null;
        refresh();
        schedule(true);
        return;
    }
    if (g.tool === 'zone' && !g.pan) {
        const shape = { kind: 'rect' as const, x: Math.min(g.start.x, g.last.x), y: Math.min(g.start.y, g.last.y), width: Math.abs(g.start.x - g.last.x) + 1, height: Math.abs(g.start.y - g.last.y) + 1 };
        const z: WorldZone = { id: uid('zone'), name: 'Nuova zona', priority: 20, shape };
        const template = val('zone-template');
        if (template === 'safe')
            z.pvp = false;
        if (template === 'pvp')
            z.pvp = true;
        if (template === 'arena') {
            z.arenaId = 'arena-1';
            z.pvp = false;
            z.generateAssets = false;
        }
        if (template === 'population')
            z.npcs = { density: 1, maxPerChunk: 3, weights: { slime: 100, wisp: 0, sentinel: 0 } };
        draft.zones.push(z);
        selected = { kind: 'zone', id: z.id };
    }
    gesture = null;
    if (!g.pan)
        commit(g.before, !!draft.tileChunks && (g.tool === 'terrain' || g.tool === 'restore'));
    else
        schedule();
}
async function settleGesture(): Promise<void> {
    if (gesture) finishGesture();
    while (gesture?.ending) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}
canvas.addEventListener('pointerup', event => finishGesture(event));
canvas.addEventListener('pointercancel', event => finishGesture(event, true));
canvas.addEventListener('lostpointercapture', event => { if (gesture && !gesture.cell && gesture.pointer === event.pointerId)
    { if (!gesture.ending) finishGesture(event, true); } });
canvas.addEventListener('pointerleave', () => { pointerTile = null; schedule(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', event => { event.preventDefault(); if (gesture && !gesture.pan) return; const r = canvas.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - r.left, event.clientY - r.top); }, { passive: false });
function paintCell(event: PointerEvent): void { const v = assetView(); if (!v || !gesture?.cell || gesture.pan || gesture.pointer !== event.pointerId)
    return; const r = assetCanvas.getBoundingClientRect(), col = Math.floor((event.clientX - r.left - v.x) / v.s), row = Math.floor((event.clientY - r.top - v.y) / v.s); if (col < 0 || row < 0 || col >= v.a.columns || row >= v.a.rows)
    return; v.a.cells[row * v.a.columns + col] = { blocked: val('cell-blocked') === 'true', visibility: val('cell-visibility') as AssetCell['visibility'] }; schedule(true); }
assetCanvas.addEventListener('pointerdown', e => {
    if (!ready || gesture) return;
    assetCanvas.focus();
    const before = draft, pan = e.button === 1 || e.button === 2 || keys.has('Space');
    if (!pan) draft = forkWorldDocument(draft);
    gesture = { pointer: e.pointerId, before, start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, tool: 'cell', mass: false, cell: true, ...(pan ? { pan: { x: e.clientX, y: e.clientY } } : {}) };
    assetCanvas.setPointerCapture(e.pointerId); paintCell(e);
});
assetCanvas.addEventListener('pointermove', e => {
    if (gesture?.cell && gesture.pan && gesture.pointer === e.pointerId) {
        assetCamera.pan(e.clientX - gesture.pan.x, e.clientY - gesture.pan.y);
        gesture.pan = { x: e.clientX, y: e.clientY }; schedule();
    } else paintCell(e);
});
assetCanvas.addEventListener('pointerup', e => finishGesture(e));
assetCanvas.addEventListener('pointercancel', e => finishGesture(e, true));
assetCanvas.addEventListener('lostpointercapture', e => { if (gesture?.cell) finishGesture(e, true); });
assetCanvas.addEventListener('contextmenu', e => e.preventDefault());
assetCanvas.addEventListener('wheel', e => { e.preventDefault(); if (gesture) return; const r = assetCanvas.getBoundingClientRect(); zoomAsset(Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
on('asset-zoom-in', () => zoomAsset(1.3));
on('asset-zoom-out', () => zoomAsset(1 / 1.3));
on('asset-fit', () => { assetCamera.fit(); schedule(); });
const previewDialog = el<HTMLDialogElement>('asset-preview-dialog');
on('asset-expand', () => {
    if (previewDialog.open) { previewDialog.close(); return; }
    el('asset-preview-slot').append(el('asset-preview')); el('asset-expand').textContent = 'Riduci';
    previewDialog.showModal(); schedule();
});
on('asset-preview-close', () => previewDialog.close());
previewDialog.addEventListener('cancel', () => finishGesture(undefined, true));
previewDialog.addEventListener('close', () => { finishGesture(undefined, true); el('asset-preview-home').append(el('asset-preview')); el('asset-expand').textContent = 'Ingrandisci'; schedule(); });
on('asset-update', () => change(() => { const a = active()!; resizeWorldAsset(a, num('asset-width'), num('asset-height')); a.name = val('asset-name').trim(); const group = val('asset-group').trim(); if (group) a.group = group; else delete a.group; assetCatalog.reveal(a); a.layer = val('asset-layer') as 'ground' | 'object'; a.pivot.y = num('asset-pivot'); a.fade = { opacity: num('fade-opacity') / 100, feather: num('fade-feather'), durationMs: num('fade-duration') }; a.visual = val('asset-visual') === 'image' ? { kind: 'image' } : { kind: 'fire', style: val('asset-visual') as 'brazier' | 'campfire' }; }));
input('asset-width').addEventListener('input', () => { const a = active(); if (a && input('keep-ratio').checked)
    set('asset-height', Math.round(num('asset-width') * a.height / a.width * 1000) / 1000); });
input('asset-height').addEventListener('input', () => { const a = active(); if (a && input('keep-ratio').checked)
    set('asset-width', Math.round(num('asset-height') * a.width / a.height * 1000) / 1000); });
on('fill-cells', () => change(() => { const a = active()!; a.cells = a.cells.map(() => ({ blocked: val('cell-blocked') === 'true', visibility: val('cell-visibility') as AssetCell['visibility'] })); }));
on('asset-fade-update', () => change(() => { active()!.fade = { opacity: num('fade-opacity') / 100, feather: num('fade-feather'), durationMs: num('fade-duration') }; }));
on('gen-update', () => change(() => { const a = active()!; a.generation = { enabled: input('gen-enabled').checked, category: val('gen-category').trim(), temperature: [num('gen-temp-min'), num('gen-temp-max')], moisture: [num('gen-moist-min'), num('gen-moist-max')], density: num('gen-density') / 100, spacing: num('gen-spacing'), terrains: [...el('gen-terrains').querySelectorAll<HTMLInputElement>('input:checked')].map(c => c.value as TileKind) }; }));
on('asset-delete', () => change(() => { const a = active()!; draft.placements = draft.placements.filter(p => p.assetId !== a.id); draft.assets = draft.assets.filter(other => other.id !== a.id); activeAsset = ''; }));
on('zone-update', () => change(() => { const z = draft.zones.find(z => z.id === selected?.id)!; z.name = val('zone-name').trim(); z.priority = num('zone-priority'); z.shape = val('zone-shape') === 'circle' ? { kind: 'circle', x: num('zone-x'), y: num('zone-y'), radius: num('zone-width') } : { kind: 'rect', x: num('zone-x'), y: num('zone-y'), width: num('zone-width'), height: num('zone-height') }; for (const [key, id] of [['temperature', 'zone-temperature'], ['moisture', 'zone-moisture']] as const) {
    if (val(id) === '')
        delete z[key];
    else
        z[key] = num(id);
} for (const [key, id] of [['pvp', 'zone-pvp'], ['generateAssets', 'zone-generation']] as const) {
    if (val(id) === '')
        delete z[key];
    else
        z[key] = val(id) === 'true';
} if (val('zone-arena').trim())
    z.arenaId = val('zone-arena').trim();
else
    delete z.arenaId; if (input('zone-npcs').checked)
    z.npcs = { density: num('zone-density') / 100, maxPerChunk: num('zone-limit'), weights: { slime: num('zone-slime'), wisp: num('zone-wisp'), sentinel: num('zone-sentinel') } };
else
    delete z.npcs; }));
on('zone-delete', () => change(() => { draft.zones = draft.zones.filter(z => z.id !== selected?.id); selected = null; }));
on('selection-update', () => change(() => { const e = selectionEntity(); if (!e)
    return; if (selected?.kind === 'dungeon' && !draft.dungeons.some(d => d.dungeonId === selected!.id))
    draft.dungeons.push(e); e.x = num('entity-x'); e.y = num('entity-y'); if (selected?.kind === 'npc')
    e.level = num('entity-level'); }));
on('selection-delete', () => change(() => { if (selected?.kind === 'placement')
    draft.placements = draft.placements.filter(p => p.id !== selected!.id); if (selected?.kind === 'npc')
    draft.npcs = draft.npcs.filter(n => n.id !== selected!.id); if (selected?.kind === 'dungeon') {
    const existing = draft.dungeons.find(d => d.dungeonId === selected!.id);
    if (existing) existing.enabled = false;
    else { const dungeon = catalog.find(d => d.id === selected!.id)!; draft.dungeons.push({ dungeonId: dungeon.id, x: dungeon.layout.bounds.minTx, y: dungeon.layout.bounds.minTy, enabled: false }); }
    status('Dungeon tolto dal mondo. Puoi riposizionarlo dal catalogo.');
} selected = null; }));
on('seed-update', () => change(() => { draft.seed = num('seed'); }));
on('undo', () => { draft = history.undo(draft); dirty = true; checkpoint(); selected = null; refresh(); schedule(true); });
on('redo', () => { draft = history.redo(draft); dirty = true; checkpoint(); selected = null; refresh(); schedule(true); });
on('zoom-in', () => zoom(1.3));
on('zoom-out', () => zoom(1 / 1.3));
on('home', () => centerAt(draft.spawn.x, draft.spawn.y));
on('goto', () => { set('goto-x', 0); set('goto-y', 0); el<HTMLDialogElement>('goto-dialog').showModal(); });
on('goto-close', () => el<HTMLDialogElement>('goto-dialog').close());
on('goto-confirm', () => { const x = num('goto-x'), y = num('goto-y'); if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 10000000 || Math.abs(y) > 10000000)
    throw new Error('Coordinate oltre i limiti numerici.'); centerAt(x, y); el<HTMLDialogElement>('goto-dialog').close(); });
on('properties-toggle', () => { root.querySelector('.inspector')!.classList.toggle('collapsed'); schedule(); });
for (const id of ['show-grid', 'show-zones', 'show-cells', 'show-npcs'])
    input(id).addEventListener('change', () => schedule());
input('preview-fade').addEventListener('change', () => schedule());
input('asset-search').addEventListener('input', palette);
on('assets-expand', () => assetCatalog.expandAll(true));
on('assets-collapse', () => assetCatalog.expandAll(false));
on('validate', () => { const issues = validateWorld(parseWorldDocument(draft), catalog); el('issues').replaceChildren(...issues.map(message => { const li = document.createElement('li'); li.textContent = message; return li; })); status(issues.length ? `${issues.length} problemi da correggere.` : 'Progetto valido: ingombri e riferimenti verificati.'); });
document.addEventListener('keydown', e => { if ((e.target as HTMLElement).matches('input,select,textarea'))
    return; keys.add(e.code); if (e.code === 'Space')
    e.preventDefault(); if (e.code === 'Escape') {
    finishGesture(undefined, true);
    selected = null;
    refresh();
    schedule();
} if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    el(e.shiftKey ? 'redo' : 'undo').click();
} if (e.code === 'Delete' && selected)
    el(selected.kind === 'zone' ? 'zone-delete' : 'selection-delete').click(); });
document.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); finishGesture(undefined, true); });
async function api(path: string, payload: unknown): Promise<any> { const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-World-Token': token }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok)
    throw new Error(result.error ?? 'Operazione fallita.'); return result; }
async function upload(file: Blob, mime: string): Promise<string> { if (!token)
    throw new Error('Importazione immagini disponibile con npm run world:studio.'); const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return (await api('/__world/images', { mime, base64: btoa(binary) })).image; }
async function imageSize(src: string): Promise<{
    width: number;
    height: number;
}> { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('Immagine non leggibile.')); image.src = src; }); }
on('import-assets', () => input('asset-files').click());
input('asset-files').addEventListener('change', () => { void (async () => { const files = [...input('asset-files').files ?? []]; const imported: WorldAsset[] = []; for (const file of files) {
    status(`Importazione ${file.name}…`);
    if (file.size > 5000000)
        throw new Error('Massimo 5 MB per immagine.');
    const mime = file.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    const image = await upload(file, mime), size = await imageSize(image);
    const a = newWorldAsset(uid('asset'), file.name.replace(/\.(png|svg)$/i, ''), image);
    a.group = 'Importati'; a.visual = { kind: 'image' };
    const ratio = size.height / size.width;
    resizeWorldAsset(a, ratio > 32 ? Math.max(.25, 32 / ratio) : 1, Math.min(32, Math.max(.25, ratio)));
    imported.push(a);
} await settleGesture(); change(() => { draft.assets.push(...imported); activeAsset = imported.at(-1)?.id ?? activeAsset; if (imported.length) assetCatalog.reveal(imported.at(-1)!); selected = null; selectTool('asset'); }); status(`Importati ${imported.length} asset. Imposta dimensioni e proprietà delle celle.`); })().catch(report).finally(() => { input('asset-files').value = ''; }); });
on('apply-world', async () => { if (gesture)
    finishGesture(); while (gesture?.ending) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const document = parseWorldDocument(draft); const issues = validateWorld(document, catalog); if (issues.length) {
    el('validate').click();
    throw new Error('Correggi i problemi del progetto prima di applicare.');
} el<HTMLButtonElement>('apply-world').disabled = true; try {
    const result = await api('/__world/project', { document, revision });
    revision = result.revision;
    installedRevision = revision;
    dirty = !worldDocumentsEqual(draft, document);
    await checkpoint(true);
    el('save-state').textContent = dirty ? 'Bozza salvata · da applicare' : 'Applicato al progetto';
    status('Progetto applicato con backup. Ricompila e riavvia il gioco.');
}
finally {
    el<HTMLButtonElement>('apply-world').disabled = false;
} });
on('export-world', async () => { status('Preparazione esportazione con immagini…'); const images: Record<string, string> = {}; for (const src of new Set(draft.assets.map(a => a.image))) {
    const response = await fetch(src);
    if (!response.ok)
        throw new Error(`Immagine mancante: ${src}`);
    const blob = await response.blob();
    images[src] = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
} const blob = new Blob([JSON.stringify({ format: 'riftlands-world-project', version: 1, document: parseWorldDocument(draft), images })], { type: 'application/json' }); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'riftlands-world.project.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status('Progetto esportato con tutte le immagini. I dungeon fanno riferimento al catalogo installato.'); });
on('import-world', () => input('world-file').click());
input('world-file').addEventListener('change', () => { void (async () => { const file = input('world-file').files?.[0]; if (!file)
    return; if (file.size > 50000000)
    throw new Error('Progetto oltre 50 MB.'); const payload = JSON.parse(await file.text()); const document = compactWorldTiles(parseWorldDocument(payload.format === 'riftlands-world-project' ? payload.document : payload)); if (payload.images) {
    if (!token)
        throw new Error('Importa il progetto da World Studio per ripristinare le immagini.');
    for (const a of document.assets) {
        const data = payload.images[a.image];
        if (typeof data !== 'string')
            throw new Error(`Immagine assente nell’archivio: ${a.name}`);
        const match = /^data:(image\/(?:png|svg\+xml));base64,(.+)$/.exec(data);
        if (!match)
            throw new Error('Immagine esportata non valida.');
        a.image = (await api('/__world/images', { mime: match[1], base64: match[2] })).image;
    }
} change(() => { draft = document; selected = null; }); status('Progetto importato nella bozza locale.'); })().catch(report).finally(() => { input('world-file').value = ''; }); });
async function load(reload = false): Promise<void> {
    ready = false;
    try {
        const response = await fetch('/__world/project');
        if (response.ok) {
            const project = await response.json();
            draft = compactWorldTiles(parseWorldDocument(project.document));
            token = project.token;
            revision = project.revision;
            installedRevision = revision;
            compatibleRevisions = project.compatibleRevisions ?? [];
            catalog = project.dungeons;
        }
        if (!reload) {
            const local = await loadWorldCheckpoint();
            if (local) {
                const installedDocument = draft;
                draft = compactWorldTiles(local.document);
                revision = local.revision;
                if (compatibleRevisions.includes(revision)) revision = installedRevision;
                dirty = revision !== installedRevision || !worldDocumentsEqual(draft, installedDocument);
                if (token && revision !== installedRevision)
                    status('Bozza recuperata da una versione precedente: esportala o ricarica il progetto prima di applicare.');
                else
                    status(dirty ? 'Bozza locale recuperata.' : 'World Studio pronto · progetto applicato.');
                el('save-state').textContent = dirty ? 'Bozza salvata · da applicare' : 'Applicato al progetto';
                if (local.migrated) await checkpoint(true);
            }
            else
                status(token ? 'World Studio pronto.' : 'Anteprima: avvia npm run world:studio per importare e applicare.');
        }
        else {
            dirty = false;
            history.clear();
            await checkpoint();
            status('Progetto ricaricato.');
        }
    }
    catch (e) {
        report(e);
    }
    finally {
        ready = true;
        refresh();
        centerAt(draft.spawn.x, draft.spawn.y);
        schedule(true);
    }
}
on('reload', () => load(true));
new ResizeObserver(() => schedule()).observe(canvas);
new ResizeObserver(() => schedule()).observe(assetCanvas);
selectTool('select');
void load();
