import { installWorldPaintingPanel } from './world-painting-panel';
import { installElevationEditor } from './elevation-editor';
import { validElevation } from '../../../shared/elevation';
import { TerrainElevationBrush } from '../../../shared/terrain-elevation-editing';
import { ensureTerrainAccess } from '../../../shared/terrain-access';
import { cliffAsset, cliffCell, cliffCellFloor, cliffLevels, installCliffAssets } from '../../../shared/cliff-assets';
import { subdivideWorldAsset, assetCellColumns, assetCellRows, assetCellSubdivision, ASSET_CELL_SUBDIVISIONS } from '../../../shared/world-schema';
import { CLIFF_VARIANTS, type CliffVariant } from '../../../shared/terrain-cliffs';
import { floorVisible } from './elevation-visibility';
import { syncWorldAssetFiles } from './world-asset-sync';
import { repairWorldAssetPaths } from '../../../shared/world-asset-paths';
import { assetFilePath } from '../../../shared/world-asset-paths';
import { organizeWorldPanels } from './world-panels';
import { npcPropertiesMarkup, fillNpcProperties, readNpcProperties } from '../npc-properties';
import { newDungeonInterior } from '../../../shared/warps';
import './world-maker.css';
import { installActorEditor } from './boss-editor';
import { installPlayerEditor } from './player-editor';
import { importWorldAsset } from './world-asset-import';
import { field, tools, terrains, worldMakerLayout } from './world-maker-layout';
import { drawWorldEditorMap, drawAssetGrid as renderAssetGrid, assetView as assetGridView } from './world-editor-canvas';
import { WORLD_DOCUMENT } from '../../../shared/world-content';
import { World } from '../../../shared/world';
import { coordinateHash } from '../../../shared/coordinate-random';
import { assetVariants, pickAssetVariant } from '../../../shared/asset-variants';
import type { TileKind, Vec2 } from '../../../shared/types';
import { NPC_DEFINITIONS } from '../../../shared/npcs';
import { INSTALLED_DUNGEON_DEFINITIONS as DUNGEON_DEFINITIONS, type DungeonDefinition } from '../../../shared/dungeons';
import { worldDungeons, validateWorld } from '../../../shared/world-validation';
import { shapeBounds } from '../../../shared/world-authoring';
import { newWorldAsset, parseWorldDocument, resizeWorldAsset, worldAssetVisual, worldAssetImageBounds, DEFAULT_ASSET_FADE, WORLD_TERRAINS, type WorldDocument, type WorldAsset, type WorldZone, type AssetCell, type AssetPlacement } from '../../../shared/world-schema';
import { brushTiles, strokeTiles, WorldBrush, forkWorldDocument } from '../../../shared/world-editing';
import { compactWorldTiles, worldTileMetrics, worldDocumentsEqual } from '../../../shared/world-tiles';
import { WorldAssetArt } from '../../render/world-asset-art';
import { DEFAULT_ASSET_SHADOW, worldAssetShadow } from '../../../shared/world-schema';
import { rasterizeAssetShadow } from '../../render/world-asset-shadow';
import { WorldEditorHistory } from './world-editor-history';
import { WorldAssetCatalog, assetGroup } from './world-asset-catalog';
import { installWorldImagePicker } from './world-image-picker';
import { AssetGridCamera } from '../../render/world-asset-view';
import { loadWorldCheckpoint, saveWorldCheckpoint, WorldCheckpointConflictError } from './world-editor-storage';
import { assetPickFloor, assetInSelection, selectionRect, intersectsSelection, canPaintTerrainLevel, compareAssetDrawOrder } from './world-picking';
import { WorldInspectorDrafts } from './world-inspector-drafts';
import { installWorldWorkspace } from './world-workspace';
import { locateWorldIssue, type WorldIssueLocation } from './world-problems';
import { mapDocument } from '../../../shared/warps';
import { installWarpEditor } from './warp-editor';
import { installZoneClimateControls } from './world-climate-controls';
const root = document.getElementById('world-maker')!;
root.innerHTML = worldMakerLayout;
root.querySelector('.top-actions')!.insertAdjacentHTML('afterbegin', '<label class="check light-mode-toggle" title="Anteprima leggera: senza mare animato, maschere e ombre; asset semplificati. Il progetto e il gioco mantengono tutti gli effetti."><input id="light-mode" type="checkbox">Light mode <small>solo editor</small></label>');
organizeWorldPanels(root);
installActorEditor();
installPlayerEditor();
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const val = (id: string) => (el(id) as HTMLInputElement | HTMLSelectElement).value;
const num = (id: string) => Number(val(id));
const set = (id: string, value: unknown) => { (el(id) as HTMLInputElement | HTMLSelectElement).value = String(value ?? ''); };
try { input('light-mode').checked = localStorage.getItem('riftlands.world-maker.light-mode') === 'true'; } catch { /* Optional editor preference. */ }
input('zone-template').closest('label')!.insertAdjacentHTML('afterend', '<label class="check" title="Temperatura e umidità cambiano gradualmente dal bordo verso l’interno."><input id="zone-create-climate-transition" type="checkbox">Clima graduale nelle nuove zone</label>');
input('zone-moisture').closest('.pair')!.insertAdjacentHTML('afterend', '<label class="check"><input id="zone-climate-transition" type="checkbox">Sfuma temperatura e umidità verso l’interno</label><label id="zone-climate-depth-label" hidden>Profondità sfumatura %<input id="zone-climate-depth" type="number" min="1" max="100" step="1" value="100"></label><p class="hint">Al bordo eredita il clima circostante, poi raggiunge i valori impostati. 100%: al centro del cerchio o a metà del lato più corto del rettangolo; 50%: a metà di questa distanza, con un interno uniforme. Vale solo per temperatura e umidità non vuote. Disattivato: cambio immediato al bordo.</p>');
const climateControls = installZoneClimateControls(root);
const refreshClimateTransitionControl = () => { el('zone-climate-depth-label').hidden = !input('zone-climate-transition').checked; climateControls.refresh(); };
input('zone-climate-depth').title = 'La variazione è più rapida nella parte esterna e rallenta avvicinandosi al valore interno.';
input('zone-climate-transition').addEventListener('change', refreshClimateTransitionControl);
let failedChanges = 0;
const on = (id: string, action: () => void | Promise<void>) => el(id).addEventListener('click', () => { void Promise.resolve().then(async () => { await settleGesture(); const failures=failedChanges; await action(); if(failures===failedChanges)acceptInspectorAction(id); }).catch(report); });
const report = (e: unknown) => { el('status').textContent = e instanceof Error ? e.message : String(e); };
const status = (s: string) => { el('status').textContent = s; };
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
let draft = forkWorldDocument(compactWorldTiles(WORLD_DOCUMENT)), catalog: readonly DungeonDefinition[] = DUNGEON_DEFINITIONS, token = '', revision = '', installedRevision = '', ready = false;
let world: World, tool = 'select', activeAsset = draft.assets[0]?.id ?? '', selected: {
    kind: 'placement' | 'npc' | 'dungeon' | 'zone';
    id: string;
} | null = null;
type ObjectSelection = { kind: 'placement' | 'npc'; id: string; generated?: AssetPlacement };
let selectedObjects: ObjectSelection[] = [], groupPrimary: { kind: 'placement' | 'npc' | 'dungeon' | 'zone'; id: string } | null = null;
function clearObjectSelection(): void { selectedObjects = []; groupPrimary = null; }
let worldDirty = true, framePending = false, dirty = false, checkpointQueue = Promise.resolve();
let draftConflict = false;
let animationTimer: ReturnType<typeof setTimeout> | undefined;
let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
let pendingCheckpoint: { document: WorldDocument; revision: string } | undefined;
let installedDocument = draft;
let recoverableDraft: WorldDocument | undefined;
const recoverDraftButton = document.createElement('button');
recoverDraftButton.id = 'recover-world-draft'; recoverDraftButton.textContent = 'Ripristina bozza precedente'; recoverDraftButton.hidden = true;
root.querySelector('.top-actions')!.prepend(recoverDraftButton);
recoverDraftButton.onclick = () => { void settleGesture().then(() => {
    if (!recoverableDraft) return;
    const recovered = recoverableDraft;
    change(() => { draft = forkWorldDocument(recovered); selected = null; });
    recoverableDraft = undefined; recoverDraftButton.hidden = true;
    status('Bozza precedente ripristinata per la modifica. Applica al gioco per pubblicarla.');
}).catch(report); };
let appliedDocument: WorldDocument | undefined;
let applyingWorld = false, projectGeneration = 0;
let lastAssetPublication = '';
const studioChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('riftlands.studio') : undefined;
const history = new WorldEditorHistory(), canvas = el<HTMLCanvasElement>('map');
const assetCanvas = el<HTMLCanvasElement>('asset-grid');
const assetCamera = new AssetGridCamera();
let cameraAsset = '';
const assetCatalog = new WorldAssetCatalog(el('asset-list'), id => {
    if (!root.classList.contains('catalog-pinned')) el<HTMLDialogElement>('asset-catalog-dialog').close();
    void settleGesture().then(() => { activeAsset = id; selected = null; selectedGenerated = undefined; warpEditor.clearSelection(); selectTool('asset'); refresh(); revealInspector(); }).catch(report);
});
const art = new WorldAssetArt(() => schedule());
let view = { x: 0, y: 0, scale: 24 }, pointerTile: Vec2 | null = null;
let activeMap = 'world';
function surface(): WorldDocument {
    if (activeMap === 'world') return draft;
    const m = draft.interiors?.find(m => m.id === activeMap);
    if (!m) return draft;
    m.document.assets = draft.assets; m.document.seed = draft.seed; m.document.cliffAssets = draft.cliffAssets;
    return m.document;
}
const warpEditor = installWarpEditor(root, {
    elevation: () => elevationEditor.elevation(),
    isElevationVisible: e => floorVisible(elevationEditor.visibility(), e),
    rooms: id => { const doc = mapDocument(draft, id); return worldDungeons(doc, catalog).flatMap(d => (d.rooms ?? []).map(room => ({ ...room, id: `${d.id}:${room.id}` }))); },
    catalog: () => catalog,
    project: () => draft, mapId: () => activeMap, tool: () => tool, selectTool,
    change, center: p => centerAt(p.x + .5, p.y + .5),
    inspect: () => { selected = null; selectedGenerated = undefined; refresh(); revealInspector(); schedule(); },
    switchMap: id => {
        finishGesture(); if (gesture) throw new Error('Attendi la fine della modifica prima di cambiare mappa.');
        mapDocument(draft, id);
        activeMap = id; selected = null; selectedGenerated = undefined;
        worldDirty = true;
        refresh(); schedule(true); centerAt(surface().spawn.x, surface().spawn.y);
    },
});
const refreshPainting = installWorldPaintingPanel(root, surface, change);
const elevationEditor = installElevationEditor(root, canvas, assetCanvas, {
    document: surface, asset: active, tool: () => tool,
    terrainAt: (x,y) => { ensureWorld(); return world.elevation.terrainElevationAt(x,y); },
    selectTool: next => { selected = null; selectedGenerated = undefined; warpEditor.clearSelection(); selectTool(next); refresh(); revealInspector(); }, change, schedule, panHeld: () => keys.has('Space'),
    visibilityChanged: () => { selected = null; selectedGenerated = undefined; if (!warpEditor.isPlacing()) warpEditor.clearSelection(); refresh(); schedule(); },
    mapPoint: e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.scale, y: (e.clientY - r.top - view.y) / view.scale }; },
    assetPoint: e => { const v = assetView(); if (!v) return; const r = assetCanvas.getBoundingClientRect(); return { x: (e.clientX - r.left - v.x) / v.s, y: (e.clientY - r.top - v.y) / v.s }; },
});
const inspectorDrafts = new WorldInspectorDrafts(root, section => section === 'asset-inspector' ? `asset:${activeAsset}`
    : section === 'warp-inspector' ? `warp:${warpEditor.selectedId()}`
    : `${activeMap}:${section}:${selected?.kind ?? ''}:${selected?.id ?? ''}`);
