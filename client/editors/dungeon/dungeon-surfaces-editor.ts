import { BASE_SURFACE, ELEVATION_STEP, MAX_ELEVATION, type SurfaceCell, type SurfaceLink, type SurfaceMaterial, type WallMaterial } from '../../../shared/world-surfaces';
import type { DungeonDraft } from '../../../shared/dungeon-draft';
import type { TileKind, Vec2 } from '../../../shared/types';
import { isSolid } from '../../../shared/world';
import { pickSurfacePoint, planBridge, removeBridge, upsertSurfaceLinks } from '../surface-authoring';
import { planStair, removeStair, stairGeometry } from '../../../shared/surface-stairs';
import { installWallSpriteKitControl } from '../wall-sprite-kit-control';

const materialNames: Record<SurfaceMaterial, string> = { grass: 'Erba', path: 'Terra / sentiero', water: 'Acqua', rock: 'Roccia', bush: 'Cespuglio', mud: 'Fango', snow: 'Neve', ice: 'Ghiaccio', stone: 'Lastre di pietra', brick: 'Mattoni', sand: 'Sabbia', wood: 'Legno' };
const wallNames: Record<WallMaterial, string> = { earth: 'Naturale · terra', rock: 'Naturale · roccia', stone: 'Costruita · pietra lavorata', brick: 'Costruita · mattoni', wood: 'Costruita · legno' };

