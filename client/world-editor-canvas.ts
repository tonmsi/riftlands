import { TILE_SIZE, CHUNK_TILES } from '../shared/config';
import type { Vec2 } from '../shared/types';
import type { World } from '../shared/world';
import { shapeBounds } from '../shared/world-authoring';
import type { WorldDocument, WorldAsset, WorldZone } from '../shared/world-schema';
import { worldAssetVisual, worldAssetImageBounds } from '../shared/world-schema';
import { NPC_DEFINITIONS } from '../shared/npcs';
import { canStampAsset } from '../shared/world-editing';
import { WorldAssetArt } from './world-asset-art';
import { AssetGridCamera } from './world-asset-view';
import { terrains } from './world-maker-layout';
import type { AssetPlacement } from '../shared/world-schema';
const terrainViews = new WeakMap<HTMLCanvasElement, { key: string; world: World; canvas: HTMLCanvasElement; placements: AssetPlacement[] }>();
export interface EditorView {
    x: number;
    y: number;
    scale: number;
}
export interface EditorSelection {
    kind: 'placement' | 'npc' | 'dungeon' | 'zone';
    id: string;
}
export interface MapOptions {
    grid: boolean;
    cells: boolean;
    zones: boolean;
    npcs: boolean;
    selected: EditorSelection | null;
    gesture: {
        tool: string;
        start: Vec2;
        last: Vec2;
        pan?: Vec2;
    } | null;
    pointerTile: Vec2 | null;
    tool: string;
    activeAsset?: WorldAsset;
}
function sizeCanvas(c: HTMLCanvasElement): {
    width: number;
    height: number;
    dpr: number;
} {
    const r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    const width = Math.max(1, r.width), height = Math.max(1, r.height);
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
    }
    return { width, height, dpr };
}
export function drawWorldEditorMap(canvas: HTMLCanvasElement, world: World, draft: WorldDocument, view: EditorView, art: WorldAssetArt, options: MapOptions): boolean {
    const time = performance.now();
    let animated = false;
    const ctx = canvas.getContext('2d')!, selected = options.selected, gesture = options.gesture, pointerTile = options.pointerTile;
    const bounds = () => { const r = canvas.getBoundingClientRect(); return { left: -view.x / view.scale, top: -view.y / view.scale, right: (r.width - view.x) / view.scale, bottom: (r.height - view.y) / view.scale }; };
    const { width, height, dpr } = sizeCanvas(canvas), b = bounds(), s = view.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#131d16';
    ctx.fillRect(0, 0, width, height);
    ctx.translate(view.x, view.y);
    // At distant zoom, bounded sampling shows landforms rather than generating millions of tiles.
    const step = Math.max(1, Math.ceil(Math.sqrt((b.right - b.left) * (b.bottom - b.top) / 16000)));
    const key = `${world.authoringRevision}:${world.lockRevision}:${view.x}:${view.y}:${s}:${width}:${height}:${dpr}`;
    let cached = terrainViews.get(canvas);
    if (!cached || cached.world !== world || cached.key !== key) {
        const bitmap = document.createElement('canvas'); bitmap.width = canvas.width; bitmap.height = canvas.height;
        const paint = bitmap.getContext('2d')!; paint.setTransform(dpr, 0, 0, dpr, view.x * dpr, view.y * dpr);
        for (let y = Math.floor(b.top / step) * step; y < b.bottom; y += step)
            for (let x = Math.floor(b.left / step) * step; x < b.right; x += step) {
                paint.fillStyle = terrains[world.getTile(x, y)].color;
                paint.fillRect(x * s, y * s, step * s + .5, step * s + .5);
            }
        const placements = step === 1 ? world.assetsIn(b) : world.authoring.visibleAssetsIn(b);
        placements.sort((p, q) => { const a = world.authoring.assets.get(p.assetId)!, c = world.authoring.assets.get(q.assetId)!; return (a.layer === 'ground' ? -1 : 1) - (c.layer === 'ground' ? -1 : 1) || p.y + a.height * a.pivot.y - q.y - c.height * c.pivot.y; });
        cached = { key, world, canvas: bitmap, placements }; terrainViews.set(canvas, cached);
    }
    ctx.drawImage(cached.canvas, -view.x, -view.y, width, height);
    const placements = cached.placements;
    for (const p of placements) {
        const a = world.authoring.assets.get(p.assetId)!;
        art.draw(ctx, a, p, 1, s, time);
        animated ||= worldAssetVisual(a).kind === 'fire';
        if (selected?.kind === 'placement' && selected.id === p.id) {
            ctx.strokeStyle = '#f0df9d';
            ctx.lineWidth = 2;
            ctx.strokeRect(p.x * s, p.y * s, a.columns * s, a.rows * s);
        }
        if (options.cells && s >= 5)
            for (let y = 0; y < a.rows; y++)
                for (let x = 0; x < a.columns; x++) {
                    const c = a.cells[y * a.columns + x];
                    ctx.fillStyle = c.blocked ? '#db806a88' : c.visibility === 'hide-fade' ? '#c3a9e877' : c.visibility === 'hide' ? '#b0d77977' : c.visibility === 'fade' ? '#79ccdd77' : '#ffffff08';
                    ctx.fillRect((p.x + x) * s, (p.y + y) * s, s, s);
                }
    }
    if (options.grid && s >= 10) {
        ctx.beginPath();
        ctx.strokeStyle = '#14291a40';
        ctx.lineWidth = 1;
        for (let x = Math.floor(b.left); x <= b.right; x++) {
            ctx.moveTo(x * s, b.top * s);
            ctx.lineTo(x * s, b.bottom * s);
        }
        for (let y = Math.floor(b.top); y <= b.bottom; y++) {
            ctx.moveTo(b.left * s, y * s);
            ctx.lineTo(b.right * s, y * s);
        }
        ctx.stroke();
    }
    for (const d of world.dungeons) {
        const t = d.layout.bounds;
        if (t.maxTx < b.left || t.minTx > b.right || t.maxTy < b.top || t.minTy > b.bottom)
            continue;
        ctx.strokeStyle = selected?.kind === 'dungeon' && selected.id === d.id ? '#ffe5a4' : '#dec9a080';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.minTx * s, t.minTy * s, (t.maxTx - t.minTx + 1) * s, (t.maxTy - t.minTy + 1) * s);
        ctx.fillStyle = '#f2e3c2';
        ctx.font = '11px system-ui';
        ctx.fillText(d.name, t.minTx * s + 5, t.minTy * s - 7);
    }
    if (options.zones)
        for (const z of world.authoring.zones.query(b))
            drawZone(ctx, z, view, selected);
    const npcs = [...draft.npcs.map(n => ({ ...n, manual: true }))];
    if (options.npcs && s >= 8)
        for (let cy = Math.floor(b.top / CHUNK_TILES); cy < Math.ceil(b.bottom / CHUNK_TILES); cy++)
            for (let cx = Math.floor(b.left / CHUNK_TILES); cx < Math.ceil(b.right / CHUNK_TILES); cx++)
                for (const n of world.getChunk(cx, cy).npcs)
                    if (!n.id.startsWith('authored:'))
                        npcs.push({ ...n, x: n.x / TILE_SIZE - .5, y: n.y / TILE_SIZE - .5, manual: false });
    for (const n of npcs) {
        if (n.x < b.left || n.x > b.right || n.y < b.top || n.y > b.bottom)
            continue;
        ctx.fillStyle = NPC_DEFINITIONS[n.npcKind].color;
        ctx.beginPath();
        ctx.arc((n.x + .5) * s, (n.y + .5) * s, Math.max(2, s * .24), 0, Math.PI * 2);
        ctx.fill();
        if (n.manual) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
    ctx.strokeStyle = '#fff1b4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(draft.spawn.x * s, draft.spawn.y * s, Math.max(4, s * .35), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(draft.spawn.x * s - 8, draft.spawn.y * s);
    ctx.lineTo(draft.spawn.x * s + 8, draft.spawn.y * s);
    ctx.moveTo(draft.spawn.x * s, draft.spawn.y * s - 8);
    ctx.lineTo(draft.spawn.x * s, draft.spawn.y * s + 8);
    ctx.stroke();
    if (gesture?.tool === 'zone' && !gesture.pan) {
        ctx.fillStyle = '#d5e99a20';
        ctx.strokeStyle = '#d5e99a';
        const x = Math.min(gesture.start.x, gesture.last.x), y = Math.min(gesture.start.y, gesture.last.y);
        ctx.fillRect(x * s, y * s, (Math.abs(gesture.start.x - gesture.last.x) + 1) * s, (Math.abs(gesture.start.y - gesture.last.y) + 1) * s);
        ctx.strokeRect(x * s, y * s, (Math.abs(gesture.start.x - gesture.last.x) + 1) * s, (Math.abs(gesture.start.y - gesture.last.y) + 1) * s);
    }
    if (pointerTile && !gesture?.pan && options.tool === 'asset' && options.activeAsset) {
        const a = options.activeAsset!;
        const gap = a.generation.spacing;
        const local = world.authoring.placements.query({ left: pointerTile.x - gap, top: pointerTile.y - gap, right: pointerTile.x + a.columns + gap, bottom: pointerTile.y + a.rows + gap });
        ctx.strokeStyle = canStampAsset({ ...draft, placements: local }, a, pointerTile) ? '#d3eaa9' : '#ef9a7e';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(pointerTile.x * s, pointerTile.y * s, a.columns * s, a.rows * s);
        ctx.setLineDash([]);
        art.draw(ctx, a, { ...pointerTile, id: 'preview', assetId: a.id }, .45, s, time);
        animated ||= worldAssetVisual(a).kind === 'fire';
    }
    return animated;
}
function drawZone(ctx: CanvasRenderingContext2D, z: WorldZone, view: EditorView, selected: EditorSelection | null): void {
    const b = shapeBounds(z.shape), s = view.scale;
    ctx.save();
    ctx.beginPath();
    if (z.shape.kind === 'circle')
        ctx.arc(z.shape.x * s, z.shape.y * s, z.shape.radius * s, 0, Math.PI * 2);
    else
        ctx.rect(b.left * s, b.top * s, (b.right - b.left) * s, (b.bottom - b.top) * s);
    const color = z.arenaId ? '#9adbea' : z.pvp === false ? '#b4d38e' : z.pvp ? '#ef997e' : z.npcs ? '#b9a3e4' : '#e4cf91';
    ctx.fillStyle = `${color}12`;
    ctx.strokeStyle = color;
    ctx.lineWidth = selected?.kind === 'zone' && selected.id === z.id ? 3 : 1;
    ctx.setLineDash(z.arenaId ? [] : [7, 5]);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '11px system-ui';
    ctx.fillText(z.name, b.left * s + 4, b.top * s + 14);
    ctx.restore();
}
export function assetView(assetCanvas: HTMLCanvasElement, a: WorldAsset | undefined, camera = new AssetGridCamera()) {
    if (!a) return;
    const r = assetCanvas.getBoundingClientRect(); return { a, ...camera.layout(r.width, r.height, a.columns, a.rows, worldAssetImageBounds(a)) };
}
export function drawAssetGrid(assetCanvas: HTMLCanvasElement, art: WorldAssetArt, a: WorldAsset | undefined, previewFade = false, camera?: AssetGridCamera, editImage = false): void {
    const assetCtx = assetCanvas.getContext('2d')!;
    const { width, height, dpr } = sizeCanvas(assetCanvas);
    assetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    assetCtx.clearRect(0, 0, width, height);
    const v = assetView(assetCanvas, a, camera);
    if (!v)
        return;
    assetCtx.save();
    assetCtx.translate(v.x, v.y);
    art.draw(assetCtx, v.a, { id: '', assetId: v.a.id, x: 0, y: 0 }, 1, v.s, performance.now(), previewFade ? 1 : 0);
    for (let y = 0; y < v.a.rows; y++)
        for (let x = 0; x < v.a.columns; x++) {
            const c = v.a.cells[y * v.a.columns + x];
            assetCtx.fillStyle = c.visibility === 'hide-fade' ? '#c3a9e855' : c.visibility === 'hide' ? '#b0d77955' : c.visibility === 'fade' ? '#79ccdd55' : '#ffffff05';
            assetCtx.fillRect(x * v.s, y * v.s, v.s, v.s);
            assetCtx.strokeStyle = c.blocked ? '#ee927a' : '#b4c6a866';
            assetCtx.lineWidth = c.blocked ? 3 : 1;
            assetCtx.strokeRect(x * v.s, y * v.s, v.s, v.s);
            if (c.blocked) {
                assetCtx.beginPath();
                assetCtx.moveTo(x * v.s + 4, y * v.s + 4);
                assetCtx.lineTo((x + 1) * v.s - 4, (y + 1) * v.s - 4);
                assetCtx.stroke();
            }
        }
    if (editImage) {
        const b = worldAssetImageBounds(v.a);
        assetCtx.strokeStyle = '#ffe5a4'; assetCtx.lineWidth = 2; assetCtx.setLineDash([6, 4]);
        assetCtx.strokeRect(b.x * v.s, b.y * v.s, b.width * v.s, b.height * v.s);
    }
    assetCtx.restore();
}