function acceptInspectorAction(id: string): void {
    if (id === 'asset-update') inspectorDrafts.accept('asset-inspector');
    else if (id === 'gen-update') inspectorDrafts.accept('asset-inspector', ['gen-enabled','gen-category','gen-temp-min','gen-temp-max','gen-moist-min','gen-moist-max','gen-density','gen-spacing',...WORLD_TERRAINS.map(t=>`gen-terrain-${t}`)]);
    else if (id.startsWith('asset-image-')) inspectorDrafts.accept('asset-inspector', ['asset-image-x','asset-image-y','asset-image-scale']);
    else if (id.startsWith('asset-shadow-') && id !== 'asset-shadow-png') inspectorDrafts.accept('asset-inspector', ['asset-shadow-inherit', 'asset-shadow-enabled', ...Object.keys(DEFAULT_ASSET_SHADOW).map(key => `asset-shadow-${key}`)]);
    else if (id === 'asset-fade-update') inspectorDrafts.accept('asset-inspector', ['fade-opacity','fade-feather','fade-duration']);
    else if (id === 'selection-update') inspectorDrafts.accept('selection-inspector');
    else if (id === 'zone-update') inspectorDrafts.accept('zone-inspector');
    else return;
    refresh();
}
function revealInspector(): void {
    const inspector = root.querySelector<HTMLElement>('.inspector')!;
    inspector.classList.remove('collapsed'); root.classList.remove('inspector-hidden');
    inspector.querySelector<HTMLElement>(':scope > section:not([hidden]), :scope > details:not([hidden])')?.scrollIntoView({ block: 'start' });
}
const cliffPanel = document.createElement('details'); cliffPanel.id = 'cliff-asset-controls'; cliffPanel.open = true;
cliffPanel.innerHTML = `<summary>Bordi automatici · cliff-grid</summary><label>Pezzo di bordo<select id="cliff-variant">${CLIFF_VARIANTS.map(v=>`<option value="${v}">${v.startsWith('90corner') ? `Corner basso ${v.slice(9)}°` : v}</option>`).join('')}</select></label><button id="cliff-edit" class="wide">Modifica immagine e collisioni</button><p class="hint">Le modifiche valgono per tutti i bordi automatici di questo tipo. Ogni bordo occupa un tile: la griglia dell’asset permette di suddividerne le collisioni. Sfondo passa dietro ai personaggi; Oggetto può coprirli.</p>`;
root.querySelector('.inspector')!.insertBefore(cliffPanel, el('asset-inspector'));
function openCliffAsset(variant: CliffVariant): void {
    if (!draft.cliffAssets?.[variant]) change(() => { installCliffAssets(draft); });
    const id = draft.cliffAssets?.[variant]; if (!id) return;
    activeAsset = id; selected = null; selectedGenerated = undefined; warpEditor.clearSelection();
    set('cliff-variant',variant); selectTool('asset'); refresh(); schedule();
    el('asset-inspector').scrollIntoView({ block: 'start' });
}
on('cliff-edit', () => openCliffAsset(val('cliff-variant') as CliffVariant));
el('asset-update').insertAdjacentHTML('beforebegin', `<div class="fields"><label>Suddivisione di ogni tile<select id="asset-cell-subdivision">${ASSET_CELL_SUBDIVISIONS.map(n=>`<option value="${n}">${n} × ${n} · ${n*n} ${n===1?'cella':'sottocelle'} per tile</option>`).join('')}</select></label><p id="asset-cell-info" class="hint"></p><p class="hint">Divide solo le celle di collisione e visibilità. Le dimensioni del PNG, la scala e la posizione dell’oggetto restano le stesse. Aumentando la suddivisione, le sottocelle ereditano le proprietà; riducendola si conservano blocchi e nascondigli presenti.</p></div>`);
for (const [id,label] of [['asset-width','Larghezza oggetto · tile'],['asset-height','Altezza oggetto · tile']]) input(id).closest('label')!.firstChild!.textContent=label;
input('asset-cell-subdivision').addEventListener('change',()=>{
    const division=num('asset-cell-subdivision'); void settleGesture().then(()=>change(()=>subdivideWorldAsset(active()!,division))).catch(report);
});
input('cell-blocked').closest('.pair')!.insertAdjacentHTML('afterend','<label>Piano delle sottocelle che dipingi<select id="cell-floor"><option value="keep">Mantieni quota esistente</option><option value="0">0 · stessa quota della base</option><option value="1">+1 · un piano sopra la base</option><option value="-1">−1 · un piano sotto la base</option><option value="custom">Quota relativa personalizzata…</option><option value="inherit">Rimuovi quota personalizzata</option></select></label><label id="cell-floor-custom-label" hidden>Offset dalla base dell’asset<input id="cell-floor-custom" type="number" min="-128" max="127" step="1" value="1"></label><p class="hint">Calpestabile + quota +1 crea il pavimento superiore solo nelle sottocelle dipinte. Nei cliff-grid la base è il terreno inferiore. Per cambiare piano configura una scala o un passaggio sul terreno o su un PNG.</p>');
input('cell-floor').addEventListener('change',()=>{el('cell-floor-custom-label').hidden=val('cell-floor')!=='custom';});
input('cell-floor-custom').addEventListener('change',()=>set('cell-floor-custom',Math.max(-128,Math.min(127,Math.round(num('cell-floor-custom'))||0))));
const cellVisibilityLabels: Record<AssetCell['visibility'], string> = {
    normal: 'Normale', hide: 'Nascondiglio', fade: 'Trasparente al passaggio', 'hide-fade': 'Nascondiglio + trasparenza',
};
const cellControls = input('cell-blocked').closest('.pair')!;
input('cell-blocked').closest('label')!.firstChild!.textContent = 'Movimento da applicare';
input('cell-visibility').closest('label')!.firstChild!.textContent = 'Visibilità da applicare';
cellControls.insertAdjacentHTML('beforebegin', '<h3>Proprietà delle celle</h3><p id="asset-cell-state" class="cell-status" aria-live="polite"></p><p class="cell-status">Scegli i valori da applicare, poi clicca sui quadratini o premi “Applica a tutte le celle”. I valori misti restano invariati finché non scegli un valore.</p>');
cellControls.insertAdjacentHTML('afterend', '<p id="asset-cell-pending" class="cell-status" role="status" hidden>Valori da applicare: dipingi i quadratini o premi “Applica a tutte le celle”.</p>');
for (const id of ['cell-blocked', 'cell-visibility']) {
    const mixed = new Option('Valori misti · mantieni', '');
    el<HTMLSelectElement>(id).prepend(mixed);
    el(id).addEventListener('change', () => { el('asset-cell-pending').hidden = false; });
}
let cellControlsSignature = '';
function refreshCellControls(a: WorldAsset): void {
    const counts = new Map<string, number>();
    for (const c of a.cells) {
        const label = `${c.blocked ? 'Bloccante' : 'Calpestabile'} · ${cellVisibilityLabels[c.visibility]}`;
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    el('asset-cell-state').textContent = `Stato attuale di ${a.name}: ${[...counts].map(([label, count]) => `${count} ${count === 1 ? 'cella' : 'celle'} ${label}`).join('; ')}.`;
    const signature = JSON.stringify([a.id, a.cells]);
    if (signature === cellControlsSignature) return;
    cellControlsSignature = signature;
    const first = a.cells[0];
    set('cell-blocked', a.cells.every(c => c.blocked === first.blocked) ? first.blocked : '');
    set('cell-visibility', a.cells.every(c => c.visibility === first.visibility) ? first.visibility : '');
    el('asset-cell-pending').hidden = true;
}
function paintedAssetCell(previous:AssetCell):AssetCell {
    const cell:AssetCell={blocked:val('cell-blocked')===''?previous.blocked:val('cell-blocked')==='true',visibility:(val('cell-visibility')||previous.visibility) as AssetCell['visibility'],...(previous.elevation!==undefined?{elevation:previous.elevation}:{})};
    const mode=val('cell-floor');if(mode==='inherit')delete cell.elevation;
    else if(mode!=='keep') {const elevation=mode==='custom'?num('cell-floor-custom'):Number(mode);if(!validElevation(elevation))throw new Error('La quota della sottocella deve essere intera da -128 a 127.');cell.elevation=elevation;}
    return cell;
}
let gesture: {
    pointer: number;
    before: WorldDocument;
    start: Vec2;
    last: Vec2;
    pan?: Vec2;
    spawnMove?: Vec2;
    warpMove?: { id: string; side: 'entry' | 'arrival'; x: number; y: number };
    move?: { kind: 'placement' | 'npc' | 'dungeon' | 'zone'; id: string; x: number; y: number };
    marquee?: { start: Vec2; end: Vec2; tile: Vec2 };
    groupMove?: { item: ObjectSelection; x: number; y: number }[];
    cell?: boolean;
    cellLast?: Vec2;
    image?: { x: number; y: number; scale: number; unit: number };
    tool: string;
    mass: boolean;
    brush?: WorldBrush;
    terrainBrush?: TerrainElevationBrush;
    pending?: Vec2[];
    cursor?: number;
    ending?: boolean;
    screenStart?: Vec2;
    moved?: boolean;
    blockedLevels?: number;
    settings?: { radius: number; density: number; bushJs: boolean; terrain: TileKind; asset?: WorldAsset; elevation?: number };
} | null = null;
const keys = new Set<string>();
let selectedGenerated: AssetPlacement | undefined;
set('brush-radius', 1);
set('brush-density', 100);
function ensureWorld(): void {
  if (gesture?.terrainBrush?.flush()) worldDirty = true;
  const updated = gesture?.brush?.flushTiles() ?? [];
  if (updated.length && world && !worldDirty) world.updateAuthoredTiles(mapDocument(draft, activeMap), updated);
  if (worldDirty) {
    world = new World(draft.seed, 96, 'world', mapDocument(draft, activeMap), worldDungeons(mapDocument(draft, activeMap), catalog));
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
    checkpointQueue = checkpointQueue.catch(() => { }).then(() => { if (draftConflict) throw new WorldCheckpointConflictError(); return saveWorldCheckpoint(snapshot); });
    void checkpointQueue.then(() => {
        studioChannel?.postMessage({ type: 'world-draft' });
        const signature = JSON.stringify(snapshot.document.assets);
        if (signature !== lastAssetPublication) { lastAssetPublication = signature; studioChannel?.postMessage({ type: 'assets', assets: snapshot.document.assets }); }
    }).catch(() => {});
    void checkpointQueue.then(() => { if (dirty)
        el('save-state').textContent = 'Bozza salvata · da applicare'; }).catch(e => {
          if (e instanceof WorldCheckpointConflictError) { draftConflict = true; el('draft-conflict').hidden = false; report(e); }
          el('save-state').textContent = draftConflict ? 'Conflitto fra schede · esporta o recupera' : 'Salvataggio fallito · esporta'; refresh();
        });
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
            const counts = worldTileMetrics(surface());
            if (counts.cells > 20_000_000 || counts.runs > 2_000_000 || surface().tileChunks!.length > 100_000) throw new Error('Budget terreno raggiunto: annulla o riduci gli interventi.');
        } else draft = parseWorldDocument(draft);
    }
    catch (e) {
        failedChanges++;
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
        failedChanges++;
        draft = before;
        refresh();
        schedule(true);
        report(e);
    }
}
function selectTool(next: string): void { tool = next; root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === next))); el('tool-label').textContent = tools.find(t => t[0] === next)?.[2] ?? (next === 'warp' ? 'Passaggio' : next === 'elevation-configure' ? 'Nuovo terreno' : root.querySelector(`[data-elevation-tool="${next.replace('elevation-', '')}"]`)?.textContent ?? next); schedule(); }
root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => b.onclick = () => { warpEditor.clearSelection(); selectTool(b.dataset.tool!); refresh(); });
input('bush-js').addEventListener('change', () => { selected = null; warpEditor.clearSelection(); selectTool('terrain'); refresh(); });
input('terrain').addEventListener('change', () => { selected = null; warpEditor.clearSelection(); selectTool('terrain'); refresh(); });
input('terrain-elevation').addEventListener('change', () => {
    const elevation = elevationEditor.terrainElevation();
    if (elevation !== undefined && !validElevation(elevation)) { set('terrain-elevation', ''); status('Usa una quota intera da -128 a 127.'); }
    schedule();
});
function active(): WorldAsset | undefined { return draft.assets.find(a => a.id === activeAsset); }
function palette(): void {
    assetCatalog.update(draft.assets, activeAsset, val('asset-search'));
}
let validationActive = false;
let validatedDraft: typeof draft | undefined;
function showValidation(): string[] {
    const issues = validateWorld(parseWorldDocument(draft), catalog);
    validatedDraft = draft;
    for (const id of ['issues', 'validation-details']) el(id).replaceChildren(...issues.map(message => {
        const li = document.createElement('li'), location=locateWorldIssue(draft,message);
        if(location){const button=document.createElement('button');button.className='issue-link';button.textContent=message;button.onclick=()=>focusWorldIssue(location);li.append(button);}else li.textContent=message;
        return li;
    }));
    el('validation-alert').hidden = !issues.length;
    el('validation-summary').textContent = issues.length ? `⚠ ${issues.length} ${issues.length === 1 ? 'problema da correggere' : 'problemi da correggere'} · ${issues[0]} · Mostra dettagli` : '';
    return issues;
}
function focusWorldIssue(location: WorldIssueLocation): void {
    finishGesture(undefined,true);elevationEditor.cancelGesture();warpEditor.clearSelection();selected=null;selectedGenerated=undefined;
    if(activeMap!==location.mapId){set('surface-map',location.mapId);input('surface-map').dispatchEvent(new Event('change'));}
    set('elevation-view','all');set('elevation-active',location.elevation);input('elevation-active').dispatchEvent(new Event('change'));
    if(location.kind==='warp')warpEditor.select(location.id!);
    else if(location.kind==='surfaces'||location.kind==='solids'||location.kind==='stairs')elevationEditor.selectShape(location.kind,location.id!);
    else if(location.kind){selectTool('select');selected={kind:location.kind,id:location.id!};}
    refresh();centerAt(location.point.x+.5,location.point.y+.5);revealInspector();schedule(true);
}
function refresh(): void {
    if (selected !== groupPrimary || tool !== 'select') clearObjectSelection();
    input('bush-js').disabled = !['grass', 'bush'].includes(val('terrain'));
    if (activeMap !== 'world' && !draft.interiors?.some(m => m.id === activeMap)) activeMap = 'world';
    refreshPainting();
    elevationEditor.refresh();
    if (validationActive && validatedDraft !== draft) showValidation();
    if (activeMap !== 'world' && !draft.interiors?.some(m => m.id === activeMap)) activeMap = 'world';
    warpEditor.refresh();
    if (!active())
        activeAsset = draft.assets[0]?.id ?? '';
    palette();
    set('seed', draft.seed);
    el<HTMLButtonElement>('undo').disabled = !history.canUndo;
    el<HTMLButtonElement>('redo').disabled = !history.canRedo;
    el<HTMLButtonElement>('apply-world').disabled = !token || !ready || draftConflict || applyingWorld;
    el<HTMLButtonElement>('asset-delete-permanently').disabled = !token || !ready || draftConflict;
    const cells = worldTileMetrics(surface()).cells;
    el('map-info').textContent = `${cells.toLocaleString('it-IT')} celle · ${surface().placements.length} asset · ${surface().zones.length} zone`;
    const dungeonSelect = el<HTMLSelectElement>('dungeon'), previous = dungeonSelect.value;
    dungeonSelect.replaceChildren(...catalog.map(d => new Option(d.name, d.id)));
    dungeonSelect.value = catalog.some(d => d.id === previous) ? previous : catalog[0]?.id ?? '';
    const zone = selected?.kind === 'zone' ? surface().zones.find(z => z.id === selected!.id) : undefined;
    el('zone-inspector').hidden = !zone;
    if (zone)
        refreshZone(zone);
    el('selection-inspector').hidden = !selected || selected.kind === 'zone';
    if (selected && selected.kind !== 'zone')
        refreshSelection();
    el('asset-inspector').hidden = !!selected || !active() || (tool !== 'asset' && !(tool.startsWith('elevation-') && elevationEditor.editsAsset())) || warpEditor.hasSelection();
    const cliffVariant = CLIFF_VARIANTS.find(variant => draft.cliffAssets?.[variant] === activeAsset);
    cliffPanel.hidden = el('asset-inspector').hidden || !cliffVariant;
    if (cliffVariant) set('cliff-variant', cliffVariant);
    el('elevation-inspector').hidden = !!selected || warpEditor.hasSelection() || !(tool.startsWith('elevation-') || tool === 'terrain' || tool === 'restore');
    el('inspector-empty').hidden = !!selected || warpEditor.hasSelection() || !el('elevation-inspector').hidden || ((tool === 'asset' || tool.startsWith('elevation-')) && !!active());
    if (!selected && active())
        refreshAsset(active()!);
    el('zone-list').replaceChildren(...surface().zones.map(z => { const b = document.createElement('button'); b.textContent = `${z.name} · ${z.priority}`; b.onclick = () => { selected = { kind: 'zone', id: z.id }; const bounds = shapeBounds(z.shape); centerAt((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2); refresh(); }; return b; }));
    inspectorDrafts.restore();
    refreshClimateTransitionControl();
    root.dispatchEvent(new Event('world-refresh'));
}
function refreshAsset(a: WorldAsset): void {
    refreshCellControls(a);
    const generation = (a.variantOf ? draft.assets.find(other => other.id === a.variantOf) : a)!.generation;
    set('asset-cell-subdivision',assetCellSubdivision(a));
    el('asset-cell-info').textContent=`Griglia: ${assetCellColumns(a)} × ${assetCellRows(a)} celle. Ogni cella: 1/${assetCellSubdivision(a)} di tile (${48/assetCellSubdivision(a)} unità).`;
    const visual = worldAssetVisual(a);
    const shadow = effectiveAsset(a).shadow;
    el('asset-shadow-inherit-label').hidden = !a.variantOf;
    input('asset-shadow-inherit').checked = !!a.variantOf && a.shadow === undefined;
    input('asset-shadow-enabled').checked = !!shadow;
    set('asset-shadow-kind', (shadow ?? DEFAULT_ASSET_SHADOW).kind);
    el<HTMLSelectElement>('asset-shadow-kind').disabled = visual.kind !== 'image';
    for (const key of ['x', 'y', 'width', 'height', 'opacity', 'softness', 'skew'] as const) {
        set(`asset-shadow-${key}`, Math.round((shadow ?? DEFAULT_ASSET_SHADOW)[key] * 10000) / 100);
        input(`asset-shadow-${key}`).disabled = visual.kind !== 'image';
    }
    for (const id of ['asset-shadow-enabled', 'asset-shadow-update', 'asset-shadow-reset', 'asset-shadow-png'])
        el<HTMLInputElement | HTMLButtonElement>(id).disabled = visual.kind !== 'image';
    set('asset-visual', visual.kind === 'fire' ? visual.style : 'image');
    const fade = a.fade ?? DEFAULT_ASSET_FADE;
    set('fade-opacity', Math.round(fade.opacity * 100_000) / 1000); set('fade-feather', fade.feather); set('fade-duration', fade.durationMs);
    set('asset-name', a.name);
    const count = [draft,...(draft.interiors??[]).map(m=>m.document)].reduce((n,doc)=>n+doc.placements.filter(p=>p.assetId===a.id).length,0);
    el('asset-scope').textContent = `Definizione condivisa · ${count} copie manuali · ${catalog.filter(d=>d.assetPlacements?.some(p=>p.assetId===a.id)).length} dungeon`;
    const sharedImages = draft.assets.filter(other => other.id !== a.id && assetFilePath(other.image) === assetFilePath(a.image));
    el('asset-image-usage').textContent = `File: ${decodeURIComponent(a.image)}${sharedImages.length ? ` · Condiviso con: ${sharedImages.map(other => `${other.name} (${other.id})`).join(', ')}` : ' · Nessun altro asset del catalogo usa questo file'}`;
    set('asset-group', assetGroup(a));
    const variants = el<HTMLSelectElement>('asset-variant-of');
    variants.replaceChildren(new Option('Autonomo / asset principale', ''), ...draft.assets.filter(other => other.id !== a.id && !other.variantOf).map(other => new Option(other.name, other.id)));
    variants.value = a.variantOf ?? '';
    variants.disabled = draft.assets.some(other => other.variantOf === a.id);
    input('asset-group').readOnly = true;
    input('asset-group').title = 'Derivata dalla cartella immagine in public/world-assets.';
    el('asset-groups').replaceChildren(...[...new Set(draft.assets.flatMap(a => a.group ? [a.group] : []))].sort().map(group => new Option(group)));
    el('asset-preview-title').textContent = `Celle · ${a.name}`;
    set('asset-width', a.width);
    set('asset-height', a.height);
    set('asset-image-x', Math.round((a.imageTransform?.x ?? 0) * 10000) / 10000); set('asset-image-y', Math.round((a.imageTransform?.y ?? 0) * 10000) / 10000);
    set('asset-image-scale', (a.imageTransform?.scale ?? 1) * 100);
    set('asset-layer', a.layer);
    set('asset-pivot', a.pivot.y);
    input('gen-enabled').checked = generation.enabled;
    set('gen-category', generation.category);
    set('gen-temp-min', generation.temperature[0]);
    set('gen-temp-max', generation.temperature[1]);
    set('gen-moist-min', generation.moisture[0]);
    set('gen-moist-max', generation.moisture[1]);
    set('gen-density', generation.density * 100);
    set('gen-spacing', generation.spacing);
    el('gen-terrains').replaceChildren(...WORLD_TERRAINS.map(t => { const l = document.createElement('label'); l.className = 'check'; const c = document.createElement('input'); c.id=`gen-terrain-${t}`; c.type = 'checkbox'; c.value = t; c.checked = generation.terrains.includes(t); l.append(c, terrains[t].name); return l; }));
    for (const field of el('asset-inspector').querySelectorAll<HTMLInputElement | HTMLButtonElement>('[id^="gen-"]')) field.disabled = !!a.variantOf;
}
let musicSources: string[] = [];
function refreshMusicOptions(src?: string): void {
    const select = el('zone-music') as HTMLSelectElement;
    select.replaceChildren(new Option('Eredita / nessuna', ''), ...[...new Set([...musicSources, ...(src ? [src] : [])])].sort().map(path => new Option(path.split('/').at(-1), path)));
    select.value = src ?? '';
}
function fileData(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}
function musicZones(project: WorldDocument): WorldZone[] { return [project, ...(project.interiors ?? []).map(m => m.document)].flatMap(doc => doc.zones).filter(z => !!z.music); }
function refreshZone(z: WorldZone): void {
    refreshMusicOptions(z.music?.src);
    set('zone-music-volume', (z.music?.volume ?? .5) * 100);
    set('zone-name', z.name);
    set('zone-priority', z.priority);
    set('zone-shape', z.shape.kind);
    set('zone-x', z.shape.x);
    set('zone-y', z.shape.y);
    set('zone-width', z.shape.kind === 'circle' ? z.shape.radius : z.shape.width);
    set('zone-height', z.shape.kind === 'rect' ? z.shape.height : '');
    set('zone-temperature', z.temperature);
    set('zone-moisture', z.moisture);
    input('zone-climate-transition').checked = z.climateTransition !== undefined;
    set('zone-climate-depth', (z.climateTransition ?? 1) * 100);
    climateControls.fill(z);
    set('zone-pvp', z.pvp);
    set('zone-generation', z.generateAssets);
    set('zone-arena', z.arenaId);
    set('zone-quest', z.questId);
    input('zone-npcs').checked = !!z.npcs;
    set('zone-density', z.npcs ? z.npcs.density * 100 : 100);
    set('zone-limit', z.npcs?.maxPerChunk ?? 3);
    for (const k of ['slime', 'wisp', 'sentinel'] as const)
        set(`zone-${k}`, z.npcs?.weights[k] ?? (k === 'slime' ? 100 : 0));
}
function selectionEntity(): any {
    if (!selected)
        return;
    return selected.kind === 'placement' ? surface().placements.find(p => p.id === selected!.id) ?? (selectedGenerated?.id === selected.id ? selectedGenerated : undefined) : selected.kind === 'npc' ? surface().npcs.find(n => n.id === selected!.id)
        : selected.kind === 'dungeon' ? surface().dungeons.find(d => d.dungeonId === selected!.id) ?? (() => { const d = worldDungeons(mapDocument(draft, activeMap), catalog).find(d => d.id === selected!.id); return d ? { dungeonId: d.id, x: d.layout.bounds.minTx, y: d.layout.bounds.minTy } : undefined; })() : surface().zones.find(z => z.id === selected!.id);
}
function refreshSelection(): void {
    el('selection-update').hidden = selectedObjects.length > 1;
    if (selectedObjects.length > 1) {
        el('selection-title').textContent = `${selectedObjects.length} oggetti selezionati`;
        el('selection-fields').textContent = 'Trascina un oggetto selezionato per spostare il gruppo. Premi Canc per rimuoverlo.';
        return;
    }
    const e = selectionEntity();
    if (!e) {
        selected = null;
        el('selection-inspector').hidden = true;
        return;
    }
    el('selection-title').textContent = selected?.kind === 'dungeon' ? 'Posizione dungeon' : selected?.kind === 'npc' ? 'NPC manuale' : 'Istanza asset';
    el('selection-fields').innerHTML = `<div class="pair">${field('entity-x', 'X · celle')}${field('entity-y', 'Y · celle')}</div>${selected?.kind === 'npc' ? field('entity-level', 'Livello') : ''}${selected?.kind === 'dungeon' ? '<label>PvP del dungeon<select id="entity-pvp"><option value="">Eredita dalla mappa</option><option value="false">Disabilitato</option><option value="true">Abilitato</option></select></label><p class="hint">Le zone con una regola PvP esplicita hanno precedenza.</p>' : ''}`;
    set('entity-x', e.x);
    if (selected?.kind === 'npc') {
        el('selection-fields').insertAdjacentHTML('beforeend', npcPropertiesMarkup('selected-npc'));
        fillNpcProperties(root, 'selected-npc', e.npcKind, e.settings);
        el('selection-title').textContent = NPC_DEFINITIONS[e.npcKind as keyof typeof NPC_DEFINITIONS].disposition === 'neutral' ? 'NPC' : 'Mob';
    }
    set('entity-y', e.y);
    if (selected?.kind === 'placement' || selected?.kind === 'npc') {
        el('selection-fields').insertAdjacentHTML('beforeend', field('entity-elevation', selected.kind === 'placement' ? 'Quota base' : 'Quota'));
        if (selected.kind === 'placement') {
            set('entity-elevation', e.baseElevation ?? '');
            ensureWorld(); input('entity-elevation').placeholder = `Eredita terreno · quota ${world.elevation.terrainElevationAt(e.x + .5, e.y + .5)}`;
        } else set('entity-elevation', e.elevation ?? 0);
    }
    if (selected?.kind === 'dungeon') set('entity-pvp', e.pvp === undefined ? '' : String(e.pvp));
    if (selected?.kind === 'npc')
        set('entity-level', e.level);
    if (selected?.kind === 'placement') {
        const definition = draft.assets.find(a=>a.id===e.assetId)!;
        el('selection-title').textContent = definition.name;
        const card = document.createElement('div');card.className='selection-card';
        const image=document.createElement('img');image.src=definition.image;image.alt=definition.name;
        const label=document.createElement('span');label.textContent='Questa copia · posizione, quota e ordine di disegno';card.append(image,label);el('selection-fields').prepend(card);
        el('selection-fields').insertAdjacentHTML('beforeend', '<label>Base per ordine disegno · 0–1<input id="entity-pivot" type="number" min="0" max="1" step="0.05" placeholder="Eredita dal catalogo"></label><p class="hint">Vale solo per questa copia. Vuoto: usa il valore del catalogo. A parità di posizione, una base più bassa viene disegnata sopra.</p>');
        set('entity-pivot', e.pivotY);
        const b = document.createElement('button');
        b.textContent = 'Modifica asset nel catalogo';
        b.onclick = () => { activeAsset = e.assetId; selected = null; selectedGenerated = undefined; warpEditor.clearSelection(); selectTool('asset'); refresh(); revealInspector(); schedule(); };
        el('selection-fields').append(b);
        const variant = document.createElement('button'); variant.textContent = 'Crea variante per questa copia';
        variant.onclick = () => change(() => { materializeSelection(); const placement = selectionEntity(); const source = draft.assets.find(a => a.id === placement.assetId)!;
            const copy = structuredClone(effectiveAsset(source)); copy.id = uid('asset'); copy.name = `${source.name} · variante`.slice(0,160); copy.generation.enabled = false;
            delete copy.variantOf;
            draft.assets.push(copy); placement.assetId = copy.id; activeAsset = copy.id;
        }); el('selection-fields').append(variant);
    }
}
function draw(): void {
    ensureWorld();
    const lightMode = input('light-mode').checked;
    const animated = drawWorldEditorMap(canvas, world, mapDocument(draft, activeMap), view, art, { lightMode, painting: input('show-painting').checked, grid: input('show-grid').checked, cells: input('show-cells').checked,
        zones: input('show-zones').checked, npcs: input('show-npcs').checked, selected, selectedObjects, gesture, pointerTile, tool, activeAsset: active() && effectiveAsset(active()!), activeElevation: elevationEditor.elevation(), visibleElevations: elevationEditor.visibility() });
    if (!lightMode && (animated || (!el('asset-inspector').hidden && active() && worldAssetVisual(active()!).kind === 'fire')) && animationTimer === undefined)
        animationTimer = setTimeout(() => { animationTimer = undefined; schedule(); }, 33);
    warpEditor.draw(canvas, view, elevationEditor.visibility());
    const ctx = canvas.getContext('2d')!, dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
    ctx.save(); ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    elevationEditor.draw(ctx, false); ctx.restore();
    el('zoom-label').textContent = Math.round(view.scale / 24 * 100) + '%';
}
function drawAssetGrid(): void {
    if (el('asset-inspector').hidden) return;
    assetView();
    renderAssetGrid(assetCanvas, art, active() && effectiveAsset(active()!), input('preview-fade').checked, assetCamera, input('edit-asset-image').checked, elevationEditor.visibility());
    const v = assetView(); if (v) {
        const ctx = assetCanvas.getContext('2d')!, dpr = assetCanvas.width / Math.max(1, assetCanvas.getBoundingClientRect().width);
        ctx.save(); ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
        elevationEditor.draw(ctx, true); ctx.restore();
    }
    el('asset-zoom-label').textContent = `${Math.round(assetCamera.zoom * 100)}%`;
}
function assetView() {
    if (cameraAsset !== activeAsset) { assetCamera.fit(); cameraAsset = activeAsset; }
    return assetGridView(assetCanvas, active(), assetCamera);
}
function zoomAsset(factor: number, x?: number, y?: number): void {
    const v = assetView(); if (!v) return;
    const r = assetCanvas.getBoundingClientRect();
    assetCamera.zoomAt(factor, x ?? r.width / 2, y ?? r.height / 2, r.width, r.height, v.a.columns, v.a.rows, worldAssetImageBounds(v.a));
    schedule();
}
function position(event: PointerEvent): Vec2 { const r = canvas.getBoundingClientRect(); return { x: Math.floor((event.clientX - r.left - view.x) / view.scale), y: Math.floor((event.clientY - r.top - view.y) / view.scale) }; }
function centerAt(x: number, y: number): void { const r = canvas.getBoundingClientRect(); view.x = r.width / 2 - x * view.scale; view.y = r.height / 2 - y * view.scale; schedule(); }
function zoom(factor: number, x?: number, y?: number): void { const r = canvas.getBoundingClientRect(); x ??= r.width / 2; y ??= r.height / 2; const next = Math.max(.75, Math.min(96, view.scale * factor)); view.x = x - (x - view.x) * next / view.scale; view.y = y - (y - view.y) * next / view.scale; view.scale = next; schedule(); }
function selectAt(p: Vec2, precise: Vec2 = { x: p.x + .5, y: p.y + .5 }, cycle = false): void {
    clearObjectSelection();
    ensureWorld();
    const n = surface().npcs.find(n => Math.hypot(n.x + .5 - precise.x, n.y + .5 - precise.y) <= Math.max(.24, 6 / view.scale) && floorVisible(elevationEditor.visibility(), n.elevation ?? 0));
    const placements = world.assetsIn({ left: p.x, top: p.y, right: p.x + 1, bottom: p.y + 1 }).filter(p => {
      const base = p.baseElevation ?? world.elevation.terrainElevationAt(p.x + .5, p.y + .5);
      const a = world.authoring.assets.get(p.assetId)!;
      return assetPickFloor(a, base, { x: precise.x - p.x, y: precise.y - p.y }, elevationEditor.visibility()) !== undefined && art.hit(a, p, precise.x, precise.y);
    }).sort((a,b) => compareAssetDrawOrder(a,b,world.authoring.assets));
    const asset = placements.at(-1), dungeon = floorVisible(elevationEditor.visibility(), 0) ? world.dungeons.find(d => p.x >= d.layout.bounds.minTx && p.x <= d.layout.bounds.maxTx && p.y >= d.layout.bounds.minTy && p.y <= d.layout.bounds.maxTy) : undefined;
    const zone = world.authoring.zonesAt(precise.x, precise.y)[0];
    // A stair is an editable passage, rather than a low-priority terrain tile.
    // Alt-click still allows selecting the zone underneath it.
    if (!cycle && !n && !asset && elevationEditor.selectMapAt(precise, 'stairs')) { revealInspector(); return; }
    // Terrain geometry and automatic cliffs are the last fallback, after map entities.
    if (!n && !asset && !zone && !dungeon && elevationEditor.selectMapAt(precise)) { revealInspector(); return; }
    if (!n && !asset && !zone && !dungeon) {
        const cliffs = world.elevation.cliffs({ left: p.x, top: p.y, right: p.x+1, bottom: p.y+1 }).filter(c=>cliffLevels(draft,c,true).some(e=>floorVisible(elevationEditor.visibility(),e)));
        for (const cliff of cliffs.slice().reverse()) {
            const part = cliff.parts.slice().reverse().find(part=>{
                const asset=cliffAsset(draft,part.variant),cell=cliffCell(asset,cliff,precise.x,precise.y);
                return floorVisible(elevationEditor.visibility(),cell?cliffCellFloor(asset,cliff,cell,true):cliff.elevation)&&art.hit(asset,cliff,precise.x,precise.y);
            });
            if(part) {openCliffAsset(part.variant);revealInspector();return;}
        }
    }
    const candidates: NonNullable<typeof selected>[] = [
        ...(n ? [{ kind: 'npc' as const, id: n.id }] : []),
        ...placements.slice().reverse().map(a => ({ kind: 'placement' as const, id: a.id })),
        ...(dungeon ? [{ kind: 'dungeon' as const, id: dungeon.id }] : []),
        ...(zone ? [{ kind: 'zone' as const, id: zone.id }] : []),
    ];
    const index = cycle && selected ? candidates.findIndex(c => c.kind === selected!.kind && c.id === selected!.id) : -1;
    selected = candidates[(index + 1) % candidates.length] ?? null;
    selectedGenerated = selected?.kind === 'placement' && selected.id.startsWith('generated:') ? placements.find(a => a.id === selected!.id) : undefined;
    if (selected?.kind === 'npc') set('elevation-active',n?.elevation??0);
    if (selected?.kind === 'placement') {
        const p = placements.find(p=>p.id===selected!.id)!, a = world.authoring.assets.get(p.assetId)!;
        set('elevation-active',assetPickFloor(a,p.baseElevation??world.elevation.terrainElevationAt(p.x+.5,p.y+.5),{x:precise.x-p.x,y:precise.y-p.y},elevationEditor.visibility()));
    }
    refresh();
    if (selected) revealInspector();
    schedule();
}
function materializeSelection(): void {
    if (selected?.kind !== 'placement' || selectedGenerated?.id !== selected.id) return;
    const generated = selectedGenerated, brush = new WorldBrush(surface(), true), terrain = world.authoring.tiles.at(generated.x, generated.y)?.terrain;
    brush.tile(generated, { suppressAssets: true, ...(terrain ? { terrain } : {}) }); brush.flushTiles();
    const placement = { ...generated, id: uid('asset') }; surface().placements.push(placement);
    selected = { kind: 'placement', id: placement.id }; selectedGenerated = undefined;
}
function objectEntity(item: ObjectSelection) {
    return item.kind === 'npc' ? surface().npcs.find(n => n.id === item.id)
        : surface().placements.find(p => p.id === item.id) ?? item.generated;
}
function materializeObjects(): void {
    for (const item of selectedObjects) {
        if (!item.generated) continue;
        selected = { kind: 'placement', id: item.id }; selectedGenerated = item.generated;
        materializeSelection(); item.id = selected!.id; delete item.generated;
    }
    selected = selectedObjects[0] ?? null; groupPrimary = selected; selectedGenerated = undefined;
}
function selectObjectsInBox(start: Vec2, end: Vec2): void {
    ensureWorld();
    const box = selectionRect(start, end), visible = elevationEditor.visibility();
    selectedObjects = world.assetsIn(box).filter(p => {
        const a = world.authoring.assets.get(p.assetId)!;
        return assetInSelection(a, p, p.baseElevation ?? world.elevation.terrainElevationAt(p.x + .5, p.y + .5), visible, box);
    }).map(p => ({ kind: 'placement', id: p.id, ...(p.id.startsWith('generated:') ? { generated: p } : {}) }));
    selectedObjects.push(...surface().npcs.filter(n => floorVisible(visible, n.elevation ?? 0)
        && intersectsSelection(box, { left: n.x + .26, top: n.y + .26, right: n.x + .74, bottom: n.y + .74 }))
        .map(n => ({ kind: 'npc' as const, id: n.id })));
    warpEditor.clearSelection(); elevationEditor.cancelGesture();
    selected = selectedObjects[0] ?? null; groupPrimary = selected;
    selectedGenerated = selectedObjects[0]?.generated;
    refresh(); if (selected) revealInspector(); schedule();
}
function paint(p: Vec2): void {
    if (!gesture)
        return;
    const radius = gesture.settings?.radius ?? Math.max(0, Math.min(16, Math.round(num('brush-radius'))));
    const asset = gesture.settings?.asset;
    const points = gesture.tool === 'asset' && !gesture.mass ? [p] : brushTiles(p, radius);
    for (const q of points) {
        const limits = mapDocument(draft, activeMap).interiorBounds;
        if (Math.abs(q.x) > 10_000_000 || Math.abs(q.y) > 10_000_000 || (limits && (q.x < 0 || q.y < 0 || q.x >= limits.width || q.y >= limits.height))) continue;
        if (!gesture.brush!.visit(q))
            continue;
        if (gesture.tool === 'asset' && coordinateHash(q.x, q.y, draft.seed + gesture.before.placements.length + 2001) >= (gesture.settings?.density ?? 1))
            continue;
        const dungeon = world.dungeons.some(d => q.x >= d.layout.bounds.minTx && q.x <= d.layout.bounds.maxTx && q.y >= d.layout.bounds.minTy && q.y <= d.layout.bounds.maxTy);
        if (dungeon && ['terrain', 'restore', 'asset', 'erase'].includes(gesture.tool))
            continue;
        if (gesture.tool === 'terrain') {
            const terrain = gesture.settings!.terrain;
            const current = world.elevation.terrainElevationAt(q.x + .5, q.y + .5);
            const base = terrain === 'water' ? -1 : 0;
            const elevation = gesture.settings!.elevation ?? (current === world.elevation.baseAt(q.x, q.y) ? base : current);
            if (!canPaintTerrainLevel(current, elevation)) { gesture.blockedLevels = (gesture.blockedLevels ?? 0) + 1; continue; }
            if (!floorVisible(elevationEditor.visibility(), elevation)) continue;
            gesture.terrainBrush!.paint(q, terrain, elevation, base);
            gesture.brush!.tile(q, { terrain, suppressAssets: true, ...(['grass', 'bush'].includes(terrain) ? { bushStyle: gesture.settings!.bushJs ? 'js' as const : 'png' as const } : {}) });
        } else if (gesture.tool === 'restore') {
            gesture.terrainBrush!.paint(q, undefined, 0, 0);
            gesture.brush!.tile(q);
        }
        else if (gesture.tool === 'erase')
            gesture.brush!.erase(q, elevationEditor.elevation());
        else if (gesture.tool === 'asset' && asset) {
            const chosen = input('asset-random-variants').checked && !asset.variantOf
                ? pickAssetVariant(assetVariants(draft.assets, asset), q.x, q.y, draft.seed) : asset;
            gesture.brush!.stamp(chosen, q, uid('asset'), elevationEditor.elevation());
        }
    }
    schedule(gesture.tool === 'asset' || gesture.tool === 'erase');
}
canvas.addEventListener('pointerdown', event => {
    if (!ready || gesture)
        return;
    if (event.button === 0 && tool !== 'select' && !keys.has('Space') && !floorVisible(elevationEditor.visibility(), elevationEditor.elevation())) { status('Scegli una quota attiva visibile prima di modificare la mappa.'); return; }
    canvas.focus();
    const p = position(event);
    ensureWorld();
    if (event.button === 0 && !keys.has('Space') && !(tool === 'select' && event.altKey)) {
        try { if (warpEditor.place(p)) {
            const endpoint = tool === 'select' ? warpEditor.dragTarget(p) : undefined;
            if (endpoint) {
                const before = draft; draft = forkWorldDocument(draft);
                gesture = { pointer: event.pointerId, before, start: p, last: p, screenStart: {x:event.clientX,y:event.clientY}, tool: 'move-warp', mass: false, warpMove: endpoint };
                canvas.setPointerCapture(event.pointerId); event.preventDefault();
            }
            schedule(true); return;
        } }
        catch (e) { report(e); return; }
    }
    if (event.button === 0 && tool === 'select' && !keys.has('Space')) {
        const spawn = surface().spawn, rect = canvas.getBoundingClientRect();
        const offset = mapDocument(draft, activeMap).interiorBounds ? .5 : 0;
        const x = rect.left + view.x + (spawn.x + offset) * view.scale;
        const y = rect.top + view.y + (spawn.y + offset) * view.scale;
        if (floorVisible(elevationEditor.visibility(), surface().spawnElevation ?? 0) && Math.hypot(event.clientX - x, event.clientY - y) <= Math.max(10, view.scale * .35)) {
            const before = draft; draft = forkWorldDocument(draft);
            warpEditor.clearSelection(); selected = null; selectedGenerated = undefined;
            gesture = { pointer: event.pointerId, before, start: p, last: p, screenStart:{x:event.clientX,y:event.clientY}, tool: 'move-spawn', mass: false, spawnMove: { ...spawn } };
            canvas.setPointerCapture(event.pointerId); event.preventDefault(); refresh(); schedule(); return;
        }
    }
    if (event.button === 0 && tool === 'select' && !keys.has('Space')) {
        const previous = selected, r = canvas.getBoundingClientRect();
        const precise = { x: (event.clientX - r.left - view.x) / view.scale, y: (event.clientY - r.top - view.y) / view.scale };
        if (!event.altKey && selectedObjects.length > 1 && selectedObjects.some(item => {
            const entity = objectEntity(item); if (!entity) return false;
            return item.kind === 'npc' ? Math.hypot(entity.x + .5 - precise.x, entity.y + .5 - precise.y) <= .3
                : art.hit(world.authoring.assets.get((entity as AssetPlacement).assetId)!, entity, precise.x, precise.y);
        })) {
            gesture = { pointer: event.pointerId, before: draft, start: p, last: p, screenStart: { x: event.clientX, y: event.clientY }, tool: 'move-group', mass: false,
                groupMove: selectedObjects.map(item => { const entity = objectEntity(item)!; return { item, x: entity.x, y: entity.y }; }) };
            canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
        }
        if (event.altKey) { selectAt(p, precise, true); return; }
        const onPrevious = previous?.kind === 'npc' ? surface().npcs.some(n => n.id === previous.id && Math.hypot(n.x + .5 - precise.x, n.y + .5 - precise.y) <= .3)
            : previous?.kind === 'placement' ? (() => { const entity = selectionEntity(); return entity && art.hit(world.authoring.assets.get(entity.assetId)!, entity, precise.x, precise.y); })()
            : previous?.kind === 'zone' ? world.authoring.zonesAt(precise.x, precise.y).some(z => z.id === previous.id)
            : previous?.kind === 'dungeon' && world.dungeons.some(d => d.id === previous.id && p.x >= d.layout.bounds.minTx && p.x <= d.layout.bounds.maxTx && p.y >= d.layout.bounds.minTy && p.y <= d.layout.bounds.maxTy);
        if (!onPrevious) {
            gesture = { pointer: event.pointerId, before: draft, start: p, last: p, screenStart: { x: event.clientX, y: event.clientY }, tool: 'marquee', mass: false,
                marquee: { start: precise, end: precise, tile: p } };
            canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
        }
        selectAt(p, precise);
        if (selected?.id !== previous?.id || selected?.kind !== previous?.kind) return;
        if (selected) {
            const before = draft;
            draft = forkWorldDocument(draft);
            let entity = selectionEntity();
            const position = selected.kind === 'zone' ? entity.shape : entity;
            gesture = { pointer: event.pointerId, before, start: p, last: p, screenStart: { x: event.clientX, y: event.clientY }, tool: 'move', mass: false, move: { ...selected, x: position.x, y: position.y } };
            canvas.setPointerCapture(event.pointerId);
            event.preventDefault();
            return;
        }
        return;
    }
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
    const tilesOnly = (tool === 'terrain' || tool === 'restore') && !surface().geometry && elevationEditor.terrainElevation() === undefined;
    draft = forkWorldDocument(draft, tilesOnly && activeMap === 'world');
    gesture = { pointer: event.pointerId, before, start: p, last: p, tool, mass: event.ctrlKey || input('mass').checked, brush: new WorldBrush(surface(), tilesOnly) };
    if (tool === 'terrain' || tool === 'restore') gesture.terrainBrush = new TerrainElevationBrush(surface());
    gesture.settings = { radius: Math.max(0, Math.min(16, Math.round(num('brush-radius')))), density: Math.max(0, Math.min(1, num('brush-density') / 100)), terrain: val('terrain') as TileKind, bushJs: input('bush-js').checked, asset: active(), elevation: elevationEditor.terrainElevation() };
    canvas.setPointerCapture(event.pointerId);
    if (tool === 'npc') {
        if (!surface().npcs.some(n => n.x === p.x && n.y === p.y && (n.elevation ?? 0) === elevationEditor.elevation()))
            surface().npcs.push({ ...p, id: uid('npc'), npcKind: val('npc') as import('../../../shared/npcs').NpcTemplateId, level: 1, elevation: elevationEditor.elevation() });
    }
    else if (tool === 'dungeon') {
        const dungeonId = val('dungeon');
        if (dungeonId) {
            const existing = surface().dungeons.find(d => d.dungeonId === dungeonId);
            if (existing)
            Object.assign(existing, p, { enabled: true });
            else
                surface().dungeons.push({ ...p, dungeonId });
            selected = { kind: 'dungeon', id: dungeonId };
        }
    }
    else if (tool === 'spawn') {
        surface().spawn = p; surface().spawnElevation = elevationEditor.elevation();
    }
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
    if (gesture.marquee) {
        if (!gesture.moved && gesture.screenStart && Math.hypot(event.clientX - gesture.screenStart.x, event.clientY - gesture.screenStart.y) < 4) return;
        gesture.moved = true;
        const rect = canvas.getBoundingClientRect();
        gesture.marquee.end = { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale };
        selectObjectsInBox(gesture.marquee.start, gesture.marquee.end); return;
    }
    if (gesture.groupMove) {
        if (!gesture.moved && gesture.screenStart && Math.hypot(event.clientX - gesture.screenStart.x, event.clientY - gesture.screenStart.y) < 4) return;
        if (!gesture.moved) { draft = forkWorldDocument(draft); materializeObjects(); gesture.moved = true; }
        for (const move of gesture.groupMove) {
            const entity = objectEntity(move.item)!;
            entity.x = move.x + pointerTile.x - gesture.start.x;
            entity.y = move.y + pointerTile.y - gesture.start.y;
        }
        refresh(); schedule(true); return;
    }
    if (gesture.pan) {
        view.x += event.clientX - gesture.pan.x;
        view.y += event.clientY - gesture.pan.y;
        gesture.pan = { x: event.clientX, y: event.clientY };
        schedule();
        return;
    }
    if (gesture.spawnMove) {
        if(gesture.screenStart && Math.hypot(event.clientX-gesture.screenStart.x,event.clientY-gesture.screenStart.y)<4)return;
        const bounds = mapDocument(draft, activeMap).interiorBounds;
        surface().spawn = {
            x: Math.max(bounds ? 0 : -10_000_000, Math.min(bounds ? bounds.width - 1 : 10_000_000, gesture.spawnMove.x + pointerTile.x - gesture.start.x)),
            y: Math.max(bounds ? 0 : -10_000_000, Math.min(bounds ? bounds.height - 1 : 10_000_000, gesture.spawnMove.y + pointerTile.y - gesture.start.y)),
        };
        refresh(); schedule(true); return;
    }
    if (gesture.warpMove) {
        if(gesture.screenStart && Math.hypot(event.clientX-gesture.screenStart.x,event.clientY-gesture.screenStart.y)<4)return;
        const endpoint = gesture.warpMove;
        warpEditor.moveEndpoint(endpoint, { x: endpoint.x + pointerTile.x - gesture.start.x, y: endpoint.y + pointerTile.y - gesture.start.y });
        refresh(); schedule(true); return;
    }
    if (gesture.move) {
        const move = gesture.move;
        if (!gesture.moved && gesture.screenStart && Math.hypot(event.clientX - gesture.screenStart.x, event.clientY - gesture.screenStart.y) < 4) return;
        if (!gesture.moved) {
            materializeSelection();
            if(selected?.kind==='dungeon'&&!surface().dungeons.some(d=>d.dungeonId===selected!.id))surface().dungeons.push(selectionEntity());
            if (selected) move.id = selected.id; gesture.moved = true;
        }
        selected = { kind: move.kind, id: move.id };
        const entity = selectionEntity(), position = move.kind === 'zone' ? entity.shape : entity;
        position.x = move.x + pointerTile.x - gesture.start.x;
        position.y = move.y + pointerTile.y - gesture.start.y;
        refresh(); schedule(true);
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
    if (g.marquee) {
        gesture = null;
        if (cancel) { selected = null; clearObjectSelection(); refresh(); schedule(); }
        else if (g.moved) selectObjectsInBox(g.marquee.start, g.marquee.end);
        else selectAt(g.marquee.tile, g.marquee.start);
        return;
    }
    if (!cancel && g.pending && (g.cursor ?? 0) < g.pending.length) { g.ending = true; schedule(); return; }
    g.brush?.flushTiles();
    g.terrainBrush?.flush(true);
    if (cancel) {
        draft = g.before;
        if (g.groupMove) { selected = null; clearObjectSelection(); }
        gesture = null;
        refresh();
        schedule(true);
        return;
    }
    if (g.terrainBrush) {
        worldDirty = true; ensureWorld();
        const access = ensureTerrainAccess(surface(), world, elevationEditor.autoStair() ? g.terrainBrush.raisedPoints : []);
        if (access.missing) status(`${access.missing} rialzi senza accesso: manca spazio libero per la scala automatica. Usa Scala per posizionarla manualmente.`);
    }
    if (g.tool === 'zone' && !g.pan) {
        const shape = { kind: 'rect' as const, x: Math.min(g.start.x, g.last.x), y: Math.min(g.start.y, g.last.y), width: Math.abs(g.start.x - g.last.x) + 1, height: Math.abs(g.start.y - g.last.y) + 1 };
        const z: WorldZone = { id: uid('zone'), name: 'Nuova zona', priority: 20, shape };
        if (input('zone-create-climate-transition').checked) z.climateTransition = 1;
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
        surface().zones.push(z);
        selected = { kind: 'zone', id: z.id };
    }
    if (g.cell && !g.pan && !g.image && active()) {
        // Keep the chosen brush for the next stroke, even when the grid becomes mixed.
        cellControlsSignature = JSON.stringify([active()!.id, active()!.cells]);
        el('asset-cell-pending').hidden = true;
    }
    gesture = null;
    if (!g.pan)
        commit(g.before, !!surface().tileChunks && !surface().geometry && (g.tool === 'terrain' || g.tool === 'restore'));
    else
        schedule();
    if (g.blockedLevels) status(`Non possibile: ${g.blockedLevels} celle escluse. Il terreno può salire di un solo livello per volta.`);
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
function paintCell(event: PointerEvent): void { const v = assetView(); if (!v || !gesture?.cell || gesture.pan || gesture.image || gesture.pointer !== event.pointerId)
    return; const r = assetCanvas.getBoundingClientRect(), step=v.s/assetCellSubdivision(v.a), columns=assetCellColumns(v.a), rows=assetCellRows(v.a), col = Math.floor((event.clientX - r.left - v.x) / step), row = Math.floor((event.clientY - r.top - v.y) / step); if (col < 0 || row < 0 || col >= columns || row >= rows)
    { if (gesture) gesture.cellLast=undefined; return; }
    for(const point of strokeTiles(gesture.cellLast ?? {x:col,y:row},{x:col,y:row})) {const i=point.y*columns+point.x;v.a.cells[i]=paintedAssetCell(v.a.cells[i]);}
    gesture.cellLast={x:col,y:row}; schedule(true); }
assetCanvas.addEventListener('pointerdown', e => {
    if (!ready || gesture) return;
    assetCanvas.focus();
    const before = draft, pan = e.button === 1 || e.button === 2 || keys.has('Space');
    const v = assetView(); if (!v) return;
    const image = input('edit-asset-image').checked && !pan;
    if (!pan && !image) {
        const box=assetCanvas.getBoundingClientRect(),step=v.s/assetCellSubdivision(v.a),col=Math.floor((e.clientX-box.left-v.x)/step),row=Math.floor((e.clientY-box.top-v.y)/step),cell=col>=0&&row>=0&&col<assetCellColumns(v.a)&&row<assetCellRows(v.a)?v.a.cells[row*assetCellColumns(v.a)+col]:undefined;
        if(!floorVisible(elevationEditor.visibility(),cell?.elevation??0))return;
    }
    if (image) {
        const r = assetCanvas.getBoundingClientRect(), b = worldAssetImageBounds(v.a);
        const x = (e.clientX - r.left - v.x) / v.s, y = (e.clientY - r.top - v.y) / v.s;
        if (x < b.x || x >= b.x + b.width || y < b.y || y >= b.y + b.height) return;
    }
    if (!pan) draft = forkWorldDocument(draft);
    gesture = { pointer: e.pointerId, before, start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, tool: 'cell', mass: false, cell: true, ...(pan ? { pan: { x: e.clientX, y: e.clientY } } : {}) };
    if (image) {
        gesture.start = { x: e.clientX, y: e.clientY };
        gesture.image = { x: v.a.imageTransform?.x ?? 0, y: v.a.imageTransform?.y ?? 0, scale: v.a.imageTransform?.scale ?? 1, unit: v.s };
    }
    e.preventDefault();
    assetCanvas.setPointerCapture(e.pointerId); paintCell(e);
});
assetCanvas.addEventListener('pointermove', e => {
    if (gesture?.cell && gesture.pan && gesture.pointer === e.pointerId) {
        assetCamera.pan(e.clientX - gesture.pan.x, e.clientY - gesture.pan.y);
        gesture.pan = { x: e.clientX, y: e.clientY }; schedule();
    } else if (gesture?.image && gesture.pointer === e.pointerId) {
        const g = gesture, image = g.image!;
        active()!.imageTransform = { x: Math.round(Math.max(-32, Math.min(32, image.x + (e.clientX - g.start.x) / image.unit)) * 10000) / 10000,
            y: Math.round(Math.max(-32, Math.min(32, image.y + (e.clientY - g.start.y) / image.unit)) * 10000) / 10000, scale: image.scale };
        schedule(true);
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
input('edit-asset-image').addEventListener('change', () => { finishGesture(undefined, true); schedule(); });
on('asset-image-update', () => change(() => { active()!.imageTransform = { x: num('asset-image-x'), y: num('asset-image-y'), scale: num('asset-image-scale') / 100 }; }));
on('asset-image-reset', () => change(() => { delete active()!.imageTransform; assetCamera.fit(); }));
function effectiveAsset(a: WorldAsset): WorldAsset {
    return { ...a, shadow: worldAssetShadow(a, draft.assets.find(parent => parent.id === a.variantOf)) };
}
function updateAssetShadow(): void {
    const a = active()!;
    if (a.variantOf && input('asset-shadow-inherit').checked) { delete a.shadow; return; }
    if (!input('asset-shadow-enabled').checked) { a.shadow = null; return; }
    a.shadow = { kind: val('asset-shadow-kind') as 'ellipse' | 'silhouette', skew: num('asset-shadow-skew') / 100,
        x: num('asset-shadow-x') / 100, y: num('asset-shadow-y') / 100,
        width: num('asset-shadow-width') / 100, height: num('asset-shadow-height') / 100,
        opacity: num('asset-shadow-opacity') / 100, softness: num('asset-shadow-softness') / 100 };
}
on('asset-shadow-update', () => change(updateAssetShadow));
on('asset-shadow-reset', () => change(() => {
    const a = active()!;
    if (a.variantOf) delete a.shadow; else a.shadow = { ...DEFAULT_ASSET_SHADOW };
}));
el('asset-shadow-inherit').addEventListener('change', () => {
    if (input('asset-shadow-inherit').checked) {
        const shadow = worldAssetShadow({ ...active()!, shadow: undefined }, draft.assets.find(a => a.id === active()!.variantOf));
        input('asset-shadow-enabled').checked = !!shadow;
        set('asset-shadow-kind', (shadow ?? DEFAULT_ASSET_SHADOW).kind);
        for (const key of ['x', 'y', 'width', 'height', 'opacity', 'softness', 'skew'] as const) set(`asset-shadow-${key}`, (shadow ?? DEFAULT_ASSET_SHADOW)[key] * 100);
    }
});
for (const id of ['asset-shadow-enabled', ...Object.keys(DEFAULT_ASSET_SHADOW).map(key => `asset-shadow-${key}`)]) {
    el(id).addEventListener('input', () => { input('asset-shadow-inherit').checked = false; });
}
on('asset-shadow-png', async () => {
    const a = structuredClone(effectiveAsset(active()!));
    if (!a.shadow) throw new Error('Attiva l’ombra e premi Aggiorna ombra prima di scaricarla.');
    await art.ready(a);
    const image = art.image(a, false);
    if (!image) throw new Error('Immagine asset non disponibile.');
    const bitmap = rasterizeAssetShadow(image.width, image.height, a.shadow, image);
    const blob = await new Promise<Blob>((resolve, reject) => bitmap.toBlob(blob => blob ? resolve(blob) : reject(new Error('Esportazione ombra non riuscita.')), 'image/png'));
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${a.id}-ombra.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const previewDialog = el<HTMLDialogElement>('asset-preview-dialog');
el<HTMLSelectElement>('asset-preview-background').addEventListener('change', () => {
    assetCanvas.dataset.background = val('asset-preview-background');
});
on('asset-expand', () => {
    if (previewDialog.open) { previewDialog.close(); return; }
    el('asset-preview-slot').append(el('asset-preview')); el('asset-expand').textContent = 'Riduci';
    previewDialog.showModal(); schedule();
});
on('asset-preview-close', () => previewDialog.close());
previewDialog.addEventListener('cancel', () => finishGesture(undefined, true));
previewDialog.addEventListener('close', () => { finishGesture(undefined, true); el('asset-preview-home').append(el('asset-preview')); el('asset-expand').textContent = 'Ingrandisci'; schedule(); });
on('asset-update', () => change(() => {
    const a = active()!;
    resizeWorldAsset(a,num('asset-width'),num('asset-height')); a.name=val('asset-name').trim();assetCatalog.reveal(a);
    if (val('asset-variant-of')) a.variantOf = val('asset-variant-of'); else delete a.variantOf;
    a.layer=val('asset-layer') as 'ground'|'object';a.pivot.y=num('asset-pivot');
    updateAssetShadow();
    a.fade={opacity:num('fade-opacity')/100,feather:num('fade-feather'),durationMs:num('fade-duration')};
    a.visual=val('asset-visual')==='image'?{kind:'image'}:{kind:'fire',style:val('asset-visual') as 'brazier'|'campfire'};
    const transform={x:num('asset-image-x'),y:num('asset-image-y'),scale:num('asset-image-scale')/100};
    if(transform.x||transform.y||transform.scale!==1)a.imageTransform=transform;else delete a.imageTransform;
    a.generation={enabled:input('gen-enabled').checked,category:val('gen-category').trim(),temperature:[num('gen-temp-min'),num('gen-temp-max')],moisture:[num('gen-moist-min'),num('gen-moist-max')],density:num('gen-density')/100,spacing:num('gen-spacing'),terrains:[...el('gen-terrains').querySelectorAll<HTMLInputElement>('input:checked')].map(c=>c.value as TileKind)};
}));
input('asset-width').addEventListener('input', () => { const a = active(); if (a && input('keep-ratio').checked)
    set('asset-height', Math.round(num('asset-width') * a.height / a.width * 1000) / 1000); });
input('asset-height').addEventListener('input', () => { const a = active(); if (a && input('keep-ratio').checked)
    set('asset-width', Math.round(num('asset-height') * a.width / a.height * 1000) / 1000); });
on('fill-cells', () => change(() => { const a = active()!; a.cells = a.cells.map(paintedAssetCell); el('asset-cell-pending').hidden = true; }));
on('asset-fade-update', () => change(() => { active()!.fade = { opacity: num('fade-opacity') / 100, feather: num('fade-feather'), durationMs: num('fade-duration') }; }));
on('gen-update', () => change(() => { const a = active()!; a.generation = { enabled: input('gen-enabled').checked, category: val('gen-category').trim(), temperature: [num('gen-temp-min'), num('gen-temp-max')], moisture: [num('gen-moist-min'), num('gen-moist-max')], density: num('gen-density') / 100, spacing: num('gen-spacing'), terrains: [...el('gen-terrains').querySelectorAll<HTMLInputElement>('input:checked')].map(c => c.value as TileKind) }; }));
on('asset-delete', () => change(() => { const a = active()!;
    for (const doc of [draft, ...(draft.interiors ?? []).map(m => m.document)]) doc.placements = doc.placements.filter(p => p.assetId !== a.id);
    selected = null; }));
on('asset-remove-catalog', () => {
    const asset = active(); if (!asset) return;
    if (!confirm(`Rimuovere “${asset.name}” dal catalogo e tutte le sue copie manuali? Il file immagine rimane nella cartella. Puoi annullare con Undo e salvare con Applica al gioco.`)) return;
    change(() => {
        if (draft.assets.some(a => a.variantOf === asset.id)) throw new Error('Rendi autonome le varianti prima di rimuovere il principale.');
        if (Object.values(draft.cliffAssets ?? {}).includes(asset.id)) throw new Error('Questo asset definisce un bordo automatico.');
        const users = catalog.filter(d => d.assetPlacements?.some(p => p.assetId === asset.id));
        if (users.length) throw new Error(`Asset usato nei dungeon: ${users.map(d => d.name).join(', ')}. Rimuovi prima quelle istanze.`);
        for (const doc of [draft, ...(draft.interiors ?? []).map(m => m.document)]) doc.placements = doc.placements.filter(p => p.assetId !== asset.id);
        draft.assets = draft.assets.filter(a => a.id !== asset.id);
        selected = null; selectedGenerated = undefined; activeAsset = '';
    });
});
on('asset-delete-permanently', async () => {
    if (!token || !ready) throw new Error('Apri il World Studio locale per eliminare anche il file.');
    if (draftConflict) throw new WorldCheckpointConflictError();
    const asset = active(); if (!asset) return;
    if (!confirm(`Eliminare definitivamente “${asset.name}”, tutte le sue istanze e il file immagine? Verrà applicata anche la bozza corrente. Questa operazione non è annullabile con Undo.`)) return;
    await checkpoint(true);
    const document = parseWorldDocument(draft);
    root.inert = true;
    try {
        const result = await api('/__world/delete-asset', { document, revision, assetId: asset.id });
        draft = parseWorldDocument(result.document); revision = installedRevision = result.revision; installedDocument = draft;
        history.clear(); inspectorDrafts.clear(); selected = null; activeAsset = ''; dirty = false;
        await checkpoint(true);
        refresh(); schedule(true);
        status('Asset, istanze e file immagine eliminati definitivamente. Bozza applicata al progetto.');
    } finally { root.inert = false; }
});
on('zone-update', () => change(() => { const z = surface().zones.find(z => z.id === selected?.id)!; z.name = val('zone-name').trim(); z.priority = num('zone-priority'); z.shape = val('zone-shape') === 'circle' ? { kind: 'circle', x: num('zone-x'), y: num('zone-y'), radius: num('zone-width') } : { kind: 'rect', x: num('zone-x'), y: num('zone-y'), width: num('zone-width'), height: num('zone-height') }; for (const [key, id] of [['temperature', 'zone-temperature'], ['moisture', 'zone-moisture']] as const) {
    if (val(id) === '')
        delete z[key];
    else
        z[key] = num(id);
} if (input('zone-climate-transition').checked) {
    const depth = num('zone-climate-depth');
    if (!Number.isFinite(depth) || depth < 1 || depth > 100) throw new Error('Profondità sfumatura clima: da 1 a 100%.');
    z.climateTransition = depth / 100;
} else delete z.climateTransition;
climateControls.read(z);
for (const [key, id] of [['pvp', 'zone-pvp'], ['generateAssets', 'zone-generation']] as const) {
    if (val(id) === '')
        delete z[key];
    else
        z[key] = val(id) === 'true';
} if (val('zone-arena').trim())
    z.arenaId = val('zone-arena').trim();
else
    delete z.arenaId;
if (val('zone-quest')) z.questId = val('zone-quest'); else delete z.questId;
if (val('zone-music')) z.music = { src: val('zone-music'), volume: num('zone-music-volume') / 100 }; else delete z.music;
if (input('zone-npcs').checked)
    z.npcs = { density: num('zone-density') / 100, maxPerChunk: num('zone-limit'), weights: { slime: num('zone-slime'), wisp: num('zone-wisp'), sentinel: num('zone-sentinel') } };
else
    delete z.npcs; }));
on('zone-delete', () => change(() => { surface().zones = surface().zones.filter(z => z.id !== selected?.id); selected = null; }));
on('zone-music-import', () => input('zone-music-file').click());
input('zone-music-file').addEventListener('change', () => { void (async () => {
    const file = input('zone-music-file').files?.[0]; if (!file) return;
    if (!token) throw new Error('Apri World Studio per importare musica.');
    if (file.size > 20_000_000) throw new Error('Traccia oltre 20 MB.');
    const zone = selected?.kind === 'zone' ? surface().zones.find(z => z.id === selected?.id) : undefined;
    if (!zone) throw new Error('Seleziona una zona.');
    status('Importazione musica…');
    const data = await fileData(file);
    const { src } = await api('/__world/music', { filename: file.name, base64: data.slice(data.indexOf(',') + 1) });
    musicSources.push(src);
    if (selected?.id === zone.id) refreshMusicOptions(src);
    status('Traccia importata. Premi Aggiorna zona per associarla.');
})().catch(report).finally(() => { input('zone-music-file').value = ''; }); });
on('selection-update', () => change(() => { materializeSelection(); const e = selectionEntity(); if (!e)
    return; if (selected?.kind === 'placement' || selected?.kind === 'npc') {
        const elevation = num('entity-elevation'); if (!validElevation(elevation)) throw new Error('Quota: intero da -128 a 127.');
        if (selected.kind === 'placement') { if (val('entity-elevation').trim() === '') delete e.baseElevation; else e.baseElevation = elevation; } else e.elevation = elevation;
    } if (selected?.kind === 'dungeon' && !surface().dungeons.some(d => d.dungeonId === selected!.id))
    surface().dungeons.push(e); e.x = num('entity-x'); e.y = num('entity-y'); if (selected?.kind === 'placement') { if (val('entity-pivot').trim()==='') delete e.pivotY; else {const pivot=num('entity-pivot');if(!Number.isFinite(pivot)||pivot<0||pivot>1)throw new Error('La base deve essere fra 0 e 1.');e.pivotY=pivot;} } if (selected?.kind === 'npc')
    { e.level = num('entity-level'); const properties = readNpcProperties(root, 'selected-npc'); e.npcKind = properties.kind; e.settings = properties.settings; } if (selected?.kind === 'dungeon') { if (val('entity-pvp') === '') delete e.pvp; else e.pvp = val('entity-pvp') === 'true'; } }));
on('selection-delete', () => change(() => {
    if (selectedObjects.length > 1) {
        materializeObjects();
        const placements = new Set(selectedObjects.filter(s => s.kind === 'placement').map(s => s.id));
        const npcs = new Set(selectedObjects.filter(s => s.kind === 'npc').map(s => s.id));
        surface().placements = surface().placements.filter(p => !placements.has(p.id));
        surface().npcs = surface().npcs.filter(n => !npcs.has(n.id));
        selected = null; clearObjectSelection(); return;
    }
    materializeSelection(); if (selected?.kind === 'placement')
    surface().placements = surface().placements.filter(p => p.id !== selected!.id); if (selected?.kind === 'npc')
    surface().npcs = surface().npcs.filter(n => n.id !== selected!.id); if (selected?.kind === 'dungeon') {
    const existing = surface().dungeons.find(d => d.dungeonId === selected!.id);
    if (existing) existing.enabled = false;
    else { const dungeon = catalog.find(d => d.id === selected!.id)!; surface().dungeons.push({ dungeonId: dungeon.id, x: dungeon.layout.bounds.minTx, y: dungeon.layout.bounds.minTy, enabled: false }); }
    status('Dungeon tolto dal mondo. Puoi riposizionarlo dal catalogo.');
} selected = null; }));
on('seed-update', () => change(() => { draft.seed = num('seed'); }));
on('undo', () => { inspectorDrafts.clear(); draft = history.undo(draft); dirty = true; checkpoint(); selected = null; refresh(); schedule(true); });
on('redo', () => { inspectorDrafts.clear(); draft = history.redo(draft); dirty = true; checkpoint(); selected = null; refresh(); schedule(true); });
on('zoom-in', () => zoom(1.3));
on('zoom-out', () => zoom(1 / 1.3));
on('home', () => centerAt(surface().spawn.x, surface().spawn.y));
on('goto', () => { set('goto-x', 0); set('goto-y', 0); el<HTMLDialogElement>('goto-dialog').showModal(); });
on('goto-close', () => el<HTMLDialogElement>('goto-dialog').close());
on('goto-confirm', () => { const x = num('goto-x'), y = num('goto-y'); if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 10000000 || Math.abs(y) > 10000000)
    throw new Error('Coordinate oltre i limiti numerici.'); centerAt(x, y); el<HTMLDialogElement>('goto-dialog').close(); });
on('properties-toggle', () => { root.querySelector('.inspector')!.classList.toggle('collapsed'); root.classList.toggle('inspector-hidden', root.querySelector('.inspector')!.classList.contains('collapsed')); schedule(); });
for (const id of ['show-grid', 'show-zones', 'show-cells', 'show-npcs', 'show-painting'])
    input(id).addEventListener('change', () => schedule());
input('light-mode').addEventListener('change', () => {
    try { localStorage.setItem('riftlands.world-maker.light-mode', String(input('light-mode').checked)); } catch { /* Optional editor preference. */ }
    if (animationTimer !== undefined) { clearTimeout(animationTimer); animationTimer = undefined; }
    schedule();
});
input('preview-fade').addEventListener('change', () => schedule());
input('asset-search').addEventListener('input', palette);
const catalogDialog = el<HTMLDialogElement>('asset-catalog-dialog');
const catalogHome = el('asset-catalog-home');
const catalogPin = document.createElement('button'); catalogPin.id = 'asset-catalog-pin';
catalogPin.textContent = 'Mantieni aperto'; catalogPin.setAttribute('aria-pressed', 'false');
el('asset-catalog-close').before(catalogPin);
function saveCatalogPin(open: boolean): void {
    try { localStorage.setItem('riftlands.catalog-pinned', String(open)); } catch { /* Optional layout preference. */ }
}
function openCatalog(pinned: boolean): void {
    if (catalogDialog.open) catalogDialog.close();
    el('asset-catalog-slot').append(el('asset-catalog-content'));
    root.classList.toggle('catalog-pinned', pinned);
    catalogPin.setAttribute('aria-pressed', String(pinned));
    catalogPin.textContent = pinned ? 'Torna a finestra singola' : 'Mantieni aperto';
    if (pinned) catalogDialog.show(); else catalogDialog.showModal();
    saveCatalogPin(pinned);
}
on('asset-catalog-expand', () => openCatalog(root.classList.contains('catalog-pinned')));
on('asset-catalog-pin', () => openCatalog(!root.classList.contains('catalog-pinned')));
on('asset-catalog-close', () => catalogDialog.close());
catalogDialog.addEventListener('close', () => {
    if (catalogDialog.open) return;
    catalogHome.append(el('asset-catalog-content'));
    root.classList.remove('catalog-pinned'); catalogPin.setAttribute('aria-pressed', 'false');
    saveCatalogPin(false);
});
root.addEventListener('workspace-reset-layout', () => { catalogDialog.close(); saveCatalogPin(false); root.classList.remove('catalog-pinned'); });
try { if (localStorage.getItem('riftlands.catalog-pinned') === 'true') openCatalog(true); } catch { /* Optional layout preference. */ }
on('asset-create-variant', () => {
    const sourceId = active()!.id;
    change(() => {
        const source = draft.assets.find(a => a.id === sourceId)!;
        const copy = structuredClone(source);
        copy.id = uid('asset'); copy.name = `${source.name} · variante`.slice(0, 160);
        copy.variantOf = source.variantOf ?? source.id;
        delete copy.shadow;
        draft.assets.push(copy); activeAsset = copy.id; selected = null; selectedGenerated = undefined;
        selectTool('asset');
    });
    revealInspector();
    status('Variante creata nello stesso gruppo. Usa Sostituisci immagine per scegliere un altro PNG; le regole di generazione sono quelle dell’asset principale.');
});
on('assets-expand', () => assetCatalog.expandAll(true));
on('assets-collapse', () => assetCatalog.expandAll(false));
on('validate', () => { validationActive = true; const issues = showValidation(); status(issues.length ? `${issues.length} problemi da correggere.` : 'Progetto valido: ingombri e riferimenti verificati.'); });
document.addEventListener('keydown', e => { if (root.inert) { e.preventDefault(); return; } if ((e.target as HTMLElement).matches('input,select,textarea'))
    return; keys.add(e.code); if (e.code === 'Space')
    e.preventDefault(); if (e.code === 'Escape') {
    finishGesture(undefined, true);
    elevationEditor.cancelGesture(); warpEditor.clearSelection();
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
async function upload(file: File, mime: string): Promise<string> { if (!token)
    throw new Error('Importazione immagini disponibile con npm run world:studio.'); const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192)); return (await api('/__world/images', { mime, base64: btoa(binary), filename: file.name })).image; }
async function imageSize(src: string): Promise<{
    width: number;
    height: number;
}> { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('Immagine non leggibile.')); image.src = src; }); }
on('sync-asset-folders', () => { void (async () => {
    if (!token) throw new Error('Sincronizzazione disponibile con npm run world:studio.');
    const button=el<HTMLButtonElement>('sync-asset-folders'); button.disabled=true;
    try {
        status('Ricerca immagini in public/world-assets…');
        const result=await api('/__world/asset-files', {});
        await settleGesture();
        let count={added:0,repaired:0};
        change(() => {count=syncWorldAssetFiles(draft,result.files);});
        status(count.added || count.repaired ? `Aggiunti ${count.added} asset dalle cartelle. Riparati ${count.repaired} percorsi di immagini spostate. Dimensione iniziale 1 × 1, calpestabile. Premi Applica al gioco per salvare il catalogo nel progetto.` : 'Nessuna nuova immagine: il catalogo è già aggiornato.');
    } finally {button.disabled=false;}
})().catch(report); });
on('import-assets', () => input('asset-files').click());
input('asset-files').addEventListener('change', () => { void (async () => { const files = [...input('asset-files').files ?? []]; const imported: { name: string; image: string; width: number; height: number }[] = []; for (const file of files) {
    status(`Importazione ${file.name}…`);
    if (file.size > 5000000)
        throw new Error('Massimo 5 MB per immagine.');
    const mime = file.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    const image = await upload(file, mime), size = await imageSize(image);
    imported.push({ name: file.name.replace(/\.(png|svg)$/i, ''), image, ...size });
} await settleGesture(); change(() => { for (const data of imported) { const a = importWorldAsset(draft, installedDocument, catalog, data); activeAsset = a.id; assetCatalog.reveal(a); } selected = null; selectTool('asset'); }); status(`Importati ${imported.length} asset. Riferimenti e proprietà esistenti conservati.`); })().catch(report).finally(() => { input('asset-files').value = ''; }); });
const replaceFile = document.createElement('input'); replaceFile.id = 'asset-replace-file'; replaceFile.type = 'file'; replaceFile.accept = '.png,.svg,image/png,image/svg+xml'; replaceFile.hidden = true;
const replaceButton = document.createElement('button'); replaceButton.id = 'asset-replace-image'; replaceButton.className = 'wide'; replaceButton.textContent = 'Sostituisci immagine esterna · da file';
const replaceInternalButton = document.createElement('button'); replaceInternalButton.id = 'asset-replace-image-internal'; replaceInternalButton.className = 'wide'; replaceInternalButton.textContent = 'Sostituisci immagine interna · dal catalogo';
el('asset-update').after(replaceInternalButton, replaceButton); root.append(replaceFile);
async function replaceAssetImage(id: string, image: string): Promise<void> {
    await imageSize(image); await settleGesture();
    const failures = failedChanges;
    change(() => { const a = draft.assets.find(a => a.id === id); if (!a) throw new Error('Asset non più presente.'); a.image = image; });
    if (failedChanges !== failures) throw new Error(el('status').textContent ?? 'Impossibile sostituire l’immagine.');
    status('Immagine sostituita. ID, celle, gruppo e riferimenti ai dungeon conservati.');
}
const openImagePicker = installWorldImagePicker(root, () => draft.assets, replaceAssetImage);
replaceInternalButton.onclick = () => { const target = active(); if (target) openImagePicker(target); };
replaceButton.onclick = () => { replaceFile.value = ''; replaceFile.click(); };
replaceFile.addEventListener('change', () => { void (async () => {
    const file = replaceFile.files?.[0], id = active()?.id; if (!file || !id) return;
    const mime = file.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    const image = await upload(file, mime); await replaceAssetImage(id, image);
})().catch(report); });
async function publishWorld(document: WorldDocument): Promise<any> {
    try { return await api('/__world/project', { document, revision }); }
    catch (error) {
        if (!appliedDocument || !(error instanceof Error) || !error.message.startsWith('Il progetto è stato modificato da un’altra finestra.')) throw error;
        const response = await fetch('/__world/project', { cache: 'no-store' });
        if (!response.ok) throw error;
        const current = await response.json();
        // Recover only our last successful publication. Real edits in another window still conflict.
        if (!worldDocumentsEqual(compactWorldTiles(parseWorldDocument(current.document)), appliedDocument)) throw error;
        revision = installedRevision = current.revision;
        return api('/__world/project', { document, revision });
    }
}
on('apply-world', async () => {
if (applyingWorld) return;
applyingWorld = true; projectGeneration++;
el<HTMLButtonElement>('apply-world').disabled = true;
try { if (draftConflict) throw new WorldCheckpointConflictError(); status('Controllo della bozza…'); await checkpoint(true); if (gesture)
    finishGesture(); while (gesture?.ending) await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); const document = parseWorldDocument(draft); const issues = validateWorld(document, catalog); if (issues.length) {
    el('validate').click();
    throw new Error('Correggi i problemi del progetto prima di applicare.');
} status('Applicazione del progetto…');
    const result = await publishWorld(document);
    revision = result.revision;
    installedRevision = revision;
    installedDocument = compactWorldTiles(parseWorldDocument(result.document ?? document));
    appliedDocument = installedDocument;
    projectGeneration++;
    dirty = !worldDocumentsEqual(draft, document);
    await checkpoint(true);
    el('save-state').textContent = dirty ? 'Bozza salvata · da applicare' : 'Applicato al progetto';
    status(result.live ? 'Mappa pubblicata sul gioco attivo e salvata con backup.' : 'Progetto salvato con backup. Verrà caricato al prossimo avvio del gioco.');
}
finally {
    applyingWorld = false;
    el<HTMLButtonElement>('apply-world').disabled = !token || !ready || draftConflict;
} });
async function repairMovedAssets(): Promise<number> {
    if (!token) return 0;
    const { files } = await api('/__world/asset-files', {});
    const copy = forkWorldDocument(draft);
    const repaired = repairWorldAssetPaths(copy, files);
    if (repaired) { const before = draft; draft = copy; commit(before); }
    return repaired;
}
on('export-world', async () => { await repairMovedAssets(); status('Preparazione esportazione con immagini e musica…'); const music: Record<string, string> = {};
for (const src of new Set(musicZones(draft).map(z => z.music!.src))) {
    const response = await fetch(src); if (!response.ok) throw new Error(`Traccia mancante: ${src}`);
    music[src] = await fileData(await response.blob());
}
const images: Record<string, string> = {}; for (const src of new Set(draft.assets.map(a => a.image))) {
    const response = await fetch(src);
    if (!response.ok)
        throw new Error(`Immagine mancante: ${src}`);
    const blob = await response.blob();
    images[src] = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
} const blob = new Blob([JSON.stringify({ format: 'riftlands-world-project', version: 1, document: parseWorldDocument(draft), images, music })], { type: 'application/json' }); const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'riftlands-world.project.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); status('Progetto esportato con immagini e musica. I dungeon fanno riferimento al catalogo installato.'); });
on('import-world', () => input('world-file').click());
input('world-file').addEventListener('change', () => { void (async () => { const file = input('world-file').files?.[0]; if (!file)
    return; if (file.size > 512000000)
    throw new Error('Progetto oltre 512 MB.'); status('Lettura progetto e ripristino immagini…'); const payload = JSON.parse(await file.text()); const document = compactWorldTiles(parseWorldDocument(payload.format === 'riftlands-world-project' ? payload.document : payload)); if (payload.images) {
    if (!token)
        throw new Error('Importa il progetto da World Studio per ripristinare le immagini.');
    const restored = new Map<string, string>();
    for (const a of document.assets) {
        const existing = restored.get(a.image); if (existing) { a.image = existing; continue; }
        const data = payload.images[a.image];
        if (typeof data !== 'string')
            throw new Error(`Immagine assente nell’archivio: ${a.name}`);
        const match = /^data:(image\/(?:png|svg\+xml));base64,(.+)$/.exec(data);
        if (!match)
            throw new Error('Immagine esportata non valida.');
        const source = a.image;
        a.image = (await api('/__world/images', { mime: match[1], base64: match[2], filename: decodeURIComponent(a.image.split('/').at(-1) ?? a.name) })).image;
        restored.set(source, a.image);
    }
} if (payload.music) {
    if (!token) throw new Error('Importa da World Studio per ripristinare la musica.');
    const sources = new Map<string, string>();
    for (const zone of musicZones(document)) {
        const src = zone.music!.src;
        if (!sources.has(src)) {
            const data = payload.music[src];
            if (typeof data !== 'string' || !/^data:[^,]*;base64,/.test(data)) throw new Error(`Traccia assente o non valida: ${src}`);
            sources.set(src, (await api('/__world/music', { filename: src.split('/').at(-1), base64: data.slice(data.indexOf(',') + 1) })).src);
        }
        zone.music!.src = sources.get(src)!;
    }
    musicSources = [...new Set([...musicSources, ...sources.values()])];
} change(() => { draft = document; selected = null; }); status('Progetto importato nella bozza locale.'); })().catch(report).finally(() => { input('world-file').value = ''; }); });
async function load(reload = false): Promise<void> {
    appliedDocument = undefined; projectGeneration++;
    recoverableDraft = undefined; recoverDraftButton.hidden = true;
    if (reload) {
        if (checkpointTimer !== undefined) clearTimeout(checkpointTimer);
        checkpointTimer = undefined; pendingCheckpoint = undefined;
        await checkpointQueue.catch(() => {}); await loadWorldCheckpoint();
    }
    inspectorDrafts.clear(); draftConflict = false; el('draft-conflict').hidden = true;
    ready = false;
    try {
        const response = await fetch('/__world/project');
        if (response.ok) {
            const project = await response.json();
            draft = compactWorldTiles(parseWorldDocument(project.document));
            installedDocument = draft;
            token = project.token;
            const musicResponse = await fetch('/__world/music');
            if (musicResponse.ok) musicSources = (await musicResponse.json()).files;
            revision = project.revision;
            installedRevision = revision;
            catalog = project.dungeons;
        }
        const local = await loadWorldCheckpoint();
        // The applied project is always the editing base. Browser drafts are opt-in recovery only.
        if (local && !worldDocumentsEqual(local.document, draft)) {
            recoverableDraft = local.document; recoverDraftButton.hidden = false;
        }
        dirty = false;
        if (reload) history.clear();
        el('save-state').textContent = 'Applicato al progetto';
        status(token ? (reload ? 'Progetto ricaricato.' : 'World Studio pronto · progetto applicato.') : 'Anteprima: avvia npm run world:studio per importare e applicare.');
    }
    catch (e) {
        report(e);
    }
    finally {
        ready = true;
        try { const repaired = await repairMovedAssets(); if (repaired) status(`Riparati automaticamente ${repaired} percorsi di immagini spostate. Premi Applica al gioco per salvarli.`); } catch (e) { report(e); }
        const requested = new URLSearchParams(location.search);
        const dungeonId = requested.get('dungeon');
        const requestedAsset = requested.get('asset');
        if (requestedAsset && draft.assets.some(a => a.id === requestedAsset)) { activeAsset = requestedAsset; selected = null; selectTool('asset'); }
        if (requested.get('passages') === '1' && dungeonId) {
            let map = draft.interiors?.find(m => m.document.dungeons.some(d => d.dungeonId === dungeonId && d.enabled !== false));
            const definition = catalog.find(d => d.id === dungeonId);
            if (!map && definition) {
                const created = newDungeonInterior(`interior-${crypto.randomUUID()}`, definition, false, draft.seed);
                change(() => { (draft.interiors ??= []).push(created); for (const placement of draft.dungeons) if (placement.dungeonId === dungeonId) placement.enabled = false; });
                map = created;
            }
            if (map) {
                activeMap = map.id; refresh();
                el<HTMLSelectElement>('area-kind').value = 'dungeon'; el('area-kind').dispatchEvent(new Event('change'));
                el<HTMLSelectElement>('area-map').value = map.id; el('area-map').dispatchEvent(new Event('change'));
                el<HTMLDetailsElement>('areas-controls-panel').open = true;
                if (window.parent !== window) document.body.classList.add('passages-embedded');
            } else status('Installa prima la bozza del dungeon nel catalogo, poi riapri Passaggi.');
        }
        refresh();
        centerAt(surface().spawn.x, surface().spawn.y);
        if (requested.get('passages') === '1' && requested.get('room')) {
            el<HTMLSelectElement>('warp-destination').value = activeMap; el('warp-destination').dispatchEvent(new Event('change'));
            el<HTMLSelectElement>('warp-room').value = `${dungeonId}:${requested.get('room')}`; el('warp-room').dispatchEvent(new Event('change'));
        }
        schedule(true);
    }
}
on('reload', () => load(true));
function openDungeonMaker(id?: string): void {
    const tab = window.open('about:blank', 'riftlands-dungeon-maker');
    void settleGesture().then(() => checkpoint(true)).then(() => {
        const url = `/dungeon-maker.html${id ? `?dungeon=${encodeURIComponent(id)}` : ''}`;
        if (tab) { tab.location.href = url; tab.focus(); }
        else status('Consenti l’apertura della scheda Dungeon Maker nel browser.');
    }).catch(report);
}
el('open-dungeon-maker').onclick = event => { event.preventDefault(); openDungeonMaker(); };
el('edit-dungeon').onclick = () => openDungeonMaker(val('dungeon'));
el('edit-map-dungeon').onclick = () => {
    const dungeonMap = draft.interiors?.find(m => m.id === val('area-map'));
    const dungeon = dungeonMap?.document.dungeons.find(d => d.enabled !== false && catalog.some(item => item.id === d.dungeonId));
    if (dungeon) openDungeonMaker(dungeon.dungeonId);
};
async function refreshDungeonCatalog(): Promise<void> {
    if (!ready || !token || applyingWorld) return;
    const generation = projectGeneration;
    await settleGesture();
    const response = await fetch('/__world/project');
    if (!response.ok) return;
    const project = await response.json();
    if (applyingWorld || generation !== projectGeneration) return;
    const document = compactWorldTiles(parseWorldDocument(project.document));
    const known = new Set(catalog.map(d => d.id));
    catalog = project.dungeons;
    const ids = new Set(catalog.map(d => d.id));
    const before = JSON.stringify([draft.dungeons, ...(draft.interiors ?? []).map(m => m.document.dungeons)]);
    draft = forkWorldDocument(draft);
    for (const doc of [draft, ...(draft.interiors ?? []).map(m => m.document)]) doc.dungeons = doc.dungeons.filter(p => ids.has(p.dungeonId));
    for (const p of document.dungeons) if (!known.has(p.dungeonId) && !draft.dungeons.some(d => d.dungeonId === p.dungeonId)) draft.dungeons.push(p);
    if (project.revision !== installedRevision) {
        if (appliedDocument && !worldDocumentsEqual(document, appliedDocument)) appliedDocument = undefined;
        if (revision === installedRevision && worldDocumentsEqual({ ...document, dungeons: [] }, { ...installedDocument, dungeons: [] })) revision = project.revision;
        else status('Il progetto è cambiato in un’altra scheda: esporta la bozza e ricarica prima di applicare.');
        installedRevision = project.revision; installedDocument = document;
    }
    if (before !== JSON.stringify([draft.dungeons, ...(draft.interiors ?? []).map(m => m.document.dungeons)])) history.clear();
    await checkpoint(true);
    refresh(); schedule(true);
}
if (studioChannel) studioChannel.onmessage = event => { if (event.data?.type === 'dungeons') void refreshDungeonCatalog().catch(report); };
window.addEventListener('focus', () => { void refreshDungeonCatalog().catch(report); });
installWorldWorkspace(root, {
    state: () => ({ project: draft, document: surface(), mapId: activeMap }),
    openMap: id => { input('surface-map').value = id; input('surface-map').dispatchEvent(new Event('change')); },
    inspect: (kind, id, p, elevation) => {
        finishGesture(undefined,true); elevationEditor.cancelGesture(); warpEditor.clearSelection();
        if(kind==='placement'){ensureWorld();const instance=surface().placements.find(p=>p.id===id);if(instance)elevation=instance.baseElevation??world.elevation.terrainElevationAt(instance.x+.5,instance.y+.5);}
        set('elevation-view','all'); set('elevation-active',elevation); input('elevation-active').dispatchEvent(new Event('change'));
        if (kind === 'surfaces' || kind === 'solids' || kind === 'stairs') elevationEditor.selectShape(kind,id);
        else if (kind === 'warp') warpEditor.select(id);
        else { selectTool('select'); selected = { kind, id }; selectedGenerated=undefined; }
        centerAt(p.x+.5,p.y+.5); refresh(); revealInspector(); schedule(true);
    },
});
let viewportSize: {width:number;height:number}|undefined;
new ResizeObserver(entries => {
    const {width,height}=entries[0].contentRect;
    if(viewportSize){view.x+=(width-viewportSize.width)/2;view.y+=(height-viewportSize.height)/2;}
    viewportSize={width,height};schedule();
}).observe(canvas);
new ResizeObserver(() => schedule()).observe(assetCanvas);
selectTool('select');
void load();
