import type { Vec2 } from '../../../shared/types';
import type { WorldDocument } from '../../../shared/world-schema';
import type { World } from '../../../shared/world';
import { BASE_SURFACE, ELEVATION_STEP, type SurfaceCell, type SurfaceLink, type SurfaceMaterial, type SurfaceStair, type WallMaterial } from '../../../shared/world-surfaces';
import { pickSurfacePoint, planBridge, removeBridge, upsertSurfaceLinks } from '../surface-authoring';
import { planStair, removeStair, stairGeometry } from '../../../shared/surface-stairs';
import { installWallSpriteKitControl } from '../wall-sprite-kit-control';

const materials: [SurfaceMaterial, string][] = [['grass', 'Erba'], ['path', 'Terra / sentiero'], ['water', 'Acqua'], ['rock', 'Roccia'], ['stone', 'Lastre di pietra'], ['brick', 'Mattoni'], ['sand', 'Sabbia'], ['wood', 'Legno'], ['mud', 'Fango'], ['snow', 'Neve'], ['ice', 'Ghiaccio']];
const walls: [WallMaterial, string][] = [['rock', 'Roccia naturale'], ['earth', 'Terra naturale'], ['stone', 'Muro di pietra'], ['brick', 'Muro di mattoni'], ['wood', 'Legno']];
export const elevationTools = [['raise-height', '↑', 'Alza +1'], ['lower-height', '↓', 'Abbassa −1'], ['bridge', '═', 'Traccia ponte'], ['surface-link', '⇄', 'Scala / rampa'], ['clear-height', '↧', 'Ripristina terreno'], ['clear-bridge', '⌫', 'Rimuovi ponte'], ['clear-link', '×', 'Rimuovi accesso'], ['height', '▰', 'Dipingi livello']] as const;
export const elevationControls = `<details id="elevation-controls" open><summary>Alture, acqua e ponti</summary><div class="tool-grid">${elevationTools.map(([id, icon, name]) => `<button data-tool="${id}"><span>${icon}</span>${name}</button>`).join('')}</div><div class="fields"><label>Materiale<select id="surface-material">${materials.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label><label>Bordi e pareti<select id="surface-wall">${walls.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label><label class="check"><input id="surface-show-under" type="checkbox">Mostra sotto i ponti</label><p id="surface-plane-hint" class="hint">Clicca il piano visibile per selezionarlo.</p><label>Accesso<select id="surface-link-kind"><option value="stairs">Scala</option><option value="ramp">Rampa</option><option value="bridge-entry">Ingresso a un ponte esistente</option></select></label>
<label>Kit PNG delle pareti<select id="surface-wall-skin"><option value="">Predefinito</option></select></label>
<p id="surface-wall-kit-info" class="hint" role="status" hidden></p>
<label>Larghezza scala<select id="surface-stair-width"><option value="48">1 corsia</option><option value="96">2 corsie</option><option value="144">3 corsie</option></select></label>
<label>Profilo scala / rampa<select id="surface-stair-profile"><option value="incline">Parete inclinata continua</option><option value="incline-45">Parete inclinata · 45°</option><option value="landings">Con pianerottoli alle estremità</option></select></label>
<p id="surface-stair-profile-info" class="hint">La salita occupa spazio sul terreno: una corsa di 1 tile collega 3 livelli a 45°. La superficie superiore è calpestabile; il corpo e i lati restano solidi.</p>
<label class="check"><input id="surface-stair-underpass" type="checkbox">Scala sospesa · consenti passaggio sotto</label>
<label>Larghezza ponte<select id="surface-bridge-width"><option value="1">1 corsia</option><option value="2">2 corsie</option><option value="3">3 corsie</option></select></label>
<label>Tracciato ponte<select id="surface-bridge-route"><option value="straight">Rettilineo</option><option value="horizontal-first">Svolta · prima orizzontale</option><option value="vertical-first">Svolta · prima verticale</option></select></label>
<label class="check"><input id="surface-bridge-extend" type="checkbox">Prolunga un ponte esistente</label>
<button id="surface-link-cancel" type="button" hidden>Annulla primo punto</button><p id="surface-link-hint" class="hint" role="status">Alza o abbassa con il pennello. Per scale e rampe clicca due piani allineati; per un ponte scegli le due sponde.</p><details><summary>Livello preciso e opzioni avanzate</summary><label>Livello · 0–16<input id="surface-elevation" type="number" min="0" max="16" step="1" value="1"></label><label class="check"><input id="surface-blocked" type="checkbox">Superficie non percorribile</label><label>Piano per gli oggetti<select id="placement-surface"><option value="auto">Automatico · piano cliccato</option><option value="ground">Terreno</option></select></label></details><a id="surface-lab" class="wide dungeon-editor-link" href="/surface-lab.html" target="riftlands-surfaces">Laboratorio alture e ponti ↗</a></div></details>`;

