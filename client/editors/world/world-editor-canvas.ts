import { TerrainRenderer } from '../../render/terrain-renderer';
import { TILE_SIZE, CHUNK_TILES } from '../../../shared/config';
import type { Vec2 } from '../../../shared/types';
import type { World } from '../../../shared/world';
import { shapeBounds, overlaps } from '../../../shared/world-authoring';
import type { WorldDocument, WorldAsset, WorldZone } from '../../../shared/world-schema';
import { worldAssetVisual, worldAssetImageBounds } from '../../../shared/world-schema';
import { NPC_DEFINITIONS } from '../../../shared/npcs';
import { canStampAsset } from '../../../shared/world-editing';
import { WorldAssetArt } from '../../render/world-asset-art';
import { cliffLevels } from '../../../shared/cliff-assets';
import { assetCellColumns, assetCellRows, assetCellSubdivision } from '../../../shared/world-schema';
import { AssetGridCamera } from '../../render/world-asset-view';
import { terrains } from './world-maker-layout';
import type { AssetPlacement } from '../../../shared/world-schema';
import { placedGeometry, rectBounds } from '../../../shared/elevation';
import { drawElevationSurface, drawElevationStair } from '../../render/elevation-art';
import { drawTerrainCliff } from '../../render/cliff-art';
import { assetVisible, drawVisibleAsset, exposedSurfaceParts, floorVisible, type ElevationVisibility } from './elevation-visibility';
import { compareAssetDrawOrder } from './world-picking';
import { WorldLightArt } from './world-light-art';
const lightArtists = new WeakMap<WorldAssetArt, WorldLightArt>();
const terrainPainters = new WeakMap<HTMLCanvasElement, TerrainRenderer>();
const terrainViews = new WeakMap<HTMLCanvasElement, { key: string; world: World; canvas: HTMLCanvasElement; placements: AssetPlacement[] }>();
export interface EditorView {
    x: number;
    y: number;
    scale: number;
}
export interface EditorSelection {
    kind: 'placement' | 'npc' | 'dungeon' | 'zone' | 'sound';
    id: string;
}
export interface MapOptions {
    lightMode?: boolean;
    visibleElevations?: ElevationVisibility;
    activeElevation?: number;
    painting?: boolean;
    grid: boolean;
    cells: boolean;
    zones: boolean;
    npcs: boolean;
    selected: EditorSelection | null;
    selectedObjects?: readonly EditorSelection[];
    gesture: {
        tool: string;
        start: Vec2;
        last: Vec2;
        pan?: Vec2;
        marquee?: { start: Vec2; end: Vec2 };
        moved?: boolean;
    } | null;
    pointerTile: Vec2 | null;
    tool: string;
    activeAsset?: WorldAsset;
}
function sizeCanvas(c: HTMLCanvasElement, maxDpr = 2): {
    width: number;
    height: number;
    dpr: number;
} {
    const r = c.getBoundingClientRect(), dpr = Math.min(maxDpr, devicePixelRatio || 1);
    const width = Math.max(1, r.width), height = Math.max(1, r.height);
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
    }
    return { width, height, dpr };
}
export function drawWorldEditorMap(canvas: HTMLCanvasElement, world: World, draft: WorldDocument, view: EditorView, art: WorldAssetArt, options: MapOptions): boolean {
    const light = options.lightMode === true;
    const time = light ? 0 : performance.now();
    let lightArt = lightArtists.get(art);
    if (light && !lightArt) { lightArt = new WorldLightArt(art); lightArtists.set(art, lightArt); }
    let animated = false;
    const ctx = canvas.getContext('2d')!, selected = options.selected, gesture = options.gesture, pointerTile = options.pointerTile;
    const selectedIds = new Set(options.selectedObjects?.map(item => `${item.kind}:${item.id}`));
    if (selected) selectedIds.add(`${selected.kind}:${selected.id}`);
    const bounds = () => { const r = canvas.getBoundingClientRect(); return { left: -view.x / view.scale, top: -view.y / view.scale, right: (r.width - view.x) / view.scale, bottom: (r.height - view.y) / view.scale }; };
    const { width, height, dpr } = sizeCanvas(canvas, light ? 1 : 2), b = bounds(), s = view.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#131d16';
    ctx.fillRect(0, 0, width, height);
    ctx.translate(view.x, view.y);
    // At distant zoom, bounded sampling shows landforms rather than generating millions of tiles.
    const step = Math.max(1, Math.ceil(Math.sqrt((b.right - b.left) * (b.bottom - b.top) / (light ? 6000 : 16000))));
    const visible = options.visibleElevations ?? null;
    const key = `${light}:${terrainPainters.get(canvas)?.spriteRevision ?? 0}:${art.revision}:${JSON.stringify(visible)}:${options.painting}:${world.authoringRevision}:${world.lockRevision}:${view.x}:${view.y}:${s}:${width}:${height}:${dpr}`;
    let cached = terrainViews.get(canvas);
    if (!cached || cached.world !== world || cached.key !== key) {
        const bitmap = cached?.canvas ?? document.createElement('canvas'); bitmap.width = canvas.width; bitmap.height = canvas.height;
        const paint = bitmap.getContext('2d')!; paint.setTransform(dpr, 0, 0, dpr, view.x * dpr, view.y * dpr);
        if (!light && options.painting && step === 1 && s >= 12) {
            let painter = terrainPainters.get(canvas);
            if (!painter) { painter = new TerrainRenderer(paint); terrainPainters.set(canvas, painter); }
            paint.scale(s / TILE_SIZE, s / TILE_SIZE);
            painter.drawTerrain(world, time, paint, { left: b.left * TILE_SIZE, top: b.top * TILE_SIZE, right: b.right * TILE_SIZE, bottom: b.bottom * TILE_SIZE });
            paint.setTransform(dpr, 0, 0, dpr, view.x * dpr, view.y * dpr);
        } else for (let y = Math.floor(b.top / step) * step; y < b.bottom; y += step)
            for (let x = Math.floor(b.left / step) * step; x < b.right; x += step) {
                paint.fillStyle = world.authoring.document.painting?.materials[world.getTile(x, y)].color ?? terrains[world.getTile(x, y)].color;
                paint.fillRect(x * s, y * s, step * s + .5, step * s + .5);
            }
        const placements = step === 1 ? world.assetsIn(b) : world.authoring.visibleAssetsIn(b);
        // Light previews query authored rectangles directly, without constructing cliff masks/meshes.
        const authored = draft.geometry;
        const geometry = light ? {
            surfaces: (authored?.surfaces ?? []).filter(r => overlaps(rectBounds(r), b)),
            solids: (authored?.solids ?? []).filter(r => overlaps(rectBounds(r), b)),
            stairs: (authored?.stairs ?? []).filter(r => overlaps(rectBounds(r), b)),
        } : world.elevation.authoredGeometry(b);
        const cliffs = light ? [] : world.elevation.cliffs(b);
        const groundBitmap = geometry.surfaces.some(top => top.painted && top.ground) ? document.createElement('canvas') : undefined;
        if (groundBitmap) { groundBitmap.width = bitmap.width; groundBitmap.height = bitmap.height; groundBitmap.getContext('2d')!.drawImage(bitmap,0,0); }
        for (const p of placements) {
            const a = world.authoring.assets.get(p.assetId)!;
            if (!a.geometry) continue;
            const g = placedGeometry(a.geometry, p.x, p.y, p.baseElevation ?? world.elevation.terrainElevationAt(p.x + .5, p.y + .5), p.id);
            geometry.surfaces.push(...g.surfaces); geometry.solids.push(...g.solids); geometry.stairs.push(...g.stairs);
        }
        if (visible !== null) {
            paint.save(); paint.globalCompositeOperation = 'destination-out';
            // Full tile fallback for the base; exact ground footprints cut holes inside tiles.
            for (let y = Math.floor(b.top / step) * step; y < b.bottom; y += step)
                for (let x = Math.floor(b.left / step) * step; x < b.right; x += step)
                    if (!floorVisible(visible, world.elevation.baseAt(x, y))) paint.fillRect(x * s, y * s, step * s, step * s);
            for (const top of geometry.surfaces) if (top.ground) paint.fillRect(top.x * s, top.y * s, top.width * s, top.height * s);
            for (const cliff of cliffs) paint.fillRect(cliff.x * s, cliff.y * s, s, s);
            paint.restore();
        }
        paint.save(); paint.scale(s / TILE_SIZE, s / TILE_SIZE);
        for (const cliff of cliffs) if (cliffLevels(draft,cliff,true).some(e=>floorVisible(visible,e))) {
            drawTerrainCliff(paint, cliff, art, geometry.stairs, { document: draft, time, visibleFloors:visible, version:world });
        }
        for (const top of geometry.surfaces.filter(top => !top.id.includes('/') && floorVisible(visible, top.elevation)).sort((a, b) => a.elevation - b.elevation))
            for (const part of exposedSurfaceParts(top, geometry)) {
                if (part.painted && part.ground && groundBitmap) {
                    paint.save(); paint.beginPath(); paint.rect(part.x*TILE_SIZE,part.y*TILE_SIZE,part.width*TILE_SIZE,part.height*TILE_SIZE); paint.clip();
                    paint.setTransform(1,0,0,1,0,0); paint.drawImage(groundBitmap,0,0); paint.restore();
                } else if (!part.ground && !light) {
                    let painter = terrainPainters.get(canvas);
                    if (!painter) { painter = new TerrainRenderer(paint); terrainPainters.set(canvas, painter); }
                    painter.drawSurfaceMaterial(world, paint, part, time);
                } else drawElevationSurface(paint, part);
                if (light && part.elevation !== 0) {
                    paint.strokeStyle = '#515849'; paint.lineWidth = TILE_SIZE / s;
                    paint.strokeRect(part.x*TILE_SIZE, part.y*TILE_SIZE, part.width*TILE_SIZE, part.height*TILE_SIZE);
                }
            }
        for (const stair of geometry.stairs.filter(stair => !stair.id.includes('/'))) {
            if (floorVisible(visible, stair.from)) drawElevationStair(paint, stair, stair.from, light ? undefined : art);
            if (floorVisible(visible, stair.to)) drawElevationStair(paint, stair, stair.to, light ? undefined : art);
        }
        paint.restore();
        placements.sort((p, q) => compareAssetDrawOrder(p, q, world.authoring.assets));
        if (light) for (const p of placements) {
            const a = world.authoring.assets.get(p.assetId)!;
            const base = p.baseElevation ?? world.elevation.terrainElevationAt(p.x + .5, p.y + .5);
            if (assetVisible(a, base, visible)) drawVisibleAsset(paint, lightArt!, a, p, base, visible, s, 0);
        }
        cached = { key, world, canvas: bitmap, placements }; terrainViews.set(canvas, cached);
    }
    ctx.drawImage(cached.canvas, -view.x, -view.y, width, height);
    if(!light && visible === null && options.painting&&step===1&&s>=12){
        ctx.save();ctx.scale(s/TILE_SIZE,s/TILE_SIZE);
        animated=terrainPainters.get(canvas)?.drawCoastMotion(ctx,{left:b.left*TILE_SIZE,top:b.top*TILE_SIZE,right:b.right*TILE_SIZE,bottom:b.bottom*TILE_SIZE},time)??false;
        ctx.restore();
    }
    if (!light) animated ||= terrainPainters.get(canvas)?.spritesPending ?? false;
    const placements = cached.placements;
    for (const p of light && !options.cells && !selectedIds.size ? [] : placements) {
        const a = world.authoring.assets.get(p.assetId)!;
        const base = p.baseElevation ?? world.elevation.terrainElevationAt(p.x + .5, p.y + .5);
        if (!assetVisible(a, base, visible)) continue;
        if (!light) {
            drawVisibleAsset(ctx, art, a, p, base, visible, s, time);
            animated ||= worldAssetVisual(a).kind === 'fire' || !!a.animation;
        }
        if (selectedIds.has(`placement:${p.id}`)) {
            ctx.strokeStyle = '#f0df9d';
            ctx.lineWidth = 2;
            const bounds = worldAssetImageBounds(a);
            ctx.strokeRect((p.x + bounds.x) * s, (p.y + bounds.y) * s, bounds.width * s, bounds.height * s);
        }
        if (floorVisible(visible, base) && options.cells && s/assetCellSubdivision(a) >= 2)
            for (let y = 0; y < assetCellRows(a); y++)
                for (let x = 0; x < assetCellColumns(a); x++) {
                    const c = a.cells[y * assetCellColumns(a) + x], step=1/assetCellSubdivision(a);
                    ctx.fillStyle = c.blocked ? '#db806a88' : c.visibility === 'hide-fade' ? '#c3a9e877' : c.visibility === 'hide' ? '#b0d77977' : c.visibility === 'fade' ? '#79ccdd77' : '#ffffff08';
                    ctx.fillRect((p.x + x*step) * s, (p.y + y*step) * s, s*step, s*step);
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
        if (!floorVisible(visible, 0)) continue;
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
    for (const point of draft.soundPoints ?? []) {
        const x = (point.x + .5) * s, y = (point.y + .5) * s;
        const chosen = selected?.kind === 'sound' && selected.id === point.id;
        ctx.save(); ctx.strokeStyle = chosen ? '#ffe5a4' : '#9cdbed'; ctx.fillStyle = ctx.strokeStyle;
        if (chosen || options.tool === 'sound') {
            ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
            ctx.beginPath(); ctx.arc(x, y, point.radius * s, 0, Math.PI * 2); ctx.stroke();
            ctx.setLineDash([]); ctx.beginPath(); ctx.arc(x, y, point.innerRadius * s, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.font = 'bold 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('♫', x, y + 6);
        ctx.font = '11px system-ui'; ctx.fillText(point.name, x, y - 14); ctx.restore();
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
        if (!floorVisible(visible, n.elevation ?? 0)) continue;
        if (n.x < b.left || n.x > b.right || n.y < b.top || n.y > b.bottom)
            continue;
        ctx.fillStyle = NPC_DEFINITIONS[n.npcKind].color;
        ctx.beginPath();
        ctx.arc((n.x + .5) * s, (n.y + .5) * s, Math.max(2, s * .24), 0, Math.PI * 2);
        ctx.fill();
        if (selectedIds.has(`npc:${n.id}`)) {
            ctx.strokeStyle = '#f0df9d'; ctx.lineWidth = 2;
            ctx.strokeRect((n.x + .15) * s, (n.y + .15) * s, .7 * s, .7 * s);
        }
        if (n.manual) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
    if (floorVisible(visible, draft.spawnElevation ?? 0)) {
    ctx.strokeStyle = '#fff1b4';
    ctx.lineWidth = 2;
    const spawnX = (draft.spawn.x + (draft.interiorBounds ? .5 : 0)) * s;
    const spawnY = (draft.spawn.y + (draft.interiorBounds ? .5 : 0)) * s;
    ctx.beginPath();
    ctx.arc(spawnX, spawnY, Math.max(4, s * .35), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(spawnX - 8, spawnY);
    ctx.lineTo(spawnX + 8, spawnY);
    ctx.moveTo(spawnX, spawnY - 8);
    ctx.lineTo(spawnX, spawnY + 8);
    ctx.stroke();
    }
    if (gesture?.marquee && gesture.moved) {
        const { start, end } = gesture.marquee;
        const x = Math.min(start.x, end.x) * s, y = Math.min(start.y, end.y) * s;
        const width = Math.abs(start.x - end.x) * s, height = Math.abs(start.y - end.y) * s;
        ctx.fillStyle = '#88cfff25'; ctx.strokeStyle = '#88cfff'; ctx.lineWidth = 1;
        ctx.fillRect(x, y, width, height); ctx.strokeRect(x, y, width, height);
    }
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
        ctx.strokeStyle = canStampAsset({ ...draft, placements: local }, a, pointerTile, undefined, options.activeElevation ?? 0) ? '#d3eaa9' : '#ef9a7e';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(pointerTile.x * s, pointerTile.y * s, a.columns * s, a.rows * s);
        ctx.setLineDash([]);
        drawVisibleAsset(ctx, light ? lightArt! : art, a, { ...pointerTile, id: 'preview', assetId: a.id }, options.activeElevation ?? 0, visible, s, time, .45);
        animated ||= !light && (worldAssetVisual(a).kind === 'fire' || !!a.animation);
    }
    for (const room of world.rooms) {
      if (!floorVisible(visible, 0)) continue;
      const cells = new Set(room.tiles.map(p => `${p.x},${p.y}`)); ctx.strokeStyle = '#c6a2ff'; ctx.lineWidth = 2;
      for (const tile of room.tiles) for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if (!cells.has(`${tile.x + dx},${tile.y + dy}`)) {
        const x = (tile.x + (dx === 1 ? 1 : 0)) * s, y = (tile.y + (dy === 1 ? 1 : 0)) * s;
        ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x + (dx === 0 ? s : 0), y + (dy === 0 ? s : 0)); ctx.stroke();
      }
      const first = room.tiles.slice().sort((a,b) => a.y - b.y || a.x - b.x)[0];
      if (first) { ctx.fillStyle = '#dbc6ff'; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.fillText(room.name, first.x * s + 4, first.y * s + 14); }
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
export function drawAssetGrid(assetCanvas: HTMLCanvasElement, art: WorldAssetArt, a: WorldAsset | undefined, previewFade = false, camera?: AssetGridCamera, editImage = false, visible?: ElevationVisibility, frameOverride?: number): void {
    const assetCtx = assetCanvas.getContext('2d')!;
    const { width, height, dpr } = sizeCanvas(assetCanvas);
    assetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    assetCtx.clearRect(0, 0, width, height);
    const v = assetView(assetCanvas, a, camera);
    if (!v)
        return;
    assetCtx.save();
    assetCtx.translate(v.x, v.y);
    drawVisibleAsset(assetCtx, art, v.a, { id: '', assetId: v.a.id, x: 0, y: 0 }, 0, visible, v.s, performance.now(), 1, previewFade ? 1 : 0, frameOverride);
    {
    const step=v.s/assetCellSubdivision(v.a), columns=assetCellColumns(v.a), rows=assetCellRows(v.a);
    for (let y = Math.max(0,Math.floor(-v.y/step)); y < Math.min(rows,Math.ceil((height-v.y)/step)); y++)
        for (let x = Math.max(0,Math.floor(-v.x/step)); x < Math.min(columns,Math.ceil((width-v.x)/step)); x++) {
            const c = v.a.cells[y * columns + x];
            if(!floorVisible(visible,c.elevation??0))continue;
            assetCtx.fillStyle = c.visibility === 'hide-fade' ? '#c3a9e855' : c.visibility === 'hide' ? '#b0d77955' : c.visibility === 'fade' ? '#79ccdd55' : '#ffffff05';
            assetCtx.fillRect(x * step, y * step, step, step);
            assetCtx.strokeStyle = c.blocked ? '#ee927a' : '#b4c6a866';
            assetCtx.lineWidth = c.blocked ? Math.min(3,step*.12) : Math.min(1,step*.06);
            assetCtx.strokeRect(x * step, y * step, step, step);
            if (c.blocked) {
                assetCtx.beginPath();
                const inset=Math.min(4,step*.2);
                assetCtx.moveTo(x * step + inset, y * step + inset);
                assetCtx.lineTo((x + 1) * step - inset, (y + 1) * step - inset);
                assetCtx.stroke();
            }
            if(c.elevation!==undefined&&step>=16){assetCtx.fillStyle='#fff4c7';assetCtx.font=`600 ${Math.min(14,step*.3)}px system-ui`;assetCtx.fillText(`${c.elevation>0?'+':''}${c.elevation}`,x*step+2,y*step+Math.min(14,step*.35));}
        }
    }
    if (editImage && floorVisible(visible, 0)) {
        const b = worldAssetImageBounds(v.a);
        assetCtx.strokeStyle = '#ffe5a4'; assetCtx.lineWidth = 2; assetCtx.setLineDash([6, 4]);
        assetCtx.strokeRect(b.x * v.s, b.y * v.s, b.width * v.s, b.height * v.s);
    }
    assetCtx.restore();
}
