import { emptyGeometry, validElevation, validGeometry } from '../../../shared/elevation';
import { addSuspendedSurface, editGeometry, removeGeometry, updateGeometry, setAssetPassage, tiledStairRect, type GeometryKind, type GeometryOwner, type GeometryShape } from '../../../shared/elevation-editing';
import type { WorldAsset, WorldDocument } from '../../../shared/world-schema';
import type { TileKind, Vec2 } from '../../../shared/types';
import { drawGeometryOverlay } from '../../render/elevation-art';
import { filterGeometry, floorVisible, parseVisibleFloors, shapeVisible, type ElevationVisibility } from './elevation-visibility';

interface Host {
  document(): WorldDocument; asset(): WorldAsset | undefined;
  tool(): string; selectTool(tool: string): void;
  change(action: () => void): void; schedule(): void;
  panHeld(): boolean;
  visibilityChanged(): void;
  mapPoint(event: PointerEvent): Vec2;
  terrainAt?(x: number, y: number): number;
  assetPoint(event: PointerEvent): Vec2 | undefined;
}
/** Geometry uses normal draft transactions; it never writes directly to the applied project. */
export function installElevationEditor(root: HTMLElement, canvas: HTMLCanvasElement, assetCanvas: HTMLCanvasElement, host: Host) {
  const panel = document.createElement('section'); panel.id = 'elevation-controls';
  panel.innerHTML = `<h3>Terreni e quote</h3><button id="elevation-new-terrain" class="wide primary">＋ Nuovo terreno con quota</button><p class="hint">Crea il terreno dal pannello a destra. Qui scegli gli strumenti e i livelli da vedere.</p><div class="pair"><label>Quota attiva<input id="elevation-active" type="number" min="-128" max="127" step="1" value="0"></label><label>Livelli visibili<select id="elevation-view"><option value="all">Tutti · vista completa</option><option value="active">Solo quota attiva</option><option value="from">Da una quota in su</option><option value="range">Intervallo di quote</option><option value="custom">Quote scelte</option></select></label></div>
  <div id="elevation-range-fields" class="pair" hidden><label>Da quota<input id="elevation-view-from" type="number" min="-128" max="127" step="1" value="0"></label><label id="elevation-view-to-label">A quota<input id="elevation-view-to" type="number" min="-128" max="127" step="1" value="2"></label></div>
  <div id="elevation-custom-fields" hidden><label>Quote separate da virgole<input id="elevation-visible-levels" type="text" value="0, 2" placeholder="-1, 0, 2, 14"></label><div id="elevation-level-choices" class="elevation-level-choices" aria-label="Scegli le quote visibili"></div></div>
  <p id="elevation-view-summary" class="hint" role="status">Tutti i livelli visibili. La quota attiva indica dove lavori.</p>
  <label>Dove disegni<select id="elevation-owner"><option value="map">Sulla mappa</option><option value="asset">Dentro un oggetto · quote relative</option></select></label>
  <div class="tool-grid"><button data-elevation-tool="raise">Rialzo</button><button data-elevation-tool="bridge">Passaggio sospeso</button><button data-elevation-tool="surface">Superficie</button><button data-elevation-tool="solid">Ostacolo</button><button data-elevation-tool="stair">Scala</button><button data-elevation-tool="select">Seleziona forma</button></div>
  <p class="hint" id="elevation-drag-hint">Le impostazioni dello strumento sono nel pannello a destra.</p>
  <label>Area selezionata<select id="elevation-shape"><option value="">Nessuna</option></select></label>
  <label>Materiale superficie<select id="elevation-material"><option value="grass">Erba</option><option value="path">Strada</option><option value="rock">Roccia · ostacolo +1</option><option value="mud">Fango</option><option value="snow">Neve</option><option value="ice">Ghiaccio</option><option value="bush">Cespuglio</option></select></label>
  <div class="pair"><label>X<input id="elevation-x" type="number" step=".25" value="0"></label><label>Y<input id="elevation-y" type="number" step=".25" value="0"></label></div>
  <div class="pair"><label>Larghezza<input id="elevation-width" type="number" min=".01" step=".25" value="1"></label><label>Altezza<input id="elevation-height" type="number" min=".01" step=".25" value="1"></label></div>
  <div class="pair"><label>Base / quota A<input id="elevation-from" type="number" min="-128" max="127" step="1" value="0"></label><label>Sommità / quota B<input id="elevation-to" type="number" min="-128" max="128" step="1" value="1"></label></div>
  <label>Asse scala<select id="elevation-axis"><option value="x">X · sinistra → destra</option><option value="y">Y · alto → basso</option></select></label>
  <p class="hint" id="elevation-rules-hint">Rialzo: da Base a Quota attiva. Ponte: superficie sospesa con spazio libero sotto; aggiungi i pilastri come ostacoli. Ostacolo: Base inclusa, Sommità esclusa. Superficie: Quota attiva.</p>
  <div class="property-actions"><button id="elevation-update">Aggiorna forma</button><button id="elevation-delete">Elimina forma</button></div>
  <button id="elevation-legacy" class="wide">Asset: ripristina collisioni a celle</button><p id="elevation-status" class="hint" role="status"></p>`;
  root.querySelector('#build-controls')!.prepend(panel);
  const inspector = document.createElement('section'); inspector.id = 'elevation-inspector';
  inspector.innerHTML = `<h2>Terreni e quote</h2><div id="elevation-owner-slot" class="fields"></div>
  <div id="elevation-create-card" class="elevation-create-card fields">
    <p>Per creare il primo rialzo usa <strong>base 0</strong> e <strong>quota 1</strong>.</p>
    <div class="pair"><label>Quota di partenza<input id="elevation-create-base" type="number" min="-128" max="127" step="1" value="0"></label><label>Quota del nuovo terreno<input id="elevation-target" type="number" min="-128" max="127" step="1" value="1"></label></div>
    <div id="elevation-material-slot"></div>
    <button id="elevation-draw-terrain" class="primary wide">Disegna terreno</button>
    <ol class="elevation-steps"><li>Scegli le quote e il materiale.</li><li>Premi «Disegna terreno».</li><li>Trascina sulla mappa per creare l’area.</li></ol>
    <p id="elevation-create-hint" class="hint">Il terreno viene aggiunto quando rilasci il mouse. Per raggiungerlo, collega i due piani con una scala.</p>
  </div>
  <p id="elevation-action-guide" class="elevation-action-guide" role="status"></p>
  <div id="elevation-draw-settings" class="fields"></div>
  <p id="elevation-selection-summary" class="hint"></p>
  <button id="elevation-add-stair" class="wide" hidden>Aggiungi scala di accesso</button>
  <details id="elevation-selection-properties"><summary>Proprietà della selezione</summary><div id="elevation-property-fields" class="fields"></div></details>
  <div id="elevation-legacy-slot"></div><p id="elevation-status" class="hint" role="status"></p>`;
  root.querySelector('.inspector')!.prepend(inspector);
  inspector.querySelector('#elevation-owner-slot')!.append(panel.querySelector('#elevation-owner')!.closest('label')!);
  inspector.querySelector('#elevation-material-slot')!.append(panel.querySelector('#elevation-material')!.closest('label')!);
  const properties = inspector.querySelector('#elevation-property-fields')!;
  inspector.insertBefore(panel.querySelector('#elevation-shape')!.closest('label')!, inspector.querySelector('#elevation-selection-summary'));
  properties.append(panel.querySelector('#elevation-x')!.closest('.pair')!, panel.querySelector('#elevation-width')!.closest('.pair')!, panel.querySelector('#elevation-update')!.parentElement!);
  inspector.querySelector('#elevation-draw-settings')!.append(panel.querySelector('#elevation-from')!.closest('.pair')!, panel.querySelector('#elevation-axis')!.closest('label')!);
  inspector.querySelector('#elevation-draw-settings')!.insertAdjacentHTML('beforeend', '<div id="elevation-stair-size" class="pair"><label>Larghezza scala · tile<input id="elevation-stair-width" type="number" min="1" max="128" step="1" value="1"></label><label>Lunghezza scala · tile<input id="elevation-stair-length" type="number" min="2" max="128" step="1" value="3"></label></div><p id="elevation-stair-size-hint" class="hint">Minimo un tile intero in larghezza. La lunghezza include i pianerottoli di ingresso e uscita. Modifica le dimensioni e premi Aggiorna selezione per allargare una scala esistente.</p>');
  inspector.querySelector('#elevation-legacy-slot')!.append(panel.querySelector('#elevation-legacy')!);
  panel.querySelector('#elevation-status')!.remove(); panel.querySelector('#elevation-rules-hint')!.remove();
  const advanced = document.createElement('details'); advanced.id = 'elevation-advanced';
  advanced.innerHTML = '<summary>Ponti, scale e forme avanzate</summary>';
  advanced.open = true;
  advanced.append(panel.querySelector('#elevation-new-terrain')!, panel.querySelector('.tool-grid')!, panel.querySelector('#elevation-drag-hint')!);
  panel.append(advanced);
  const stairTool = advanced.querySelector<HTMLButtonElement>('[data-elevation-tool="stair"]')!;
  stairTool.textContent = '▤ Scala / passaggio · sali e scendi'; stairTool.classList.add('wide');
  panel.insertBefore(stairTool, advanced);
  const bridgeTool = advanced.querySelector<HTMLButtonElement>('[data-elevation-tool="bridge"]')!;
  bridgeTool.textContent = 'Ponte / passaggio sospeso'; bridgeTool.classList.add('wide');
  panel.insertBefore(bridgeTool, stairTool);
  const viewSelect = panel.querySelector<HTMLSelectElement>('#elevation-view')!;
  viewSelect.add(new Option('Solo quota 0 · terra', 'floor:0'), 1);
  viewSelect.add(new Option('Solo quota 1', 'floor:1'), 2);
  const intro = panel.querySelector('p.hint');
  if (intro) intro.textContent = 'Scegli il materiale Terreno e dipingi. A destra puoi impostare la quota; i bordi esterni vengono creati automaticamente.';
  const advancedInspector = document.createElement('div'); advancedInspector.id = 'elevation-advanced-inspector';
  advancedInspector.append(...[...inspector.children].slice(1));
  const brushSettings = document.createElement('div'); brushSettings.id = 'terrain-brush-settings'; brushSettings.className = 'fields';
  brushSettings.innerHTML = '<h3 id="terrain-brush-material">Materiale del pennello</h3><label>Quota del terreno<input id="terrain-elevation" type="number" min="-128" max="127" step="1" placeholder="Mantieni quota del terreno"></label><button id="terrain-elevation-auto">Mantieni quota del terreno</button><p class="hint">Lascia vuoto per cambiare solo il materiale alla quota presente sotto il pennello. Scrivi 1 per creare subito terreno a quota 1. Il bordo cliff-grid occupa una casella esterna: un singolo tile rialzato ha 8 tile di bordo.</p>';
  inspector.append(brushSettings, advancedInspector);
  brushSettings.insertAdjacentHTML('beforeend', '<label class="check"><input id="terrain-auto-stair" type="checkbox">Crea una scala di accesso al rialzo</label><button id="terrain-stair-tool" class="wide">Disegna scala / passaggio</button><p class="hint">Puoi collegare i piani con un PNG configurato come scala o con un passaggio sul terreno. La scala automatica in pietra è facoltativa.</p>');
  brushSettings.querySelector<HTMLButtonElement>('#terrain-stair-tool')!.onclick = () => stairTool.click();
  brushSettings.querySelector<HTMLButtonElement>('#terrain-elevation-auto')!.onclick = () => { (root.querySelector('#terrain-elevation') as HTMLInputElement).value = ''; host.schedule(); };
  panel.querySelector('#elevation-view')!.closest('label')!.classList.add('elevation-view-label');
  const quotaLabel = panel.querySelector('#elevation-active')!.closest('label')!;
  quotaLabel.classList.add('elevation-toolbar'); root.querySelector('.map-toolbar')!.insertBefore(quotaLabel, root.querySelector('#tool-label'));
  const get = (id: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`#elevation-${id}`)!;
  (get('material') as HTMLSelectElement).add(new Option('Trasparente · pavimento invisibile', 'transparent'));
  inspector.querySelector('#elevation-material-slot')!.insertAdjacentHTML('afterend', '<label id="elevation-inherit-label" class="check"><input id="elevation-inherit-assets" type="checkbox" checked>Gli asset sopra ereditano la dissolvenza del ponte</label><p id="elevation-inherit-hint" class="hint">Vale solo per le istanze alla quota del ponte e nella sua area. Disattiva per conservare il comportamento visivo dei singoli asset. Il materiale Trasparente nasconde solo il pavimento.</p>');
  const inheritAssets = get('inherit-assets') as HTMLInputElement;
  const n = (id: string) => Number(get(id).value);
  const set = (id: string, value: unknown) => { get(id).value = String(value); };
  inspector.querySelector('#elevation-stair-size-hint')!.insertAdjacentHTML('afterend','<label id="elevation-stair-appearance-label">Grafica del collegamento<select id="elevation-stair-appearance"><option value="passage">Passaggio · conserva terreno / PNG</option><option value="stone">Scala in pietra</option></select></label>');
  root.querySelector('#asset-inspector')!.insertAdjacentHTML('beforeend','<button id="elevation-asset-stair" class="wide">Usa questo asset come scala / passaggio</button><p class="hint">Collega due quote usando questo PNG. Imposta partenza, arrivo e direzione nel pannello Terreni e quote; poi piazza l’asset sulla mappa.</p>');
  const isAsset = () => get('owner').value === 'asset';
  const owner = (): GeometryOwner => {
    const a = isAsset() ? host.asset() : host.document();
    if (!a) throw new Error('Seleziona un asset nel catalogo.'); return a;
  };
  let selection = '', ownerKey: object | undefined;
  let propertiesSelection = '', needsPrepare = false;
  let lastValidFilter: ElevationVisibility = null;
  function visibility(): ElevationVisibility {
    const mode = get('view').value;
    if (mode === 'all') return null;
    if (mode.startsWith('floor:')) return [Number(mode.slice(6))];
    if (mode === 'active') return [n('active')];
    if (mode === 'custom') {
      try { return parseVisibleFloors(get('visible-levels').value); } catch { return lastValidFilter; }
    }
    const from = n('view-from'), to = mode === 'from' ? 127 : n('view-to');
    if (!validElevation(from) || !validElevation(to) || from > to) return lastValidFilter;
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }
  function viewChanged() {
    const mode = get('view').value;
    panel.querySelector<HTMLElement>('#elevation-range-fields')!.hidden = !['from', 'range'].includes(mode);
    panel.querySelector<HTMLElement>('#elevation-view-to-label')!.hidden = mode !== 'range';
    panel.querySelector<HTMLElement>('#elevation-custom-fields')!.hidden = mode !== 'custom';
    try {
      if (mode === 'custom') parseVisibleFloors(get('visible-levels').value);
      if (['from', 'range'].includes(mode) && (!validElevation(n('view-from')) || (mode === 'range' && (!validElevation(n('view-to')) || n('view-from') > n('view-to')))))
        throw new Error('Intervallo non valido: usa quote intere da -128 a 127, in ordine crescente.');
      lastValidFilter = visibility();
      if (lastValidFilter?.length && !floorVisible(lastValidFilter, n('active'))) set('active', lastValidFilter[0]);
      panel.querySelector('#elevation-view-summary')!.textContent = lastValidFilter === null ? 'Tutti i livelli visibili. La quota attiva indica dove lavori.'
        : lastValidFilter.length ? `Livelli visibili: ${mode === 'from' ? `${n('view-from')} e superiori` : mode === 'range' ? `${n('view-from')}…${n('view-to')}` : lastValidFilter.join(', ')}. Gli altri sono nascosti.` : 'Nessun livello visibile.';
      const current = selection ? selected().shape : undefined;
      if (selection && (!current || !shapeVisible(current, lastValidFilter))) selection = '';
      dragging = undefined;
      host.visibilityChanged();
    } catch (e) { panel.querySelector('#elevation-view-summary')!.textContent = (e as Error).message; }
    refresh(); host.schedule();
  }
  let dragging: { start: Vec2; end: Vec2; target: HTMLCanvasElement; id: number } | undefined;
  function cancelGesture() {
    const d = dragging; dragging = undefined;
    if (d?.target.hasPointerCapture(d.id)) d.target.releasePointerCapture(d.id);
    host.schedule();
  }
  document.addEventListener('keydown', e => { if (e.code === 'Escape') cancelGesture(); });
  window.addEventListener('blur', cancelGesture);
  const mode = () => host.tool().replace('elevation-', '');
  const selected = () => {
    const [kind, id] = selection.split('|') as [GeometryKind, string];
    return { kind, shape: owner().geometry?.[kind]?.find(s => s.id === id) as GeometryShape | undefined };
  };
  function fill() {
    let shape: GeometryShape | undefined;
    try { shape = selected().shape; } catch { return; }
    if (!shape) return;
    for (const field of ['x', 'y', 'width', 'height'] as const) set(field, shape[field]);
    if ('elevation' in shape) {
      set('active', shape.elevation); set('target', shape.elevation); set('material', shape.transparent ? 'transparent' : shape.terrain ?? 'grass');
      inheritAssets.checked = shape.inheritAssetVisuals !== false;
      set('create-base', owner().geometry?.solids.find(s => s.id === `${shape!.id}-mass`)?.base ?? 0);
    }
    if ('base' in shape) { set('from', shape.base); set('to', shape.top); }
    if ('axis' in shape) { set('from', shape.from); set('to', shape.to); set('axis', shape.axis); set('stair-appearance',shape.appearance??'stone'); set('stair-width', Math.max(1, Math.ceil(shape.axis === 'x' ? shape.height : shape.width))); set('stair-length', Math.max(2, Math.ceil(shape.axis === 'x' ? shape.width : shape.height))); }
  }
  function refresh() {
    const terrainTool = host.tool() === 'terrain' || host.tool() === 'restore';
    brushSettings.hidden = !terrainTool;
    advancedInspector.hidden = terrainTool;
    brushSettings.querySelector('#terrain-brush-material')!.textContent = `Materiale: ${root.querySelector<HTMLSelectElement>('#terrain')!.selectedOptions[0]?.textContent ?? ''}`;
    const a = isAsset() ? host.asset() : host.document();
    const g = a?.geometry ?? emptyGeometry();
    // Draft objects are replaced by transactions; keep selection by stable shape ID.
    if (ownerKey !== a) ownerKey = a;
    const list = get('shape') as HTMLSelectElement;
    list.replaceChildren(new Option('Nessuna', ''));
    for (const kind of ['surfaces', 'solids', 'stairs'] as const) for (const s of g[kind]) {
      if (!shapeVisible(s, visibility())) continue;
      const label = 'elevation' in s ? `Superficie ${s.elevation}` : 'base' in s ? `Ostacolo ${s.base}…${s.top}` : `Scala ${s.from} → ${s.to}`;
      list.add(new Option(`${label} · X ${s.x}, Y ${s.y}`, `${kind}|${s.id}`));
    }
    list.value = selection; selection = list.value;
    const current = selection ? selected().shape : undefined, tool = mode();
    const isSurface = current && 'elevation' in current;
    const suspended = isSurface ? !current.ground : tool === 'bridge' || tool === 'surface';
    inspector.querySelector<HTMLElement>('#elevation-inherit-label')!.hidden = !suspended;
    inspector.querySelector<HTMLElement>('#elevation-inherit-hint')!.hidden = !suspended;
    get('material').querySelector<HTMLOptionElement>('[value="transparent"]')!.disabled = !suspended;
    if (!suspended && get('material').value === 'transparent') set('material', 'grass');
    get('create-base').closest('label')!.hidden = suspended;
    get('target').closest('label')!.firstChild!.textContent = suspended ? 'Quota del pavimento sospeso' : 'Quota del nuovo terreno';
    inspector.querySelector('#elevation-create-card > p')!.textContent = suspended
      ? 'Scegli la quota del ponte. Il pavimento si raccorda alle superfici esistenti alla stessa quota, lasciando libero lo spazio sotto.'
      : 'Per creare il primo rialzo usa base 0 e quota 1.';
    inspector.querySelector<HTMLElement>('.elevation-steps')!.hidden = suspended;
    inspector.querySelector('#elevation-create-hint')!.textContent = suspended
      ? 'Disegna anche sopra gli imbocchi: le parti già coperte da un pavimento alla stessa quota vengono escluse automaticamente. Per raccordare un ponte esistente premi «Aggiorna selezione».'
      : 'Il terreno viene aggiunto quando rilasci il mouse. Per raggiungerlo, collega i due piani con una scala.';
    const parameters = inspector.querySelector<HTMLElement>('#elevation-draw-settings')!;
    parameters.hidden = current ? 'elevation' in current : !['solid', 'stair'].includes(tool);
    inspector.querySelector<HTMLElement>('#elevation-create-card')!.hidden = !parameters.hidden;
    const stairSettings = current ? 'axis' in current : tool === 'stair';
    inspector.querySelector<HTMLElement>('#elevation-stair-size')!.hidden = !stairSettings;
    inspector.querySelector<HTMLElement>('#elevation-stair-size-hint')!.hidden = !stairSettings;
    inspector.querySelector<HTMLElement>('#elevation-stair-appearance-label')!.hidden = !stairSettings;
    get('stair-appearance').disabled=isAsset();
    if(stairSettings&&isAsset())set('stair-appearance','passage');
    for (const id of ['width', 'height']) { const input = get(id) as HTMLInputElement; input.min = stairSettings ? '1' : '.01'; input.step = stairSettings ? '1' : '.25'; }
    get('axis').closest('label')!.hidden = !stairSettings;
    get('from').closest('label')!.firstChild!.textContent = stairSettings ? get('axis').value === 'x' ? 'Quota a sinistra' : 'Quota in alto' : 'Base dell’ostacolo';
    get('to').closest('label')!.firstChild!.textContent = stairSettings ? get('axis').value === 'x' ? 'Quota a destra' : 'Quota in basso' : 'Sommità dell’ostacolo';
    inspector.querySelector<HTMLElement>('#elevation-legacy-slot')!.hidden = !isAsset();
    const details = inspector.querySelector<HTMLDetailsElement>('#elevation-selection-properties')!;
    details.hidden = !g.surfaces.length && !g.solids.length && !g.stairs.length;
    if (propertiesSelection !== selection) { details.open = !!selection; propertiesSelection = selection; }
    inspector.querySelector('#elevation-selection-summary')!.textContent = current
      ? `${'elevation' in current ? `${current.ground ? 'Terreno' : 'Pavimento sospeso'} a quota ${current.elevation}` : 'axis' in current ? `Scala ${current.from} → ${current.to}` : `Ostacolo da ${current.base} a ${current.top}`} · ${current.width} × ${current.height} caselle. Per cambiarlo usa «Aggiorna selezione».`
      : 'Nessuna area selezionata. Puoi crearne una nuova oppure usare «Seleziona forma».';
    const terrainButton = inspector.querySelector<HTMLButtonElement>('#elevation-draw-terrain')!;
    terrainButton.textContent = tool === 'bridge' ? 'Disegna passaggio sospeso' : tool === 'surface' ? 'Disegna superficie' : 'Disegna terreno';
    inspector.querySelector('#elevation-action-guide')!.textContent = current ? 'Area selezionata: cambia le proprietà e premi «Aggiorna selezione». Per un’altra area usa «Nuovo terreno con quota».' : tool === 'stair'
      ? `Trascina la scala fra i due piani. Quota A ${n('from')} → quota B ${n('to')}; ${get('axis').value === 'x' ? 'da sinistra a destra' : 'dall’alto verso il basso'}.`
      : tool === 'solid' ? `Trascina l’ingombro dell’ostacolo. Bloccherà i livelli da ${n('from')} fino a ${n('to') - 1}.`
      : tool === 'configure' || needsPrepare ? 'Imposta il terreno qui sopra, poi premi «Disegna terreno» e trascina sulla mappa.'
      : tool === 'raise' ? `Pronto: trascina ${isAsset() ? 'nell’anteprima dell’oggetto' : 'sulla mappa'} per creare terreno a quota ${n('active')}, con base ${n('from')}.`
      : tool === 'bridge' ? `Trascina il ponte a quota ${n('active')} includendo i bordi dei rilievi. Il ponte si ritaglia sulle superfici già presenti; lo spazio sotto resta libero.`
      : tool === 'surface' ? `Trascina una superficie calpestabile a quota ${n('active')}.`
      : 'Per iniziare: imposta quota 1, base 0 ed erba, poi premi «Disegna terreno».';
    inspector.querySelector<HTMLButtonElement>('#elevation-add-stair')!.hidden = !isSurface || current.elevation === (owner().geometry?.solids.find(s => s.id === `${current.id}-mass`)?.base ?? 0);
    inspector.querySelector<HTMLButtonElement>('#elevation-update')!.textContent = 'Aggiorna selezione';
    const levels = new Set<number>([-1, 0, 1, n('active')]);
    if(isAsset()){for(const c of host.asset()?.cells??[])if(c.elevation!==undefined)levels.add(c.elevation);}
    else {for(const asset of host.document().assets)if(Object.values(host.document().cliffAssets??{}).includes(asset.id))for(const c of asset.cells)if(c.elevation!==undefined)levels.add(c.elevation);}
    for (const s of g.surfaces) levels.add(s.elevation);
    for (const s of g.stairs) { levels.add(s.from); levels.add(s.to); }
    const assets = new Map(host.document().assets.map(a => [a.id, a]));
    if (!isAsset()) for (const p of host.document().placements) {
      const base = p.baseElevation ?? 0; levels.add(base);
      const a = assets.get(p.assetId);
      for(const cell of a?.cells??[])if(cell.elevation!==undefined)levels.add(base+cell.elevation);
      for (const s of a?.geometry?.surfaces ?? []) levels.add(base + s.elevation);
    }
    const choices = panel.querySelector('#elevation-level-choices')!; choices.replaceChildren();
    let chosen: number[] = []; try { chosen = parseVisibleFloors(get('visible-levels').value); } catch { /* retain typed text */ }
    for (const e of chosen) levels.add(e);
    const chosenView = viewSelect.value;
    for (const option of [...viewSelect.options]) if (option.value.startsWith('floor:')) option.remove();
    for (const level of [...levels].sort((a,b) => a-b)) viewSelect.add(new Option(`Solo quota ${level}${level === 0 ? ' · terra' : ''}`, `floor:${level}`), 1 + [...viewSelect.options].filter(o => o.value.startsWith('floor:')).length);
    viewSelect.value = chosenView;
    for (const level of [...levels].sort((a, b) => a - b)) {
      const label = document.createElement('label'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.value = String(level); checkbox.checked = chosen.includes(level);
      checkbox.onchange = () => { const next = new Set(parseVisibleFloors(get('visible-levels').value)); if (checkbox.checked) next.add(level); else next.delete(level); set('visible-levels', [...next].sort((a, b) => a - b).join(', ')); viewChanged(); };
      label.append(checkbox, document.createTextNode(String(level))); choices.append(label);
    }
  }
  const run = (action: () => void) => {
    try { host.change(action); refresh(); fill(); inspector.querySelector('#elevation-status')!.textContent = ''; }
    catch (e) { inspector.querySelector('#elevation-status')!.textContent = (e as Error).message; }
    host.schedule();
  };
  get('shape').onchange = () => { selection = get('shape').value; fill(); refresh(); host.schedule(); };
  get('owner').onchange = () => { selection = ''; host.visibilityChanged(); refresh(); host.schedule(); };
  get('active').onchange = () => { if (!validElevation(n('active'))) set('active', 0); set('target', n('active')); viewChanged(); };
  for (const id of ['view', 'view-from', 'view-to', 'visible-levels']) get(id).onchange = viewChanged;
  for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-elevation-tool]')) b.onclick = () => {
    const tool = b.dataset.elevationTool;
    if (tool !== 'select') selection = '';
    if (tool === 'raise' && n('active') <= n('from') && n('from') < 127) set('active', n('from') + 1);
    set('target', n('active')); set('create-base', n('from')); needsPrepare = false;
    host.selectTool(`elevation-${b.dataset.elevationTool}`);
    panel.querySelectorAll('[data-elevation-tool]').forEach(el => el.setAttribute('aria-pressed', String(el === b)));
  };
  inspector.querySelector<HTMLButtonElement>('#elevation-delete')!.onclick = () => run(() => {
    const { kind, shape } = selected(); if (shape) removeGeometry(owner(), kind, shape.id); selection = '';
  });
  inspector.querySelector<HTMLButtonElement>('#elevation-legacy')!.onclick = () => run(() => { if (isAsset()) delete owner().geometry; });
  inspector.querySelector<HTMLButtonElement>('#elevation-update')!.onclick = () => run(() => {
    const { kind, shape } = selected(); if (!shape) return;
    if(!isAsset()&&'elevation'in shape&&shape.ground&&Math.abs(n('target')-shape.elevation)>1)throw new Error('Non possibile: modifica il terreno di un solo livello per volta.');
    const r = { id: shape.id, x: n('x'), y: n('y'), width: n('width'), height: n('height') };
    const next = 'elevation' in shape ? { ...shape, ...r, elevation: n('target'), terrain: get('material').value === 'transparent' ? shape.terrain ?? 'grass' : get('material').value as TileKind, transparent: get('material').value === 'transparent', ...(!shape.ground ? { inheritAssetVisuals: inheritAssets.checked } : {}) }
      : 'base' in shape ? { ...r, base: n('from'), top: n('to') }
      : { ...r, x: Math.floor(r.x), y: Math.floor(r.y), width: Math.max(get('axis').value === 'x' && shape.id!=='asset-passage' ? 2 : 1, Math.round(r.width)), height: Math.max(get('axis').value === 'y' && shape.id!=='asset-passage' ? 2 : 1, Math.round(r.height)), from: n('from'), to: n('to'), axis: get('axis').value as 'x' | 'y', appearance:get('stair-appearance').value as 'stone'|'passage', tiled: shape.id==='asset-passage'?undefined:true };
    const copy = structuredClone(owner()); updateGeometry(copy, kind, next);
    const copiedMass = copy.geometry?.solids.find(s => s.id === `${shape.id}-mass`);
    if (copiedMass && 'elevation' in shape) copiedMass.base = n('create-base');
    if (!validGeometry(copy.geometry)) throw new Error('Quote o dimensioni non valide.');
    updateGeometry(owner(), kind, next);
    if(isAsset()&&next.id==='asset-passage'&&'axis' in next)setAssetPassage(host.asset()!,next);
    const mass = owner().geometry?.solids.find(s => s.id === `${shape.id}-mass`);
    if (mass && 'elevation' in shape) mass.base = n('create-base');
  });
  for (const id of ['target', 'create-base']) get(id).onchange = () => { needsPrepare = true; refresh(); host.schedule(); };
  get('from').onchange = get('to').onchange = get('axis').onchange = () => { refresh(); host.schedule(); };
  for (const id of ['stair-width', 'stair-length']) get(id).onchange = () => {
    set(id, Math.max(id === 'stair-width' ? 1 : 2, Math.min(128, Math.round(n(id)) || 1)));
    const s = selected().shape;
    if (s && 'axis' in s) {
      const axis = get('axis').value;
      set(id === 'stair-width' ? axis === 'x' ? 'height' : 'width' : axis === 'x' ? 'width' : 'height', n(id));
    }
    host.schedule();
  };
  panel.querySelector<HTMLButtonElement>('#elevation-new-terrain')!.onclick = () => {
    selection = ''; set('owner', 'map'); set('create-base', n('active')); set('target', Math.min(127, n('active') + 1)); needsPrepare = true;
    host.selectTool('elevation-configure'); inspector.scrollIntoView({ block: 'start' }); get('target').focus();
  };
  inspector.querySelector<HTMLButtonElement>('#elevation-draw-terrain')!.onclick = () => {
    const target = n('target'), base = n('create-base'), tool = ['bridge', 'surface'].includes(mode()) ? mode() : 'raise';
    if (!validElevation(target) || !validElevation(base) || (tool === 'raise' && target <= base)) { inspector.querySelector('#elevation-status')!.textContent = 'Per un rialzo la quota finale deve essere maggiore della partenza, per esempio 0 → 1.'; return; }
    selection = ''; needsPrepare = false; set('active', target); set('from', base); set('to', target);
    inspector.querySelector('#elevation-status')!.textContent = '';
    if (!floorVisible(visibility(), target)) set('view', 'all');
    viewChanged(); host.selectTool(`elevation-${tool}`); refresh(); host.schedule();
  };
  inspector.querySelector<HTMLButtonElement>('#elevation-add-stair')!.onclick = () => {
    const s = selected().shape; if (!s || !('elevation' in s)) return;
    set('from', owner().geometry?.solids.find(m => m.id === `${s.id}-mass`)?.base ?? 0); set('to', s.elevation);
    selection = ''; needsPrepare = false; host.selectTool('elevation-stair'); refresh(); host.schedule();
  };
  root.querySelector<HTMLButtonElement>('#elevation-asset-stair')!.onclick = () => run(() => {
    const asset=host.asset();if(!asset)throw new Error('Seleziona un asset.');
    set('owner','asset');set('view','all');
    const existing=asset.geometry?.stairs.find(s=>s.id==='asset-passage');
    if(!existing)setAssetPassage(asset,{id:'asset-passage',x:0,y:0,width:asset.columns,height:asset.rows,from:0,to:1,axis:'x',appearance:'passage'});
    selection='stairs|asset-passage';needsPrepare=false;fill();host.selectTool('elevation-stair');
    inspector.scrollIntoView({block:'start'});
  });
  function point(e: PointerEvent, target: HTMLCanvasElement) {
    const p = target === assetCanvas ? host.assetPoint(e) : host.mapPoint(e);
    const grid = mode() === 'stair' ? 1 : 4;
    return p ? { x: Math.floor(p.x * grid) / grid, y: Math.floor(p.y * grid) / grid } : undefined;
  }
  for (const target of [canvas, assetCanvas]) {
    target.addEventListener('pointerdown', e => {
      if (!host.tool().startsWith('elevation-') || e.button !== 0 || host.panHeld()) return;
      if (isAsset() !== (target === assetCanvas)) { e.stopImmediatePropagation(); return; }
      const p = point(e, target); if (!p) return;
      e.stopImmediatePropagation(); e.preventDefault();
      target.focus();
      if (mode() === 'configure' || needsPrepare) { inspector.querySelector('#elevation-status')!.textContent = 'Premi «Disegna terreno» nel pannello a destra, poi trascina l’area.'; return; }
      if (mode() === 'select') {
        if (target === canvas && selectMapAt(p)) return;
        const g = owner().geometry;
        selection = '';
        for (const kind of ['surfaces', 'solids', 'stairs'] as const) for (const s of g?.[kind] ?? [])
          if (!s.id.endsWith('-mass') && shapeVisible(s, visibility()) && p.x >= s.x && p.y >= s.y && p.x < s.x + s.width && p.y < s.y + s.height) selection = `${kind}|${s.id}`;
        refresh(); fill(); host.schedule(); return;
      }
      if (!floorVisible(visibility(), n('active'))) { inspector.querySelector('#elevation-status')!.textContent = 'Scegli una quota attiva visibile prima di disegnare.'; return; }
      dragging = { start: p, end: p, target, id: e.pointerId }; target.setPointerCapture(e.pointerId); host.schedule();
    }, true);
    target.addEventListener('pointermove', e => {
      if (!dragging || dragging.target !== target || dragging.id !== e.pointerId) return;
      e.stopImmediatePropagation(); const p = point(e, target); if (p) dragging.end = p; host.schedule();
    }, true);
    target.addEventListener('pointercancel', e => { if (dragging?.target === target) { e.stopImmediatePropagation(); dragging = undefined; host.schedule(); } }, true);
    target.addEventListener('lostpointercapture', () => { if (dragging?.target === target) cancelGesture(); });
    target.addEventListener('pointerup', e => {
      if (!dragging || dragging.target !== target || dragging.id !== e.pointerId) return;
      e.stopImmediatePropagation(); const d = dragging; dragging = undefined;
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
      const r = { id: `shape-${crypto.randomUUID()}`, x: Math.min(d.start.x, d.end.x), y: Math.min(d.start.y, d.end.y), width: Math.abs(d.start.x - d.end.x) + .25, height: Math.abs(d.start.y - d.end.y) + .25 };
      run(() => {
        if (!validElevation(n('active'))) throw new Error('Quota non valida.');
        if (mode() === 'raise' && !isAsset() && host.terrainAt) {
          for (let y=Math.floor(r.y);y<Math.ceil(r.y+r.height);y++) for(let x=Math.floor(r.x);x<Math.ceil(r.x+r.width);x++)
            if(Math.abs(host.terrainAt(x+.5,y+.5)-n('active'))>1) throw new Error('Non possibile: il terreno può cambiare di un solo livello per volta. Usa un oggetto specifico per un salto maggiore.');
        }
        const g = editGeometry(owner()), m = mode();
        if (m === 'raise' || m === 'bridge' || m === 'surface') {
          const surface = { ...r, elevation: n('active'), ground: m === 'raise', terrain: (get('material').value === 'transparent' ? 'grass' : get('material').value) as TileKind,
            ...(m !== 'raise' ? { transparent: get('material').value === 'transparent', inheritAssetVisuals: inheritAssets.checked } : {}) };
          if (m === 'raise') g.surfaces.push(surface);
          else addSuspendedSurface(owner(), surface);
          if (m === 'raise') g.solids.push({ ...r, id: `${r.id}-mass`, base: n('from'), top: n('active') });
          selection = `surfaces|${r.id}`;
        } else if (m === 'solid') { g.solids.push({ ...r, base: n('from'), top: n('to') }); selection = `solids|${r.id}`; }
        else if (m === 'stair') { const axis = get('axis').value as 'x' | 'y'; g.stairs.push({ ...r, ...tiledStairRect(d.start, d.end, axis, n('stair-width'), n('stair-length')), from: n('from'), to: n('to'), axis, appearance:get('stair-appearance').value as 'stone'|'passage', tiled: true }); selection = `stairs|${r.id}`; }
        if (!validGeometry(g)) throw new Error('Quote non valide: per un rialzo la quota attiva deve superare la base.');
      });
    }, true);
  }
  function selectMapAt(p: Vec2): boolean {
    const g = host.document().geometry; if (!g) return false;
    const hit = (s: GeometryShape) => shapeVisible(s, visibility()) && p.x >= s.x && p.y >= s.y && p.x < s.x + s.width && p.y < s.y + s.height;
    const stair = g.stairs.find(hit);
    const surface = g.surfaces.filter(hit).sort((a, b) => b.elevation - a.elevation)[0];
    const solid = g.solids.find(s => !s.id.endsWith('-mass') && hit(s));
    const item = stair ?? surface ?? solid; if (!item) return false;
    set('owner', 'map'); selection = `${stair ? 'stairs' : surface ? 'surfaces' : 'solids'}|${item.id}`; needsPrepare = false;
    fill(); host.selectTool('elevation-select'); refresh(); host.schedule(); return true;
  }
  return {
    cancelGesture,
    selectShape(kind: GeometryKind, id: string) { cancelGesture(); set('owner','map'); selection=`${kind}|${id}`; needsPrepare=false; host.selectTool('elevation-select'); fill(); refresh(); host.schedule(); },
    refresh, elevation: () => n('active'), visibility, editsAsset: isAsset, selectMapAt,
    terrainElevation: () => { const value = root.querySelector<HTMLInputElement>('#terrain-elevation')!.value; return value === '' ? undefined : Number(value); },
    autoStair: () => root.querySelector<HTMLInputElement>('#terrain-auto-stair')!.checked,
    draw(ctx: CanvasRenderingContext2D, asset: boolean) {
      if (!host.tool().startsWith('elevation-') && !root.querySelector<HTMLInputElement>('#show-cells')?.checked) return;
      const o = asset ? host.asset() : host.document();
      if (o?.geometry) {
        const showCells = !!root.querySelector<HTMLInputElement>('#show-cells')?.checked;
        const geometry = { ...filterGeometry(o.geometry, visibility()) }, selectedId = selection.split('|')[1];
        if (!showCells) {
          geometry.surfaces = geometry.surfaces.filter(s => s.id === selectedId);
          geometry.solids = geometry.solids.filter(s => s.id === selectedId);
          geometry.stairs = geometry.stairs.filter(s => s.id === selectedId);
        }
        drawGeometryOverlay(ctx, geometry, n('active'), true, selectedId, showCells);
      }
      if (dragging && (dragging.target === assetCanvas) === asset) {
        const a = dragging.start, b = dragging.end;
        const r = mode() === 'stair' ? tiledStairRect(a, b, get('axis').value as 'x' | 'y', n('stair-width'), n('stair-length'))
          : { x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x)+.25, height: Math.abs(a.y-b.y)+.25 };
        ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = .06;
        ctx.strokeRect(r.x, r.y, r.width, r.height); ctx.restore();
      }
    },
  };
}