export interface SurfacePaintSettings { elevation: number; material: SurfaceMaterial; wallMaterial: WallMaterial; wallSkin?: string; surfaceId: string; blocked: boolean; }
const cellKey = (point: { x: number; y: number; surfaceId: string }) => `${point.surfaceId}:${point.x},${point.y}`;
const endpointAt = (end: SurfaceLink['from'], point: Vec2, surfaceId: string) => end.x === point.x && end.y === point.y && end.surfaceId === surfaceId;
const introductoryHint = 'Alza o abbassa con il pennello. Per scale e rampe clicca due piani allineati; per un ponte scegli due sponde alla stessa quota.';
function stairAt(document: WorldDocument, point: Vec2, surfaceId = point.surfaceId ?? BASE_SURFACE): SurfaceStair | undefined {
    return document.surfaceStairs?.find(stair => [stair.from, stair.to].some(p => endpointAt(p, point, surfaceId))
      || document.surfaceCells?.some(c => c.x === point.x && c.y === point.y && c.surfaceId === surfaceId && c.surfaceId === `stair:${stair.id}`)
      || document.surfaceLinks?.some(link => link.id.startsWith(`${stair.id}:`) && [link.from, link.to].some(p => endpointAt(p, point, surfaceId))));
}

/** Surface edits share the brush transaction, including references placed on the edited ground. */
export class SurfaceStroke {
    private indices: Map<string, number>;
    constructor(private readonly document: WorldDocument, private readonly lookup?: (point: Vec2) => SurfaceCell | undefined) {
        document.surfaceCells ??= [];
        this.indices = new Map(document.surfaceCells.map((cell, i) => [cellKey(cell), i]));
    }
    paint(point: Vec2, tool: string, settings: SurfacePaintSettings): void {
        const structure = stairAt(this.document, point);
        if (structure && ['clear-height', 'clear-bridge', 'clear-link', 'height', 'raise-height', 'lower-height'].includes(tool)) {
            removeStair(this.document, structure.id);
            this.indices = new Map((this.document.surfaceCells ?? []).map((cell, i) => [cellKey(cell), i]));
            if (['clear-bridge', 'clear-link'].includes(tool)) return;
        }
        const surfaceId = tool === 'clear-bridge' ? point.surfaceId ?? settings.surfaceId : BASE_SURFACE;
        if (tool === 'clear-bridge' && surfaceId === BASE_SURFACE) return;
        if (tool === 'clear-bridge' && removeBridge(this.document, surfaceId)) {
            this.indices = new Map((this.document.surfaceCells ?? []).map((cell, i) => [cellKey(cell), i])); return;
        }
        const key = cellKey({ ...point, surfaceId }), cells = this.document.surfaceCells!;
        const index = this.indices.get(key), existing = index === undefined ? this.lookup?.({ ...point, surfaceId }) : cells[index];
        let elevation = settings.elevation;
        if (tool === 'clear-height' || tool === 'clear-bridge') {
            if (index !== undefined) {
                const last = cells.pop()!; this.indices.delete(key);
                if (index < cells.length) { cells[index] = last; this.indices.set(cellKey(last), index); }
            }
            this.document.surfaceLinks = (this.document.surfaceLinks ?? []).filter(link => !endpointAt(link.from, point, surfaceId) && !endpointAt(link.to, point, surfaceId));
            elevation = 0;
        } else if (tool === 'clear-link') {
            this.document.surfaceLinks = (this.document.surfaceLinks ?? []).filter(link => !endpointAt(link.from, point, point.surfaceId ?? BASE_SURFACE) && !endpointAt(link.to, point, point.surfaceId ?? BASE_SURFACE));
            return;
        } else {
            const relative = tool === 'raise-height' || tool === 'lower-height';
            if (relative) elevation = Math.max(0, Math.min(16, (existing?.elevation ?? 0) + (tool === 'raise-height' ? 1 : -1)));
            if (relative && elevation === (existing?.elevation ?? 0)) return;
            const wallSkin = relative && index !== undefined ? existing!.wallSkin : settings.wallSkin;
            const cell: SurfaceCell = { x: point.x, y: point.y, surfaceId, elevation, material: relative ? existing?.material ?? settings.material : settings.material,
                wallMaterial: relative && index !== undefined ? existing!.wallMaterial : settings.wallMaterial,
                ...(wallSkin !== undefined ? { wallSkin } : {}), kind: 'ground', ...(relative ? index !== undefined && existing?.blocked !== undefined ? { blocked: existing.blocked } : {} : settings.blocked ? { blocked: true } : {}) };
            if (index === undefined) { this.indices.set(key, cells.length); cells.push(cell); } else cells[index] = cell;
        }
        if (surfaceId === BASE_SURFACE) for (const p of [...this.document.placements, ...this.document.npcs, this.document.spawn]) {
            if (p.x !== point.x || p.y !== point.y || (p.surfaceId ?? BASE_SURFACE) !== surfaceId) continue;
            if (elevation) p.elevation = elevation; else delete p.elevation;
        }
    }
    paintMaterial(point: Vec2, material: SurfaceMaterial, blocked?: boolean): void {
        const surfaceId = point.surfaceId ?? BASE_SURFACE, key = cellKey({ ...point, surfaceId });
        const index = this.indices.get(key);
        if (index !== undefined) {
            const cell = this.document.surfaceCells![index]; cell.material = material;
            if (blocked === true) cell.blocked = true;
            else if (blocked === false) delete cell.blocked;
        } else if (['stone', 'brick', 'sand', 'wood'].includes(material) || material === 'rock' && blocked === false) {
            if (surfaceId !== BASE_SURFACE) throw new Error('Il piano selezionato non esiste più. Scegli un pavimento o un ponte presente.');
            const base = this.lookup?.({ ...point, surfaceId });
            const cell: SurfaceCell = { x: point.x, y: point.y, surfaceId, kind: 'ground', elevation: base?.elevation ?? point.elevation ?? 0,
                material, wallMaterial: base?.wallMaterial ?? 'earth', ...(base?.wallSkin !== undefined ? { wallSkin: base.wallSkin } : {}),
                ...(blocked === true ? { blocked: true } : {}) };
            this.indices.set(key, this.document.surfaceCells!.length); this.document.surfaceCells!.push(cell);
        }
    }
}

