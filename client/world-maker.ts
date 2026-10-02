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
import { newWorldAsset, parseWorldDocument, resizeWorldAsset, worldAssetVisual, WORLD_TERRAINS, type WorldDocument, type WorldAsset, type WorldZone } from '../shared/world-schema';
import { brushTiles, strokeTiles, WorldBrush } from '../shared/world-editing';
import { WorldAssetArt } from './world-asset-art';
import { WorldEditorHistory } from './world-editor-history';
import { loadWorldCheckpoint, saveWorldCheckpoint } from './world-editor-storage';
const root = document.getElementById('world-maker')!;
root.innerHTML = worldMakerLayout;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const val = (id: string) => (el(id) as HTMLInputElement | HTMLSelectElement).value;
const num = (id: string) => Number(val(id));
const set = (id: string, value: unknown) => { (el(id) as HTMLInputElement | HTMLSelectElement).value = String(value ?? ''); };
const on = (id: string, action: () => void | Promise<void>) => el(id).addEventListener('click', () => { void Promise.resolve().then(action).catch(report); });
const report = (e: unknown) => { el('status').textContent = e instanceof Error ? e.message : String(e); };
const status = (s: string) => { el('status').textContent = s; };
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
let draft = structuredClone(WORLD_DOCUMENT), catalog: readonly DungeonDefinition[] = DUNGEON_DEFINITIONS, token = '', revision = '', installedRevision = '', ready = false;
let world: World, tool = 'select', activeAsset = draft.assets[0]?.id ?? '', selected: {
    kind: 'placement' | 'npc' | 'dungeon' | 'zone';
    id: string;
} | null = null;
let worldDirty = true, framePending = false, dirty = false, checkpointQueue = Promise.resolve();
let animationTimer: ReturnType<typeof setTimeout> | undefined;
const history = new WorldEditorHistory(), canvas = el<HTMLCanvasElement>('map');
const assetCanvas = el<HTMLCanvasElement>('asset-grid');
const art = new WorldAssetArt(() => schedule());
let view = { x: 0, y: 0, scale: 24 }, pointerTile: Vec2 | null = null;
let gesture: {
    pointer: number;
    before: WorldDocument;
    start: Vec2;
    last: Vec2;
    pan?: Vec2;
    cell?: boolean;
    painted: Set<string>;
    tool: string;
    mass: boolean;
    brush?: WorldBrush;
} | null = null;
const keys = new Set<string>();
set('brush-radius', 1);
set('brush-density', 100);
function ensureWorld(): void { if (worldDirty) {
    world = new World(draft.seed, 96, 'world', draft, worldDungeons(draft, catalog));
    worldDirty = false;
} }
function schedule(rebuild = false): void { worldDirty ||= rebuild; if (!framePending) {
    framePending = true;
    requestAnimationFrame(() => { framePending = false; draw(); drawAssetGrid(); });
} }
function checkpoint(): Promise<void> {
    const snapshot = { document: structuredClone(draft), revision };
    checkpointQueue = checkpointQueue.catch(() => { }).then(() => saveWorldCheckpoint(snapshot));
    void checkpointQueue.then(() => { if (dirty)
        el('save-state').textContent = 'Bozza salvata · da applicare'; }).catch(() => { el('save-state').textContent = 'Salvataggio fallito · esporta'; });
    return checkpointQueue;
}
function commit(before: WorldDocument): void {
    try {
        draft = parseWorldDocument(draft);
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
    draft = structuredClone(draft);
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
    const search = val('asset-search').toLowerCase();
    el('asset-list').replaceChildren(...draft.assets.filter(a => `${a.name} ${a.generation.category}`.toLowerCase().includes(search)).map(a => {
        const b = document.createElement('button');
        b.className = 'asset-item';
        b.dataset.asset = a.id;
        b.setAttribute('aria-pressed', String(a.id === activeAsset));
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.src = a.image;
        img.alt = '';
        const info = document.createElement('div');
        info.textContent = a.name;
        const detail = document.createElement('small');
        detail.textContent = `${a.width} × ${a.height} · ${a.generation.enabled ? 'genera + manuale' : 'manuale'}`;
        info.append(detail);
        b.append(img, info);
        b.onclick = () => { activeAsset = a.id; selected = null; selectTool('asset'); refresh(); };
        return b;
    }));
}
function refresh(): void {
    if (!active())
        activeAsset = draft.assets[0]?.id ?? '';
    palette();
    set('seed', draft.seed);
    el<HTMLButtonElement>('undo').disabled = !history.canUndo;
    el<HTMLButtonElement>('redo').disabled = !history.canRedo;
    el<HTMLButtonElement>('apply-world').disabled = !token || !ready;
    el('map-info').textContent = `${draft.placements.length} asset · ${draft.zones.length} zone`;
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
    set('asset-name', a.name);
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
function drawAssetGrid(): void { if (!el('asset-inspector').hidden)
    renderAssetGrid(assetCanvas, art, active()); }
function assetView() { return assetGridView(assetCanvas, active()); }
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
    const radius = Math.max(0, Math.min(16, Math.round(num('brush-radius'))));
    const points = gesture.tool === 'asset' && !gesture.mass ? [p] : brushTiles(p, radius);
    for (const q of points) {
        const key = `${q.x},${q.y}`;
        if (gesture.painted.has(key))
            continue;
        gesture.painted.add(key);
        if (gesture.tool === 'asset' && coordinateHash(q.x, q.y, draft.seed + gesture.before.placements.length + 2001) >= Math.max(0, Math.min(1, num('brush-density') / 100)))
            continue;
        const dungeon = world.dungeons.some(d => q.x >= d.layout.bounds.minTx && q.x <= d.layout.bounds.maxTx && q.y >= d.layout.bounds.minTy && q.y <= d.layout.bounds.maxTy);
        if (dungeon && ['terrain', 'restore', 'asset', 'erase'].includes(gesture.tool))
            continue;
        if (gesture.tool === 'terrain')
            gesture.brush!.tile(q, { terrain: val('terrain') as TileKind, suppressAssets: true });
        else if (gesture.tool === 'restore')
            gesture.brush!.tile(q);
        else if (gesture.tool === 'erase')
            gesture.brush!.erase(q);
        else if (gesture.tool === 'asset' && active())
            gesture.brush!.stamp(active()!, q, uid('asset'));
    }
    schedule(true);
}
canvas.addEventListener('pointerdown', event => {
    if (!ready || gesture)
        return;
    canvas.focus();
    const p = position(event);
    ensureWorld();
    if (event.button === 1 || event.button === 2 || keys.has('Space')) {
        gesture = { pointer: event.pointerId, before: draft, start: p, last: p, pan: { x: event.clientX, y: event.clientY }, painted: new Set(), tool, mass: false };
        canvas.setPointerCapture(event.pointerId);
        return;
    }
    if (tool === 'select') {
        selectAt(p);
        return;
    }
    const before = draft;
    draft = structuredClone(draft);
    gesture = { pointer: event.pointerId, before, start: p, last: p, painted: new Set(), tool, mass: event.ctrlKey || input('mass').checked, brush: new WorldBrush(draft) };
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
    if (gesture.pan) {
        view.x += event.clientX - gesture.pan.x;
        view.y += event.clientY - gesture.pan.y;
        gesture.pan = { x: event.clientX, y: event.clientY };
        schedule();
        return;
    }
    if (!['zone', 'npc', 'dungeon', 'spawn'].includes(gesture.tool) && (gesture.tool !== 'asset' || gesture.mass))
        for (const p of strokeTiles(gesture.last, pointerTile))
            paint(p);
    gesture.last = pointerTile;
    schedule();
});
function finishGesture(event?: PointerEvent, cancel = false): void {
    if (!gesture || (event && gesture.pointer !== event.pointerId))
        return;
    const g = gesture;
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
        commit(g.before);
    else
        schedule();
}
canvas.addEventListener('pointerup', event => finishGesture(event));
canvas.addEventListener('pointercancel', event => finishGesture(event, true));
canvas.addEventListener('lostpointercapture', event => { if (gesture && !gesture.cell && gesture.pointer === event.pointerId)
    finishGesture(event, true); });
canvas.addEventListener('pointerleave', () => { pointerTile = null; schedule(); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', event => { event.preventDefault(); const r = canvas.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - r.left, event.clientY - r.top); }, { passive: false });
function paintCell(event: PointerEvent): void { const v = assetView(); if (!v || !gesture?.cell)
    return; const r = assetCanvas.getBoundingClientRect(), col = Math.floor((event.clientX - r.left - v.x) / v.s), row = Math.floor((event.clientY - r.top - v.y) / v.s); if (col < 0 || row < 0 || col >= v.a.columns || row >= v.a.rows)
    return; v.a.cells[row * v.a.columns + col] = { blocked: val('cell-blocked') === 'true', visibility: val('cell-visibility') as 'normal' | 'hide' | 'fade' }; schedule(true); }
assetCanvas.addEventListener('pointerdown', e => { if (!ready || gesture)
    return; const before = draft; draft = structuredClone(draft); gesture = { pointer: e.pointerId, before, start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, painted: new Set(), tool: 'cell', mass: false, cell: true }; assetCanvas.setPointerCapture(e.pointerId); paintCell(e); });
assetCanvas.addEventListener('pointermove', paintCell);
assetCanvas.addEventListener('pointerup', e => finishGesture(e));
assetCanvas.addEventListener('pointercancel', e => finishGesture(e, true));
on('asset-update', () => change(() => { const a = active()!; resizeWorldAsset(a, num('asset-width'), num('asset-height')); a.name = val('asset-name').trim(); a.layer = val('asset-layer') as 'ground' | 'object'; a.pivot.y = num('asset-pivot'); a.visual = val('asset-visual') === 'image' ? { kind: 'image' } : { kind: 'fire', style: val('asset-visual') as 'brazier' | 'campfire' }; }));
input('asset-width').addEventListener('input', () => { const a = active(); if (a && input('keep-ratio').checked)
    set('asset-height', Math.round(num('asset-width') * a.height / a.width * 1000) / 1000); });
input('asset-height').addEventListener('input', () => { const a = active(); if (a && input('keep-ratio').checked)
    set('asset-width', Math.round(num('asset-height') * a.width / a.height * 1000) / 1000); });
on('fill-cells', () => change(() => { const a = active()!; a.cells = a.cells.map(() => ({ blocked: val('cell-blocked') === 'true', visibility: val('cell-visibility') as 'normal' | 'hide' | 'fade' })); }));
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
input('asset-search').addEventListener('input', palette);
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
    const ratio = size.height / size.width;
    resizeWorldAsset(a, ratio > 32 ? Math.max(.25, 32 / ratio) : 1, Math.min(32, Math.max(.25, ratio)));
    imported.push(a);
} change(() => { draft.assets.push(...imported); activeAsset = imported.at(-1)?.id ?? activeAsset; selected = null; selectTool('asset'); }); status(`Importati ${imported.length} asset. Imposta dimensioni e proprietà delle celle.`); })().catch(report).finally(() => { input('asset-files').value = ''; }); });
on('apply-world', async () => { if (gesture)
    finishGesture(); const document = parseWorldDocument(draft); const issues = validateWorld(document, catalog); if (issues.length) {
    el('validate').click();
    throw new Error('Correggi i problemi del progetto prima di applicare.');
} el<HTMLButtonElement>('apply-world').disabled = true; try {
    const result = await api('/__world/project', { document, revision });
    revision = result.revision;
    installedRevision = revision;
    dirty = JSON.stringify(draft) !== JSON.stringify(document);
    await checkpoint();
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
} const blob = new Blob([JSON.stringify({ format: 'riftlands-world-project', version: 1, document: parseWorldDocument(draft), images }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'riftlands-world.project.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status('Progetto esportato con tutte le immagini. I dungeon fanno riferimento al catalogo installato.'); });
on('import-world', () => input('world-file').click());
input('world-file').addEventListener('change', () => { void (async () => { const file = input('world-file').files?.[0]; if (!file)
    return; if (file.size > 50000000)
    throw new Error('Progetto oltre 50 MB.'); const payload = JSON.parse(await file.text()); const document = parseWorldDocument(payload.format === 'riftlands-world-project' ? payload.document : payload); if (payload.images) {
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
            draft = parseWorldDocument(project.document);
            token = project.token;
            revision = project.revision;
            installedRevision = revision;
            catalog = project.dungeons;
        }
        if (!reload) {
            const local = await loadWorldCheckpoint();
            if (local) {
                const installedDocument = draft;
                draft = local.document;
                revision = local.revision;
                dirty = revision !== installedRevision || JSON.stringify(draft) !== JSON.stringify(installedDocument);
                if (token && revision !== installedRevision)
                    status('Bozza recuperata da una versione precedente: esportala o ricarica il progetto prima di applicare.');
                else
                    status(dirty ? 'Bozza locale recuperata.' : 'World Studio pronto · progetto applicato.');
                el('save-state').textContent = dirty ? 'Bozza salvata · da applicare' : 'Applicato al progetto';
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