/** Surface authoring uses the same local tile coordinates as rooms, entities and exports. */
export function installDungeonSurfaces(root: HTMLElement, host: { draft(): DungeonDraft; change(action: () => void): void; tool(): string; setTool(tool: string): void; refresh(): void; draw(): void; status(message: string): void }) {
  const panel = document.createElement('details'); panel.open = true; panel.id = 'dungeon-surfaces'; panel.className = 'maker-disclosure';
  panel.innerHTML = `<summary>Alture e ponti</summary>
    <div class="tool-grid"><button data-tool="surface-raise">Alza +1</button><button data-tool="surface-lower">Abbassa −1</button><button id="dungeon-bridge-new" data-tool="surface-bridge">Ponte tra due sponde</button><button data-tool="surface-link:stairs">Scala</button><button data-tool="surface-link:ramp">Rampa</button><button data-tool="surface-erase">Rimuovi altura / ponte</button></div>
    <label>Pennello<select id="dungeon-surface-brush"><option value="0">1 casella</option><option value="1">3 × 3</option><option value="2">5 × 5</option></select></label>
    <label>Larghezza scala<select id="dungeon-stair-width"><option value="48">1 corsia</option><option value="96">2 corsie</option><option value="144">3 corsie</option></select></label>
    <label>Profilo scala / rampa<select id="dungeon-stair-profile"><option value="incline">Parete inclinata continua</option><option value="incline-45">Parete inclinata · 45°</option><option value="landings">Con pianerottoli alle estremità</option></select></label>
    <p class="hint">Una corsa di 1 tile collega 3 livelli a 45°. Si cammina sulla superficie inclinata; il corpo e i lati restano solidi.</p>
    <label><input id="dungeon-stair-underpass" type="checkbox">Scala sospesa · consenti passaggio sotto</label>
    <label>Larghezza ponte<select id="dungeon-bridge-width"><option value="1">1 corsia</option><option value="2">2 corsie</option><option value="3">3 corsie</option></select></label>
    <label>Tracciato ponte<select id="dungeon-bridge-route"><option value="straight">Rettilineo</option><option value="horizontal-first">Svolta · prima orizzontale</option><option value="vertical-first">Svolta · prima verticale</option></select></label>
    <label><input id="dungeon-bridge-extend" type="checkbox">Prolunga un ponte esistente</label>
    <label><input id="dungeon-show-under" type="checkbox">Mostra sotto i ponti</label>
    <p class="hint">Clicca il piano che vedi: terreno, ponte e oggetti vengono selezionati automaticamente. Alza e Abbassa mantengono i materiali esistenti.</p>
    <details class="selection-advanced"><summary>Materiali e impostazioni avanzate</summary>
      <label>Piano da modificare<select id="dungeon-surface-id"></select></label>
      <label>Materiale del ponte<select id="dungeon-bridge-material">${Object.entries(materialNames).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
      <label>Materiale del terreno<select id="dungeon-surface-material">${Object.entries(materialNames).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
      <label>Bordi delle nuove alture<select id="dungeon-wall-material">${Object.entries(wallNames).map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>
      <label>Kit PNG delle pareti<select id="dungeon-wall-skin"><option value="">Predefinito</option></select></label>
      <p id="dungeon-wall-kit-info" class="hint" role="status" hidden></p>
      <label><input id="dungeon-surface-blocked" type="checkbox">Superficie invalicabile</label>
      <label>Quota precisa<input id="dungeon-elevation" type="number" min="0" max="16" value="1"></label>
      <div class="tool-grid"><button data-tool="surface-paint">Imposta quota e materiali</button><button data-tool="surface-link:bridge-entry">Accesso ponte</button><button data-tool="surface-link-erase">Rimuovi collegamenti</button></div>
      <label>Piano di arrivo del collegamento<select id="dungeon-link-target"></select></label>
    </details>
    <button id="dungeon-link-cancel" hidden>Annulla primo punto</button><p id="dungeon-surface-info" class="hint" role="status"></p>`;
  root.querySelector('#dungeon-section-costruisci')!.append(panel);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  let active = BASE_SURFACE, pending: { point: SurfaceLink['from']; kind: SurfaceLink['kind']; id: string } | undefined, linkHover: SurfaceLink['from'] | undefined;
  let stairPreview: ReturnType<typeof planStair> | undefined, stairError = '';
  let bridge: { from: Vec2; id: string; to?: Vec2; plan?: ReturnType<typeof planBridge>; error?: string } | undefined;
  let draftId = host.draft().id, lastTool = host.tool();
  const visited = new Set<string>();
  el<HTMLSelectElement>('dungeon-surface-material').value = 'grass'; el<HTMLSelectElement>('dungeon-wall-material').value = 'earth'; el<HTMLSelectElement>('dungeon-bridge-material').value = 'wood';
  const wallKit = installWallSpriteKitControl(el<HTMLSelectElement>('dungeon-wall-skin'), el<HTMLSelectElement>('dungeon-wall-material'), () => {
    if (bridge?.to) hover(bridge.to); else if (linkHover) hover(linkHover); host.draw();
  }, el('dungeon-wall-kit-info'));
  const under = () => el<HTMLInputElement>('dungeon-show-under').checked;
  function cancel() { pending = undefined; bridge = undefined; linkHover = undefined; stairPreview = undefined; stairError = ''; refresh(); host.draw(); }
  el<HTMLSelectElement>('dungeon-surface-id').onchange = () => { active = el<HTMLSelectElement>('dungeon-surface-id').value || BASE_SURFACE; cancel(); host.refresh(); };
  el('dungeon-bridge-new').onclick = () => { cancel(); host.setTool('surface-bridge'); refresh(); host.status('Trascina da una sponda all’altra, oppure clicca le due estremità. Gli accessi sono automatici.'); };
  el('dungeon-link-cancel').onclick = cancel;
  el<HTMLInputElement>('dungeon-show-under').onchange = () => { if (under()) active = BASE_SURFACE; cancel(); host.refresh(); };
  for (const id of ['dungeon-bridge-material', 'dungeon-wall-material', 'dungeon-bridge-width', 'dungeon-bridge-route', 'dungeon-stair-width', 'dungeon-stair-profile', 'dungeon-stair-underpass']) el(id).addEventListener('change', () => { if (bridge?.to) hover(bridge.to); else if (linkHover) hover(linkHover); host.draw(); });
  function refresh() {
    if (draftId !== host.draft().id) { draftId = host.draft().id; active = BASE_SURFACE; pending = undefined; bridge = undefined; linkHover = undefined; visited.clear(); }
    if (lastTool !== host.tool()) { lastTool = host.tool(); pending = undefined; bridge = undefined; linkHover = undefined; visited.clear(); }
    const bridges = [...new Set((host.draft().surfaceCells ?? []).filter(c => c.kind !== 'ground').map(c => c.surfaceId))];
    const options = () => [new Option('Automatico · piano visibile', ''), new Option('Terreno / acqua sottostante', BASE_SURFACE), ...bridges.map((id, i) => new Option(id.startsWith('stair:') ? `Scala ${i + 1}` : `Ponte ${i + 1}`, id))];
    for (const id of ['dungeon-surface-id', 'dungeon-link-target']) {
      const field = el<HTMLSelectElement>(id), previous = field.value;
      field.replaceChildren(...options()); field.value = previous === BASE_SURFACE || bridges.includes(previous) ? previous : '';
    }
    if (active !== BASE_SURFACE && !bridges.includes(active)) active = BASE_SURFACE;
    updateInfo();
  }
  function updateInfo() {
    el('dungeon-link-cancel').hidden = !pending && !bridge;
    el('dungeon-surface-info').textContent = bridge ? bridge.error ?? (bridge.plan ? 'Ponte pronto: rilascia o clicca per costruire con entrambi gli accessi.' : 'Scegli la seconda sponda sulla stessa riga o colonna e alla stessa quota.')
      : pending ? stairError || (stairPreview ? stairSummary(stairPreview.stair) : 'Ora clicca il piano di arrivo sulla stessa riga o colonna.')
      : host.tool() === 'surface-bridge' ? 'Trascina tra due sponde alla stessa quota. Terreno e acqua sotto il ponte vengono conservati.'
      : `${host.draft().surfaceCells?.length ?? 0} celle di superficie · ${host.draft().surfaceStairs?.length ?? 0} scale. Clicca due pianerottoli allineati per collegarli.`;
  }
  function stairSummary(stair: ReturnType<typeof planStair>['stair']): string {
    const g = stairGeometry(stair);
    return `Scala pronta · ${g.angle.toFixed(1)}° · corsa ${g.run / 48} tile · ingombro ${g.run / 48 + 1} celle per corsia · ${stair.underpass ? 'sospesa' : 'corpo solido'}. Clicca per costruire.`;
  }
  function surface(point: Vec2, id = active): SurfaceCell | undefined { return host.draft().surfaceCells?.find(c => c.x === point.x && c.y === point.y && c.surfaceId === id); }
  function resolved(point: Vec2): SurfaceCell | undefined {
    const draft = host.draft(), id = point.surfaceId ?? BASE_SURFACE;
    if (point.x < 0 || point.y < 0 || point.x >= draft.width || point.y >= draft.height) return undefined;
    const existing = surface(point, id); if (existing) return { ...existing, blocked: existing.blocked ?? existing.material === 'water' };
    if (id !== BASE_SURFACE) return undefined;
    const material = draft.tiles[point.y * draft.width + point.x];
    return { x: point.x, y: point.y, surfaceId: BASE_SURFACE, elevation: 0, material, wallMaterial: material === 'rock' ? 'rock' : 'earth', kind: 'ground', blocked: isSolid(material) };
  }
  function select(point: Vec2) { active = under() ? BASE_SURFACE : point.surfaceId ?? active; }
  function ref(point: Vec2): Vec2 {
    const id = under() ? BASE_SURFACE : point.surfaceId ?? active, elevation = surface(point, id)?.elevation ?? point.elevation ?? 0;
    return { x: point.x, y: point.y, ...(id !== BASE_SURFACE ? { surfaceId: id } : {}), ...(elevation ? { elevation } : {}) };
  }
  function eraseStructure(point: Vec2, id: string): boolean {
    const draft = host.draft(), stair = draft.surfaceStairs?.find(s =>
      [s.from, s.to].some(p => p.x === point.x && p.y === point.y && p.surfaceId === id)
      || draft.surfaceCells?.some(c => c.x === point.x && c.y === point.y && c.surfaceId === id && c.surfaceId === `stair:${s.id}`)
      || draft.surfaceLinks?.some(l => l.id.startsWith(`${s.id}:`) && [l.from, l.to].some(p => p.x === point.x && p.y === point.y && p.surfaceId === id)));
    return stair ? removeStair(draft, stair.id) : false;
  }
  function apply(point: Vec2, material?: SurfaceMaterial) {
    if (!material && host.tool() === 'surface-erase' && removeBridge(host.draft(), active)) { active = BASE_SURFACE; return; }
    if (!material && eraseStructure(point, active) && active.startsWith('stair:')) {
      active = BASE_SURFACE; if (host.tool() === 'surface-erase') return;
    }
    const draft = host.draft(), cells = draft.surfaceCells ??= [], existing = surface(point), base = resolved({ ...point, surfaceId: active }), key = `${point.x},${point.y}@${active}`;
    if (!material && visited.has(key)) return; visited.add(key);
    if (active !== BASE_SURFACE && !existing && host.tool() !== 'surface-paint') return;
    if (host.tool() === 'surface-erase') {
      draft.surfaceCells = cells.filter(c => c !== existing);
      draft.surfaceLinks = draft.surfaceLinks?.filter(l => ![l.from, l.to].some(p => p.x === point.x && p.y === point.y && p.surfaceId === active));
      if (active === BASE_SURFACE) for (const p of [...draft.entities, ...(draft.assetPlacements ?? [])]) if (p.x === point.x && p.y === point.y && (p.surfaceId ?? BASE_SURFACE) === active) delete p.elevation;
      return;
    }
    const relative = !material && ['surface-raise', 'surface-lower'].includes(host.tool());
    const elevation = material ? existing?.elevation ?? 0 : host.tool() === 'surface-raise' ? Math.min(MAX_ELEVATION, (existing?.elevation ?? 0) + 1) : host.tool() === 'surface-lower' ? Math.max(0, (existing?.elevation ?? 0) - 1) : Math.max(0, Math.min(MAX_ELEVATION, Math.trunc(Number(el<HTMLInputElement>('dungeon-elevation').value) || 0)));
    if (relative && elevation === (existing?.elevation ?? 0)) return;
    const wallSkin = existing && (relative || material) ? existing.wallSkin : material ? undefined : wallKit.skin();
    const cell: SurfaceCell = { x: point.x, y: point.y, surfaceId: active, kind: active === BASE_SURFACE ? 'ground' : 'bridge', elevation,
      material: material ?? (relative ? base?.material : undefined) ?? el<HTMLSelectElement>('dungeon-surface-material').value as SurfaceMaterial,
      wallMaterial: relative || material ? existing?.wallMaterial ?? el<HTMLSelectElement>('dungeon-wall-material').value as WallMaterial : el<HTMLSelectElement>('dungeon-wall-material').value as WallMaterial,
      ...(wallSkin !== undefined ? { wallSkin } : {}) };
    if (relative) { if (existing?.blocked !== undefined) cell.blocked = existing.blocked; }
    else if (material) { if (existing?.blocked !== undefined) cell.blocked = existing.blocked; }
    else if (el<HTMLInputElement>('dungeon-surface-blocked').checked) cell.blocked = true;
    if (existing) { if (!relative && !material) { delete existing.blocked; delete existing.wallSkin; } Object.assign(existing, cell); } else cells.push(cell);
    for (const p of [...draft.entities, ...(draft.assetPlacements ?? [])]) if (p.x === point.x && p.y === point.y && (p.surfaceId ?? BASE_SURFACE) === active) {
      if (elevation) p.elevation = elevation; else delete p.elevation;
    }
  }
  function hover(point: Vec2): boolean {
    if (pending && host.tool().startsWith('surface-link:')) {
      linkHover = { x: point.x, y: point.y, surfaceId: el<HTMLSelectElement>('dungeon-link-target').value || point.surfaceId || active };
      stairPreview = undefined; stairError = '';
      if (pending.kind !== 'bridge-entry') {
        try { stairPreview = makeStair(linkHover); } catch (error) { stairError = error instanceof Error ? error.message : String(error); }
      }
      updateInfo();
      return true;
    }
    if (!bridge || host.tool() !== 'surface-bridge') return false;
    bridge.to = { x: point.x, y: point.y, surfaceId: el<HTMLInputElement>('dungeon-bridge-extend').checked ? point.surfaceId ?? BASE_SURFACE : BASE_SURFACE }; bridge.plan = undefined; bridge.error = undefined;
    if (point.x !== bridge.from.x || point.y !== bridge.from.y) {
      try {
        const plan = planBridge(bridge.from, bridge.to, resolved, { material: el<HTMLSelectElement>('dungeon-bridge-material').value as SurfaceMaterial, wallMaterial: el<HTMLSelectElement>('dungeon-wall-material').value as WallMaterial, wallSkin: wallKit.skin(), id: bridge.id,
          widthTiles: Number(el<HTMLSelectElement>('dungeon-bridge-width').value) as 1 | 2 | 3,
          route: el<HTMLSelectElement>('dungeon-bridge-route').value as 'straight' | 'horizontal-first' | 'vertical-first',
          extendExisting: el<HTMLInputElement>('dungeon-bridge-extend').checked,
          existingAt: (x, y) => (host.draft().surfaceCells ?? []).filter(c => c.x === x && c.y === y),
        });
        bridge.plan = plan;
      }
      catch (error) { bridge.error = error instanceof Error ? error.message : String(error); }
    }
    updateInfo(); return true;
  }
  function buildBridge(): boolean {
    if (host.tool() !== 'surface-bridge' || !bridge?.to || bridge.to.x === bridge.from.x && bridge.to.y === bridge.from.y) return false;
    hover(bridge.to);
    if (!bridge.plan) { host.status(bridge.error ?? 'Scegli due sponde separate da almeno una casella.'); return false; }
    const draft = host.draft(); (draft.surfaceCells ??= []).push(...bridge.plan.cells); upsertSurfaceLinks(draft, bridge.plan.links);
    active = bridge.id; bridge = undefined; updateInfo(); return true;
  }
  function makeStair(to: SurfaceLink['to']) {
    const draft = host.draft();
    return planStair(pending!.point, to, (x, y, id) => resolved({ x, y, surfaceId: id }), {
      id: pending!.id, kind: pending!.kind === 'ramp' ? 'ramp' : 'stairs', width: Number(el<HTMLSelectElement>('dungeon-stair-width').value),
      profile: el<HTMLSelectElement>('dungeon-stair-profile').value === 'landings' ? 'landings' : 'incline',
      ...(el<HTMLSelectElement>('dungeon-stair-profile').value === 'incline-45' ? { angle: 45 as const } : {}),
      underpass: el<HTMLInputElement>('dungeon-stair-underpass').checked,
      material: 'stone', wallMaterial: el<HTMLSelectElement>('dungeon-wall-material').value as WallMaterial, wallSkin: wallKit.skin(),
      cells: draft.surfaceCells, links: draft.surfaceLinks, stairs: draft.surfaceStairs,
    });
  }
  function paint(point: Vec2, previous: Vec2 | null): boolean {
    const tool = host.tool(); if (!tool.startsWith('surface-')) return false;
    select(point);
    const draft = host.draft();
    if (tool === 'surface-bridge') {
      if (previous) { hover(point); return true; }
      if (!bridge) {
        const from = resolved({ ...point, surfaceId: el<HTMLInputElement>('dungeon-bridge-extend').checked ? point.surfaceId ?? BASE_SURFACE : BASE_SURFACE });
        if (!from || from.blocked) { host.status('Inizia da una sponda percorribile, usando terreno o un’altura.'); return true; }
        bridge = { from: { x: point.x, y: point.y, surfaceId: from.surfaceId, elevation: from.elevation }, id: el<HTMLInputElement>('dungeon-bridge-extend').checked && from.kind === 'bridge' ? from.surfaceId : `bridge-${crypto.randomUUID()}` };
      } else { hover(point); buildBridge(); }
      updateInfo(); return true;
    }
    if (tool === 'surface-link-erase') { if (!eraseStructure(point, active)) draft.surfaceLinks = draft.surfaceLinks?.filter(l => ![l.from, l.to].some(p => p.x === point.x && p.y === point.y && p.surfaceId === active)); return true; }
    if (tool.startsWith('surface-link:')) {
      if (previous) return true;
      const kind = tool.slice('surface-link:'.length) as SurfaceLink['kind'];
      if (!pending || pending.kind !== kind) {
        const source = resolved({ ...point, surfaceId: active });
        if (!source || source.blocked) { host.status('Inizia da una superficie percorribile.'); return true; }
        pending = { kind, point: { x: point.x, y: point.y, surfaceId: active }, id: `stairs-${crypto.randomUUID()}` }; linkHover = undefined; stairPreview = undefined; stairError = '';
      }
      else {
        const target = el<HTMLSelectElement>('dungeon-link-target').value || point.surfaceId || active, to = { x: point.x, y: point.y, surfaceId: target };
        if (kind === 'bridge-entry' && Math.abs(pending.point.x - to.x) + Math.abs(pending.point.y - to.y) !== 1) { host.status('Scegli una casella adiacente per l’accesso al ponte.'); return true; }
        const fromSurface = resolved(pending.point), toSurface = resolved(to);
        if (!fromSurface || !toSurface || fromSurface.blocked || toSurface.blocked) { host.status('Scegli due superfici percorribili. Attiva Mostra sotto per raggiungere il terreno coperto.'); return true; }
        if (fromSurface.elevation === toSurface.elevation && fromSurface.surfaceId === toSurface.surfaceId) { host.status('Il passaggio è già continuo. Scegli un bordo tra quote o piani diversi.'); return true; }
        if (kind === 'bridge-entry') upsertSurfaceLinks(draft, [{ id: crypto.randomUUID(), kind, from: pending.point, to }]);
        else {
          try { const plan = makeStair(to); (draft.surfaceCells ??= []).push(...plan.cells); (draft.surfaceStairs ??= []).push(plan.stair); upsertSurfaceLinks(draft, plan.links); }
          catch (error) { host.status(error instanceof Error ? error.message : String(error)); return true; }
        }
        pending = undefined; linkHover = undefined; stairPreview = undefined; stairError = '';
      }
      refresh(); return true;
    }
    const radius = Number(el<HTMLSelectElement>('dungeon-surface-brush').value), from = previous ?? point, steps = Math.max(Math.abs(from.x - point.x), Math.abs(from.y - point.y));
    for (let i = 0; i <= steps; i++) { const t = steps ? i / steps : 1, cx = Math.round(from.x + (point.x - from.x) * t), cy = Math.round(from.y + (point.y - from.y) * t);
      for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) if (x >= 0 && y >= 0 && x < draft.width && y < draft.height) apply({ x, y }); }
    return true;
  }
  function paintMaterial(point: Vec2, material: SurfaceMaterial, blocked?: boolean): void {
    if (active === BASE_SURFACE) { host.draft().tiles[point.y * host.draft().width + point.x] = material as TileKind; if (!surface(point)) return; }
    apply(point, material);
    const existing = surface(point);
    if (existing && blocked === true) existing.blocked = true;
    else if (existing && blocked === false) delete existing.blocked;
  }
  function elevation(point: Vec2): number { return surface(point, point.surfaceId ?? BASE_SURFACE)?.elevation ?? point.elevation ?? 0; }
  function tileAt(x: number, y: number): Vec2 {
    const id = under() || host.tool() === 'surface-bridge' && !el<HTMLInputElement>('dungeon-bridge-extend').checked ? BASE_SURFACE : el<HTMLSelectElement>('dungeon-surface-id').value || undefined;
    return pickSurfacePoint(x, y, (tx, ty) => {
      const ground = resolved({ x: tx, y: ty, surfaceId: BASE_SURFACE });
      return ground ? [ground, ...(host.draft().surfaceCells ?? []).filter(c => c.x === tx && c.y === ty && c.kind !== 'ground')] : [];
    }, id);
  }
  function draw(ctx: CanvasRenderingContext2D, scale: number) {
    const center = (p: SurfaceLink['from']) => ({ x: (p.x + .5) * scale, y: (p.y + .5 - (surface(p, p.surfaceId)?.elevation ?? 0) * ELEVATION_STEP / 48) * scale });
    ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = '#ffd989';
    for (const l of host.draft().surfaceLinks ?? []) {
      if (under() && [l.from, l.to].some(p => p.surfaceId !== BASE_SURFACE)) continue;
      const a = center(l.from), b = center(l.to); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.fillStyle = '#ffd989'; for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
    }
    if (pending) {
      const p = center(pending.point); ctx.strokeRect(p.x - scale / 2, p.y - scale / 2, scale, scale);
      if (linkHover) {
        const q = center(linkHover), destination = resolved(linkHover), valid = pending.kind === 'bridge-entry' ? Math.abs(pending.point.x - linkHover.x) + Math.abs(pending.point.y - linkHover.y) === 1 && destination && !destination.blocked : !!stairPreview;
        ctx.strokeStyle = valid ? '#95e4b4' : '#f18b79'; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.strokeRect(q.x - scale / 2, q.y - scale / 2, scale, scale); ctx.setLineDash([]);
      }
      if (stairPreview) {
        const geometry = stairGeometry(stairPreview.stair); ctx.strokeStyle = '#95e4b4'; ctx.fillStyle = '#95e4b433';
        for (const c of stairPreview.cells) ctx.fillRect(c.x * scale, (c.y - c.elevation * ELEVATION_STEP / 48) * scale, scale, scale);
        ctx.beginPath(); for (let i = 0; i <= 24; i++) { const t = i / 24, p = geometry.pointAt(t), x = p.x * scale / 48, y = (p.y - geometry.elevationAt(t) * ELEVATION_STEP) * scale / 48;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke();
      }
    }
    if (bridge) {
      ctx.setLineDash([5, 3]); ctx.strokeStyle = bridge.error ? '#f18b79' : '#95e4b4'; ctx.fillStyle = '#95e4b440';
      const p = center({ x: bridge.from.x, y: bridge.from.y, surfaceId: BASE_SURFACE }); ctx.strokeRect(p.x - scale / 2, p.y - scale / 2, scale, scale);
      for (const c of bridge.plan?.cells ?? []) { const y = (c.y - c.elevation * ELEVATION_STEP / 48) * scale; ctx.fillRect(c.x * scale, y, scale, scale); ctx.strokeRect(c.x * scale, y, scale, scale); }
      if (bridge.to) { const q = center({ ...bridge.to, surfaceId: BASE_SURFACE }); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (scale > 14) for (const c of host.draft().surfaceCells ?? []) if (c.surfaceId === active && (!under() || c.kind === 'ground')) { ctx.font = '10px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#ffffffb0'; ctx.fillText(`${c.elevation}`, c.x * scale + 3, (c.y - c.elevation * ELEVATION_STEP / 48) * scale + 3); }
    ctx.restore();
  }
  return { refresh, paint, paintMaterial, ref, elevation, tileAt, draw, hover, select, cancel, showUnder: under, activeId: () => active, finish: (cancelled = false) => { visited.clear(); if (cancelled) { pending = undefined; bridge = undefined; linkHover = undefined; } else buildBridge(); } };
}