export class WorldElevationEditor {
    private pending?: SurfaceLink['from'];
    private pendingStairId = '';
    private bridgeStart?: Vec2;
    private bridgeId = '';
    private hovered?: Vec2;
    private active = BASE_SURFACE;
    constructor(private readonly root: HTMLElement, private readonly change: (action: () => void) => void, private readonly document: () => WorldDocument, private readonly world: () => World, private readonly redraw: () => void) {
        installWallSpriteKitControl(this.root.querySelector<HTMLSelectElement>('#surface-wall-skin')!, this.root.querySelector<HTMLSelectElement>('#surface-wall')!, this.redraw,
            this.root.querySelector<HTMLElement>('#surface-wall-kit-info')!);
        this.root.querySelector('#surface-link-cancel')!.addEventListener('click', () => this.cancel());
        this.root.querySelector('#surface-show-under')!.addEventListener('change', () => { this.active = BASE_SURFACE; this.cancel(); });
        for (const id of ['surface-stair-width', 'surface-stair-profile', 'surface-stair-underpass', 'surface-bridge-width', 'surface-bridge-route', 'surface-link-kind'])
            this.root.querySelector(`#${id}`)!.addEventListener('change', () => this.redraw());
    }
    private value(id: string): string { return this.root.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!.value.trim(); }
    private hint(message: string): void { this.root.querySelector('#surface-link-hint')!.textContent = message; }
    settings(): SurfacePaintSettings {
        const elevation = Number(this.value('surface-elevation'));
        if (!Number.isInteger(elevation) || elevation < 0 || elevation > 16) throw new Error('Il livello deve essere un intero fra 0 e 16.');
        return { elevation, surfaceId: this.active, material: this.value('surface-material') as SurfaceMaterial, wallMaterial: this.value('surface-wall') as WallMaterial,
            wallSkin: this.value('surface-wall-skin') || undefined, blocked: this.root.querySelector<HTMLInputElement>('#surface-blocked')!.checked };
    }
    showUnder(): boolean { return this.root.querySelector<HTMLInputElement>('#surface-show-under')!.checked; }
    pick(x: number, y: number, tool: string, support = this.world()): Vec2 {
        const choice = this.value('placement-surface');
        const bridgeGround = tool === 'bridge' && !this.root.querySelector<HTMLInputElement>('#surface-bridge-extend')!.checked;
        const forced = this.showUnder() || bridgeGround || ['height', 'raise-height', 'lower-height', 'clear-height', 'restore', 'zone', 'dungeon'].includes(tool) ? BASE_SURFACE : choice === 'auto' ? undefined : choice;
        return pickSurfacePoint(x, y, (tx, ty) => support.surfacesAt(tx, ty), forced);
    }
    select(point: Vec2): void {
        this.active = point.surfaceId ?? BASE_SURFACE;
        const ids = [...new Set((this.document().surfaceCells ?? []).filter(c => c.kind === 'bridge').map(c => c.surfaceId))];
        const name = this.active === BASE_SURFACE ? 'Terreno' : this.active.startsWith('stair:') ? 'Scala' : `Ponte ${ids.indexOf(this.active) + 1}`;
        this.root.querySelector('#surface-plane-hint')!.textContent = `${name} · livello ${point.elevation ?? 0}`;
    }
    placement(point: Vec2): Vec2 {
        const choice = this.value('placement-surface'), surfaceId = choice === 'auto' ? point.surfaceId ?? this.active : choice;
        const cell = this.world().surfaceAt(point.x, point.y, surfaceId);
        if (!cell) throw new Error('Clicca un piano esistente per posizionare l’oggetto.');
        return { x: point.x, y: point.y, ...(surfaceId !== BASE_SURFACE ? { surfaceId } : {}), ...(cell.elevation ? { elevation: cell.elevation } : {}) };
    }
    activeSurface(): string { return this.active; }
    refresh(): void {
        const ids = [...new Set((this.document().surfaceCells ?? []).filter(c => c.kind !== 'ground').map(cell => cell.surfaceId))];
        const select = this.root.querySelector<HTMLSelectElement>('#placement-surface')!, previous = select.value;
        select.replaceChildren(new Option('Automatico · piano cliccato', 'auto'), new Option('Terreno', BASE_SURFACE), ...ids.map((id, i) => new Option(id.startsWith('stair:') ? `Scala ${i + 1}` : `Ponte ${i + 1}`, id)));
        select.value = previous === 'auto' || previous === BASE_SURFACE || ids.includes(previous) ? previous : 'auto';
        if (!ids.includes(this.active)) this.active = BASE_SURFACE;
    }
    cancel(): void {
        this.pending = undefined; this.pendingStairId = ''; this.bridgeStart = undefined; this.hovered = undefined;
        this.root.querySelector<HTMLElement>('#surface-link-cancel')!.hidden = true;
        this.hint(introductoryHint); this.redraw();
    }
    hover(point?: Vec2): void { this.hovered = point; }
    beginBridge(point: Vec2): void {
        if (this.bridgeStart) { this.finishBridge(point); return; }
        const extend = this.root.querySelector<HTMLInputElement>('#surface-bridge-extend')!.checked;
        const cell = this.world().surfaceAt(point.x, point.y, extend ? point.surfaceId ?? BASE_SURFACE : BASE_SURFACE);
        if (!cell || cell.blocked || cell.material === 'water') throw new Error('Inizia il ponte su una sponda percorribile.');
        this.bridgeStart = { x: point.x, y: point.y, surfaceId: cell.surfaceId, elevation: cell.elevation };
        this.bridgeId = extend && cell.kind === 'bridge' ? cell.surfaceId : `bridge-${crypto.randomUUID()}`;
        this.root.querySelector<HTMLElement>('#surface-link-cancel')!.hidden = false;
        this.hint('Trascina fino all’altra sponda, oppure cliccala. Le estremità devono avere la stessa quota.'); this.redraw();
    }
    private bridgePlan(to: Vec2) {
        const settings = this.settings();
        const result = planBridge(this.bridgeStart!, to, p => this.world().surfaceAt(p.x, p.y, p.surfaceId ?? BASE_SURFACE), {
            material: settings.material === 'grass' ? 'wood' : settings.material, wallMaterial: settings.wallMaterial, wallSkin: settings.wallSkin, id: this.bridgeId,
            widthTiles: Number(this.value('surface-bridge-width')) as 1 | 2 | 3,
            route: this.value('surface-bridge-route') as 'straight' | 'horizontal-first' | 'vertical-first',
            existingAt: (x, y) => this.world().surfacesAt(x, y), extendExisting: this.root.querySelector<HTMLInputElement>('#surface-bridge-extend')!.checked,
        });
        for (const p of [this.bridgeStart!, to, ...result.cells]) if (this.world().dungeons.some(d => p.x >= d.layout.bounds.minTx && p.x <= d.layout.bounds.maxTx && p.y >= d.layout.bounds.minTy && p.y <= d.layout.bounds.maxTy))
            throw new Error('Il ponte attraversa un dungeon del catalogo. Aprilo nel Dungeon Maker per modificarlo.');
        for (const cell of result.cells) if (this.world().surfacesAt(cell.x, cell.y).some(c => c.kind === 'bridge' && c.surfaceId !== this.bridgeId && c.elevation === cell.elevation)) throw new Error('Il tracciato incrocia un ponte alla stessa altezza. Scegli un’altra posizione.');
        return result;
    }
    finishBridge(point: Vec2): void {
        if (!this.bridgeStart || point.x === this.bridgeStart.x && point.y === this.bridgeStart.y) return;
        const plan = this.bridgePlan(point);
        this.change(() => { const doc = this.document(); doc.surfaceCells ??= []; doc.surfaceCells.push(...plan.cells); upsertSurfaceLinks(doc, plan.links); });
        this.active = this.bridgeId; this.cancel();
    }
    private stairPlan(to: SurfaceLink['to']) {
        const doc = this.document(), source = this.world().surfaceAt(this.pending!.x, this.pending!.y, this.pending!.surfaceId);
        const kind = this.value('surface-link-kind'), settings = this.settings();
        const result = planStair(this.pending!, to, (x, y, id) => this.world().surfaceAt(x, y, id), {
            id: this.pendingStairId, kind: kind === 'ramp' ? 'ramp' : 'stairs', width: Number(this.value('surface-stair-width')),
            profile: this.value('surface-stair-profile') === 'landings' ? 'landings' : 'incline',
            ...(this.value('surface-stair-profile') === 'incline-45' ? { angle: 45 as const } : {}),
            underpass: this.root.querySelector<HTMLInputElement>('#surface-stair-underpass')!.checked,
            material: source?.material, wallMaterial: settings.wallMaterial, wallSkin: settings.wallSkin,
            cells: doc.surfaceCells, links: doc.surfaceLinks, stairs: doc.surfaceStairs,
        });
        for (const point of [result.stair.from, result.stair.to, ...result.cells])
            if (this.world().dungeons.some(d => point.x >= d.layout.bounds.minTx && point.x <= d.layout.bounds.maxTx && point.y >= d.layout.bounds.minTy && point.y <= d.layout.bounds.maxTy))
                throw new Error('La scala attraversa un dungeon del catalogo. Aprilo nel Dungeon Maker per modificarlo.');
        return result;
    }
    click(point: Vec2): void {
        const surfaceId = point.surfaceId ?? BASE_SURFACE;
        const cell = this.world().surfaceAt(point.x, point.y, surfaceId);
        if (!cell || cell.blocked || cell.material === 'water') throw new Error('Clicca un piano percorribile.');
        const endpoint = { x: point.x, y: point.y, surfaceId };
        if (!this.pending) {
            this.pending = endpoint; this.pendingStairId = `stairs-${crypto.randomUUID()}`; this.root.querySelector<HTMLElement>('#surface-link-cancel')!.hidden = false;
            this.hint(`Partenza al livello ${cell.elevation}. Clicca il piano di arrivo sulla stessa riga o colonna.`); this.redraw(); return;
        }
        const from = this.pending;
        const source = this.world().surfaceAt(from.x, from.y, from.surfaceId);
        if (!source) { this.cancel(); throw new Error('Il piano di partenza non esiste più.'); }
        if (source.elevation === cell.elevation && source.surfaceId === cell.surfaceId) throw new Error('Questi due punti sono già collegati.');
        const kind = source.surfaceId !== cell.surfaceId && source.elevation === cell.elevation ? 'bridge-entry' : this.value('surface-link-kind') as SurfaceLink['kind'];
        if (kind === 'bridge-entry' && source.elevation !== cell.elevation) throw new Error('Per un dislivello scegli Scala o Rampa.');
        if (kind === 'bridge-entry') {
            if (Math.abs(from.x - point.x) + Math.abs(from.y - point.y) !== 1) throw new Error('Per l’accesso al ponte scegli una cella adiacente.');
            this.change(() => upsertSurfaceLinks(this.document(), [{ id: `link-${crypto.randomUUID()}`, kind, from, to: endpoint }]));
        } else {
            const plan = this.stairPlan(endpoint);
            this.change(() => { const doc = this.document(); (doc.surfaceCells ??= []).push(...plan.cells);
                (doc.surfaceStairs ??= []).push(plan.stair); upsertSurfaceLinks(doc, plan.links); });
        }
        this.cancel();
    }
    draw(canvas: HTMLCanvasElement, view: { x: number; y: number; scale: number }): void {
        const start = this.pending ?? this.bridgeStart;
        if (!start) return;
        const ctx = canvas.getContext('2d')!, dpr = canvas.width / canvas.getBoundingClientRect().width, s = view.scale;
        const y = (p: Vec2) => (p.y - (this.world().surfaceAt(p.x, p.y, p.surfaceId ?? BASE_SURFACE)?.elevation ?? 0) * ELEVATION_STEP / 48) * s;
        ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, view.x * dpr, view.y * dpr);
        ctx.strokeStyle = '#f2d99a'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
        ctx.strokeRect(start.x * s, y(start), s, s);
        if (this.hovered) {
            let valid = true, preview: SurfaceCell[] = [];
            let stair: SurfaceStair | undefined;
            try { if (this.bridgeStart) preview = this.bridgePlan(this.hovered).cells;
                else if (this.value('surface-link-kind') === 'bridge-entry') valid = Math.abs(start.x - this.hovered.x) + Math.abs(start.y - this.hovered.y) === 1;
                else { const plan = this.stairPlan({ x: this.hovered.x, y: this.hovered.y, surfaceId: this.hovered.surfaceId ?? BASE_SURFACE }); preview = plan.cells; stair = plan.stair; } }
            catch (e) { valid = false; this.hint(e instanceof Error ? e.message : 'Tracciato non valido.'); }
            ctx.strokeStyle = valid ? '#c9e6a3' : '#ef9a7e'; ctx.fillStyle = '#c9e6a344';
            for (const cell of preview) { const cy = (cell.y - cell.elevation * ELEVATION_STEP / 48) * s; ctx.fillRect(cell.x * s, cy, s, s); ctx.strokeRect(cell.x * s, cy, s, s); }
            if (stair) {
                const geometry = stairGeometry(stair); ctx.beginPath();
                for (let i = 0; i <= 24; i++) { const t = i / 24, p = geometry.pointAt(t), x = p.x * s / 48, py = (p.y - geometry.elevationAt(t) * ELEVATION_STEP) * s / 48;
                    if (i) ctx.lineTo(x, py); else ctx.moveTo(x, py); }
                ctx.stroke(); this.hint(`Scala pronta · ${geometry.angle.toFixed(1)}° · corsa ${geometry.run / 48} tile · ingombro ${geometry.run / 48 + 1} celle per corsia · ${stair.underpass ? 'sospesa' : 'corpo solido'}. Clicca per costruire.`);
            }
            ctx.beginPath(); ctx.moveTo((start.x + .5) * s, y(start) + s / 2); ctx.lineTo((this.hovered.x + .5) * s, y(this.hovered) + s / 2); ctx.stroke();
            if (valid && this.bridgeStart) this.hint('Ponte pronto: rilascia o clicca per costruirlo con entrambi gli accessi.');
        }
        ctx.restore();
    }
}
