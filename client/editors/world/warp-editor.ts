import { compactWorldTiles } from '../../../shared/world-tiles';
import { mapDocument, newInterior, newDungeonInterior, removeInterior, setWarpReturn } from '../../../shared/warps';
import type { DungeonDefinition } from '../../../shared/dungeons';
import type { Vec2 } from '../../../shared/types';
import type { WorldDocument, WorldWarp } from '../../../shared/world-schema';
import { floorVisible, type ElevationVisibility } from './elevation-visibility';
import { WorldInspectorDrafts } from './world-inspector-drafts';

interface WarpEditorHost {
  elevation?(): number;
  isElevationVisible?(elevation: number): boolean;
  rooms?(mapId: string): { id: string; name: string; tiles: Vec2[] }[];
  project(): WorldDocument; mapId(): string; switchMap(id: string): void;
  change(action: () => void): void; tool(): string; selectTool(tool: string): void; center(p: Vec2): void;
  inspect(): void;
  catalog(): readonly DungeonDefinition[];
}
export function installWarpEditor(root: HTMLElement, host: WarpEditorHost) {
  const section = document.createElement('section');
  section.innerHTML = `<label>Mappa da modificare<select id="surface-map"></select></label><button id="edit-map-dungeon" class="wide" hidden>Modifica il dungeon di questa mappa ↗</button>
    <details id="maps-passages"><summary>Crea o modifica un interno</summary><div class="map-controls">
    <p class="hint">Un interno è una mappa separata: casa, stanza, grotta o dungeon. Arredalo con Costruisci e gestisci qui i suoi passaggi.</p>
    <label>Nome interno<input id="interior-name" value="Nuovo edificio" maxlength="160"></label>
    <label>Tipo<select id="interior-kind"><option value="building">Casa / stanza</option><option value="dungeon">Dungeon / grotta</option></select></label>
    <label>PvP dell'interno<select id="interior-pvp"><option value="false">Disabilitato · zona sicura</option><option value="true">Abilitato · combattimento tra giocatori</option></select></label>
    <div class="pair"><label>Larghezza<input id="interior-width" type="number" min="4" max="512" value="24"></label><label>Altezza<input id="interior-height" type="number" min="4" max="512" value="18"></label></div>
    <button id="interior-create" class="wide">＋ Crea interno</button><button id="interior-update" class="wide">Aggiorna interno</button><button id="interior-delete" class="wide danger">Elimina interno e collegamenti</button></div></details>`;
  const selectorLabel = section.querySelector('#surface-map')!.closest('label')!;
  root.querySelector('#map-controls-panel > summary')!.after(selectorLabel);
  const mapPvp = document.createElement('div'); mapPvp.id = 'map-pvp-controls'; mapPvp.hidden = true;
  mapPvp.innerHTML = `<label>PvP della mappa visualizzata<select id="map-pvp"><option value="false">Disabilitato · zona sicura</option><option value="true">Abilitato · combattimento tra giocatori</option></select></label><p class="hint">Poi premi Applica al gioco. Le zone e i dungeon con una regola PvP propria hanno precedenza.</p>`;
  const deleteMap = document.createElement('button'); deleteMap.id = 'map-delete'; deleteMap.className = 'wide danger'; deleteMap.textContent = 'Elimina completamente questa mappa interna';
  const deleteHint = document.createElement('p'); deleteHint.id = 'map-delete-hint'; deleteHint.className = 'hint';
  selectorLabel.after(mapPvp, deleteMap, deleteHint);
  root.querySelector('#areas-controls-panel')!.append(section);
  const chooser = document.createElement('div'); chooser.className = 'map-controls';
  chooser.innerHTML = `<label>Tipo di area<select id="area-kind"><option value="building">Interni</option><option value="dungeon">Dungeon</option></select></label>
    <label>Area selezionata<select id="area-map"></select></label>`;
  root.querySelector('#areas-controls-panel > summary')!.after(chooser);
  const newArea = document.createElement('button'); newArea.className = 'wide'; newArea.id = 'new-area'; newArea.textContent = '＋ Nuovo interno';
  section.querySelector('#maps-passages .map-controls')!.prepend(newArea);
  const dungeonMap = document.createElement('div'); dungeonMap.className = 'map-controls';
  dungeonMap.innerHTML = `<h3>Dungeon in una mappa separata</h3><label>Dungeon da usare<select id="interior-dungeon"></select></label><button id="interior-from-dungeon" class="wide">＋ Crea interno da questo dungeon</button><p class="hint">Copia terreno, boss e incontri in una mappa interna. Seleziona il dungeon qui sopra per gestire i suoi passaggi.</p>`;
  root.querySelector('#dungeon-controls')!.append(dungeonMap);
  const connections = document.createElement('div'); connections.className = 'map-controls';
  connections.innerHTML = `<details><summary>Come aggiungere un passaggio</summary><ol class="warp-steps"><li>Premi A ↔ B oppure A → B e clicca il punto A.</li><li>Apri la mappa per B, anche la stessa mappa.</li><li>Clicca il punto B: i due ingressi sono collegati.</li></ol></details>
    <label>Mappa per il punto B<select id="warp-destination"></select></label>
    <div class="pair"><button id="warp-tool" title="Crea un passaggio con ritorno">＋ A ↔ B</button><button id="warp-oneway-tool" title="Crea un passaggio senza ritorno">＋ A → B</button></div><button id="warp-cancel" class="wide" hidden>Annulla posizionamento</button>
    <p class="hint" id="warp-action-hint"></p><p class="hint" id="warp-direction-hint"></p><h3 id="owner-passages-title">Passaggi dell’interno selezionato</h3><div id="warp-list" class="fields"></div>`;
  connections.prepend(connections.querySelector('#owner-passages-title')!, connections.querySelector('#warp-list')!);
  root.querySelector('#areas-controls-panel')!.append(connections);
  const prompt = document.createElement('div'); prompt.id = 'warp-map-prompt'; prompt.hidden = true;
  prompt.setAttribute('role', 'status'); root.querySelector('.viewport')!.append(prompt);
  const inspector = document.createElement('section'); inspector.id = 'warp-inspector'; inspector.hidden = true;
  inspector.innerHTML = `<h2>Collegamento warp</h2><div class="fields"><label>Nome<input id="warp-name" maxlength="160"></label>
    <label>Mappa del primo lato<select id="warp-from"></select></label><div class="pair"><label>Porta X<input id="warp-x" type="number"></label><label>Porta Y<input id="warp-y" type="number"></label></div>
    <label>Destinazione<select id="warp-to"></select></label><div class="pair"><label>Arrivo X<input id="warp-arrival-x" type="number"></label><label>Arrivo Y<input id="warp-arrival-y" type="number"></label></div>
    <div class="pair"><label>Quota ingresso<input id="warp-entry-elevation" type="number" min="-128" max="127" step="1" value="0"></label><label>Quota arrivo<input id="warp-arrival-elevation" type="number" min="-128" max="127" step="1" value="0"></label></div>
    <div class="pair"><label>Dimensione A<select id="warp-entry-size"><option value="1,1">1 × 1</option><option value="2,1">2 × 1</option><option value="1,2">1 × 2</option><option value="1,3">1 × 3</option><option value="3,1">3 × 1</option></select></label><label>Dimensione B<select id="warp-arrival-size"><option value="1,1">1 × 1</option><option value="2,1">2 × 1</option><option value="1,2">1 × 2</option><option value="1,3">1 × 3</option><option value="3,1">3 × 1</option></select></label></div><p class="hint">La casella posizionata × l�angolo in alto a sinistra. L’ingresso si estende a destra o verso il basso; il punto di arrivo resta su quella casella.</p>
    <label>Attivazione<select id="warp-activation"><option value="walk">Attraversamento automatico</option><option value="interact">Interazione · F / pulsante</option></select></label>
    <label><input id="warp-one-way" type="checkbox"> Solo andata (nessun ritorno da questa porta)</label></div>
    <p class="hint" id="warp-current-side"></p><button id="warp-update" class="wide">Aggiorna passaggio</button>
    <button id="warp-return" class="wide">Apri altro lato</button><button id="warp-move" class="wide">Sposta passaggio</button><button id="warp-delete" class="wide danger">Elimina passaggio</button>
    <p class="hint">Il passaggio collega due porte e funziona in entrambe le direzioni, salvo Solo andata. Arrivi sulla porta; per attraversarla di nuovo devi allontanarti e rientrare. La croce indica lo spawn generale, separato dagli arrivi dei passaggi.</p>`;
  root.querySelector('.inspector')!.prepend(inspector);
  const el = (id: string) => document.getElementById(id) as HTMLInputElement;
  const value = (id: string) => el(id).value, num = (id: string) => Number(value(id));
  let selected = '', pickingArrival = false, pickingEntry = false;
  let newWarpDirection: 'both' | 'one-way' = 'both';
  let pending: { from: string; to: string; entry: Vec2; entryElevation: number; owner: string; bidirectional: boolean } | undefined;
  let ownerId = '', editingNew = false, preferredDestination = '';
  const formDrafts = new WorldInspectorDrafts(root, () => `warp:${selected}`, ['warp-inspector']);
  const owner = () => host.project().interiors?.find(m => m.id === ownerId);
  const displayName = (w: WorldWarp) => {
    const name = owner() && (w.from === ownerId || w.to === ownerId) ? owner()!.name : host.project().interiors?.find(m => m.id === w.to)?.name ?? host.project().interiors?.find(m => m.id === w.from)?.name;
    return name && !w.name.includes(name) ? `${name} · ${w.name}` : w.name;
  };
  const warp = () => host.project().warps?.find(w => w.id === selected);
  const roomChooser = document.createElement('label'); roomChooser.id = 'warp-room-chooser'; roomChooser.innerHTML = 'Passaggi interni al dungeon<select id="warp-room"><option value="">Spazio comune</option></select><span class="hint">Seleziona una stanza per centrarla. A e B si posizionano cliccando; puoi scegliere un’altra stanza mentre aspetti B.</span>';
  root.querySelector('#warp-destination')!.closest('label')!.after(roomChooser);
  el('warp-room').onchange = () => {
    const rooms = host.rooms?.(host.mapId()) ?? [], room = rooms.find(r => r.id === value('warp-room'));
    if (room?.tiles.length) host.center(room.tiles[0]); else host.center(mapDocument(host.project(), host.mapId()).spawn);
    preferredDestination = host.mapId(); if (pending) pending.to = host.mapId(); refresh();
  };
  const click = (id: string, action: () => void) => el(id).onclick = () => { try { action(); } catch (e) { document.getElementById('status')!.textContent = (e as Error).message; } };
  function refresh() {
    const project = host.project();
    const rooms = host.rooms?.(host.mapId()) ?? [], selectedRoom = value('warp-room');
    el('warp-room-chooser').hidden = !rooms.length;
    (el('warp-room') as unknown as HTMLSelectElement).replaceChildren(new Option('Spazio comune', ''), ...rooms.map(r => new Option(r.name, r.id)));
    el('warp-room').value = selectedRoom;
    const options = [['world', 'Mondo'], ...(project.interiors ?? []).map(m => [m.id, m.name])];
    if (!owner() || (owner()?.kind ?? 'building') !== value('area-kind')) ownerId = project.interiors?.find(m => (m.kind ?? 'building') === value('area-kind'))?.id ?? '';
    const chooser = el('area-map') as unknown as HTMLSelectElement;
    const maps = (project.interiors ?? []).filter(m => (m.kind ?? 'building') === value('area-kind'));
    chooser.replaceChildren(new Option('Scegli un’area…', ''), ...maps.map(m => new Option(m.name, m.id)));
    chooser.value = maps.some(m => m.id === ownerId) ? ownerId : '';
    el('dungeon-resources').hidden = value('area-kind') !== 'dungeon';
    section.querySelector('#maps-passages > summary')!.textContent = value('area-kind') === 'dungeon' ? 'Proprietà della mappa dungeon' : 'Crea / modifica interno';
    el('interior-kind').closest('label')!.hidden = true;
    el('new-area').textContent = value('area-kind') === 'dungeon' ? '＋ Nuovo dungeon vuoto' : '＋ Nuovo interno';
    document.getElementById('owner-passages-title')!.textContent = owner() ? `Passaggi · ${owner()!.name}` : 'Crea o seleziona un interno';
    for (const id of ['surface-map', 'warp-from', 'warp-to']) {
      const select = el(id) as unknown as HTMLSelectElement, old = select.value;
      select.replaceChildren(...options.map(([id, name]) => new Option(name, id))); select.value = old;
    }
    el('surface-map').value = host.mapId();
    const destination = el('warp-destination') as unknown as HTMLSelectElement;
    destination.replaceChildren(...options.map(([id, name]) => new Option(name, id)));
    if (pending) destination.value = pending.to;
    else if (options.some(([id]) => id === preferredDestination)) destination.value = preferredDestination;
    else destination.value = host.mapId() === 'world' && owner() ? ownerId : 'world';
    destination.disabled = false;
    for (const [id, direction] of [['warp-tool', 'both'], ['warp-oneway-tool', 'one-way']]) {
      const button = el(id) as unknown as HTMLButtonElement; button.disabled = !!pending;
      button.setAttribute('aria-pressed', String(host.tool() === 'warp' && !pickingArrival && !pickingEntry && newWarpDirection === direction));
    }
    el('warp-direction-hint').textContent = newWarpDirection === 'one-way' ? 'Solo andata: da A arrivi a B, senza ritorno. Con Seleziona trascina A o B.' : 'Andata e ritorno: A ↔ B. Con Seleziona trascina gli ingressi. Cancella elimina il collegamento.';
    root.querySelector('#current-map')!.textContent = host.mapId() === 'world' ? 'Mondo' : `Interno · ${options.find(([id]) => id === host.mapId())?.[1]}`;

    const visibleInterior = project.interiors?.find(m => m.id === host.mapId());
    mapPvp.hidden = !visibleInterior;
    el('map-pvp').value = String(visibleInterior?.pvp ?? false);
    deleteMap.disabled = !visibleInterior;
    deleteHint.textContent = visibleInterior ? `Elimina “${visibleInterior.name}”, tutti i contenuti e i collegamenti da ogni mappa. Poi premi Applica al gioco.` : 'Il mondo principale non può essere eliminato. Seleziona una mappa interna.';
    const interior = editingNew ? undefined : owner();
    el('edit-map-dungeon').hidden = !interior?.document.dungeons.some(d => d.enabled !== false && host.catalog().some(item => item.id === d.dungeonId));
    const dungeonSelect = el('interior-dungeon') as unknown as HTMLSelectElement, oldDungeon = dungeonSelect.value;
    dungeonSelect.replaceChildren(...host.catalog().map(d => new Option(d.name, d.id)));
    if (host.catalog().some(d => d.id === oldDungeon)) dungeonSelect.value = oldDungeon;
    (el('interior-from-dungeon') as unknown as HTMLButtonElement).disabled = !host.catalog().length;
    (el('interior-update') as unknown as HTMLButtonElement).disabled = !interior;
    (el('interior-delete') as unknown as HTMLButtonElement).disabled = !interior;
    if (interior) { el('interior-name').value = interior.name; el('interior-width').value = String(interior.width); el('interior-height').value = String(interior.height);
      el('interior-kind').value = interior.kind ?? 'building'; el('interior-pvp').value = String(interior.pvp ?? false); }
    const w = warp(); inspector.hidden = !w;
    const instruction = pending ? 'B · Clicca il punto B. Puoi cambiare mappa prima di posizionarlo.'
      : pickingArrival || pickingEntry ? 'Clicca la nuova posizione del lato visualizzato.'
      : host.tool() === 'warp' ? 'A · Clicca il punto A sulla mappa visualizzata.'
      : 'A ↔ B: andata e ritorno. A → B: solo andata. Scegli un pulsante e clicca A.';
    document.getElementById('warp-action-hint')!.textContent = instruction;
    prompt.textContent = instruction; prompt.hidden = host.tool() !== 'warp';
    el('warp-cancel').hidden = host.tool() !== 'warp';
    if (w) {
      for (const [id, v] of Object.entries({ 'warp-name': displayName(w), 'warp-from': w.from, 'warp-to': w.to, 'warp-x': w.entry.x,
        'warp-y': w.entry.y, 'warp-entry-elevation': w.entryElevation ?? 0, 'warp-arrival-elevation': w.arrivalElevation ?? 0, 'warp-arrival-x': w.arrival.x, 'warp-arrival-y': w.arrival.y, 'warp-entry-size': `${w.entrySize?.x ?? 1},${w.entrySize?.y ?? 1}`, 'warp-arrival-size': `${w.arrivalSize?.x ?? 1},${w.arrivalSize?.y ?? 1}`, 'warp-activation': w.activation })) el(id).value = String(v);
      el('warp-one-way').checked = !w.reverseId;
      document.getElementById('warp-current-side')!.textContent = `Lato visualizzato: ${options.find(([id]) => id === host.mapId())?.[1] ?? host.mapId()}`;
    }
    const seen = new Set<string>();
    document.getElementById('warp-list')!.replaceChildren(...(project.warps ?? []).filter(w => {
      if (((w.from !== ownerId && w.to !== ownerId) && !(host.mapId() === 'world' && w.from === 'world' && w.to === 'world')) || seen.has(w.id)) return false;
      seen.add(w.id); if (w.reverseId) seen.add(w.reverseId); return true;
    }).map(link => {
      const w = host.project().warps?.find(other => other.id === link.reverseId && other.from === host.mapId()) ?? link;
      const b = document.createElement('button');
      b.dataset.roomPassage = String(w.from === w.to && !!host.rooms?.(w.from).length);
      b.textContent = `${displayName(w)} · ${options.find(([id]) => id === w.from)?.[1]} ${w.reverseId ? '↔' : '→'} ${options.find(([id]) => id === w.to)?.[1]}`;
      b.onclick = () => {
        pending = undefined; selected = w.id; pickingArrival = pickingEntry = false; host.selectTool('select');
        const map = host.mapId() === w.from || host.mapId() === w.to ? host.mapId() : ownerId;
        host.switchMap(map); host.center(map === w.from ? w.entry : w.arrival); host.inspect(); refresh();
      }; return b;
    }));
    if (rooms.length) {
      const list = document.getElementById('warp-list')!, buttons = [...list.querySelectorAll<HTMLButtonElement>('button')]; list.replaceChildren();
      for (const [title, internal] of [['Passaggi fra stanze', true], ['Collegamenti con altre mappe', false]] as const) {
        const matches = buttons.filter(button => button.dataset.roomPassage === String(internal)); if (!matches.length) continue;
        const group = document.createElement('details'); group.open = true; const summary = document.createElement('summary'); summary.textContent = title;
        const body = document.createElement('div'); body.className = 'fields'; body.append(...matches); group.append(summary, body); list.append(group);
      }
    }
    root.querySelector('.map-note')!.textContent = visibleInterior ? `${visibleInterior.name} · ${visibleInterior.width} × ${visibleInterior.height} · ${visibleInterior.pvp ? 'PvP' : 'Senza PvP'}` : 'MONDO PROCEDURALE';
    formDrafts.restore();
  }
  function openMap(id: string): void {
    if (pending) {
      pending.to = id; host.switchMap(id); host.selectTool('warp'); refresh(); return;
    }
    preferredDestination = ''; host.selectTool('select'); pickingArrival = pickingEntry = false; selected = ''; editingNew = false;
    if (id !== 'world') { ownerId = id; el('area-kind').value = owner()?.kind ?? 'building'; }
    host.switchMap(id);
  }
  el('surface-map').onchange = () => openMap(value('surface-map'));
  el('map-pvp').onchange = () => {
    const mapId = host.mapId(), enabled = value('map-pvp') === 'true';
    if (mapId === 'world') return;
    host.change(() => { const map = host.project().interiors?.find(m => m.id === mapId); if (map) map.pvp = enabled; });
  };
  el('warp-destination').onchange = () => { preferredDestination = value('warp-destination'); if (pending) openMap(value('warp-destination')); };
  el('area-kind').onchange = () => {
    const first = host.project().interiors?.find(m => (m.kind ?? 'building') === value('area-kind'));
    ownerId = first?.id ?? ''; editingNew = false; preferredDestination = ''; if (first) openMap(first.id); else refresh();
  };
  el('area-map').onchange = () => { if (value('area-map')) { ownerId = value('area-map'); openMap(ownerId); } };
  click('new-area', () => {
    editingNew = true;
    el('interior-name').value = value('area-kind') === 'dungeon' ? 'Nuovo dungeon' : 'Nuovo interno';
    el('interior-kind').value = value('area-kind');
    (el('maps-passages') as unknown as HTMLDetailsElement).open = true; el('interior-name').focus();
  });
  click('interior-create', () => {
    const id = `interior-${crypto.randomUUID()}`;
    host.change(() => {
      const m = newInterior(id, value('interior-name'), num('interior-width'), num('interior-height'), host.project().seed);
      m.pvp = value('interior-pvp') === 'true'; m.kind = value('interior-kind') as 'building' | 'dungeon';
      m.document = compactWorldTiles(m.document); (host.project().interiors ??= []).push(m); ownerId = id; editingNew = false; el('area-kind').value = m.kind ?? 'building';
    });
    if (host.project().interiors?.some(m => m.id === id)) { ownerId = id; host.switchMap(id); };
  });
  click('interior-from-dungeon', () => {
    const dungeon = host.catalog().find(d => d.id === value('interior-dungeon')); if (!dungeon) return;
    if (host.project().interiors?.some(m => m.document.dungeons.some(d => d.dungeonId === dungeon.id && d.enabled !== false)))
      throw new Error('Questo dungeon è già assegnato a un interno. Seleziona quella mappa per modificarlo.');
    const id = `interior-${crypto.randomUUID()}`;
    host.change(() => { ownerId = id; editingNew = false; el('area-kind').value = 'dungeon'; const map = newDungeonInterior(id, dungeon, value('interior-pvp') === 'true', host.project().seed);
      map.document = compactWorldTiles(map.document); (host.project().interiors ??= []).push(map); });
    if (host.project().interiors?.some(m => m.id === id)) { ownerId = id; host.switchMap(id); };
  });
  click('interior-update', () => host.change(() => {
    const m = owner(); if (!m) return;
    const previousName = m.name;
    m.name = value('interior-name'); m.width = num('interior-width'); m.height = num('interior-height');
    m.pvp = value('interior-pvp') === 'true'; m.kind = value('interior-kind') as 'building' | 'dungeon';
    for (const w of host.project().warps ?? []) if (w.from === m.id || w.to === m.id) w.name = (w.name.includes(previousName) ? w.name.replace(previousName, m.name) : `${m.name} · ${w.name}`).slice(0, 160);
  }));
  function deleteInterior(id: string): void {
    const interior = host.project().interiors?.find(m => m.id === id); if (!interior) return;
    const links = (host.project().warps ?? []).filter(w => w.from === id || w.to === id).length;
    if (!confirm(`Eliminare completamente “${interior.name}”? Saranno rimossi terreno, oggetti, NPC, zone, dungeon e tutti i ${links} collegamenti da e verso questa mappa. I dungeon contenuti non ricompariranno nel mondo. Puoi annullare con Undo. Premi Applica al gioco per salvare.`)) return;
    host.change(() => removeInterior(host.project(), id));
    if (host.project().interiors?.some(m => m.id === id)) return;
    pending = undefined; preferredDestination = ''; selected = ''; ownerId = ''; editingNew = false;
    pickingArrival = pickingEntry = false; formDrafts.clear(); host.selectTool('select');
    if (host.mapId() === id || !host.project().interiors?.some(m => m.id === host.mapId())) host.switchMap('world');
    host.inspect(); refresh();
    document.getElementById('status')!.textContent = `Mappa “${interior.name}” e collegamenti eliminati dalla bozza. Premi Applica al gioco per salvare.`;
  }
  click('interior-delete', () => deleteInterior(ownerId));
  click('map-delete', () => deleteInterior(host.mapId()));
  function startConnection(direction: 'both' | 'one-way'): void { newWarpDirection = direction; pending = undefined; selected = ''; pickingArrival = pickingEntry = false; host.selectTool('warp'); host.inspect(); refresh(); }
  click('warp-tool', () => startConnection('both'));
  click('warp-oneway-tool', () => startConnection('one-way'));
  click('warp-cancel', () => { const from = pending?.from; pending = undefined; pickingArrival = pickingEntry = false; host.selectTool('select'); if (from) host.switchMap(from); host.inspect(); refresh(); });
  function saveSelected(): void {
    const w = warp(); if (!w) return;
    const size=(id:string)=>{const [x,y]=value(id).split(',').map(Number);return {x,y};};
    const next = { entryElevation:num('warp-entry-elevation'), arrivalElevation:num('warp-arrival-elevation'), entrySize:size('warp-entry-size'), arrivalSize:size('warp-arrival-size'), name: displayName({ ...w, name: value('warp-name') }).slice(0, 160), from: value('warp-from'), to: value('warp-to'), entry: { x: num('warp-x'), y: num('warp-y') },
      arrival: { x: num('warp-arrival-x'), y: num('warp-arrival-y') }, activation: value('warp-activation') as WorldWarp['activation'] };
    // Changing maps must not reuse a coordinate belonging to the previous destination.
    if (next.to !== w.to && next.arrival.x === w.arrival.x && next.arrival.y === w.arrival.y) next.arrival = { ...mapDocument(host.project(), next.to).spawn };
    if (next.from !== w.from && next.entry.x === w.entry.x && next.entry.y === w.entry.y) next.entry = { ...mapDocument(host.project(), next.from).spawn };
    const returnEnabled = !el('warp-one-way').checked;
    if (Object.entries(next).every(([key, v]) => JSON.stringify(w[key as keyof WorldWarp]) === JSON.stringify(v)) && !!w.reverseId === returnEnabled) return;
    host.change(() => { const current = warp(); if (!current) return; Object.assign(current, next);
      setWarpReturn(host.project(), current, returnEnabled, `warp-${crypto.randomUUID()}`); });
    formDrafts.accept('warp-inspector'); formDrafts.restore();
  }
  click('warp-update', saveSelected);
  el('warp-entry-size').onchange = saveSelected;
  el('warp-arrival-size').onchange = saveSelected;
  el('warp-entry-elevation').onchange = saveSelected;
  el('warp-arrival-elevation').onchange = saveSelected;
  el('warp-one-way').onchange = saveSelected;
  el('warp-to').onchange = saveSelected;
  el('warp-from').onchange = saveSelected;
  click('warp-move', () => {
    saveSelected(); const w = warp(); if (!w) return;
    if (host.mapId() !== w.from && host.mapId() !== w.to) throw new Error('Apri uno dei lati del passaggio prima di spostarlo.');
    pickingEntry = host.mapId() === w.from; pickingArrival = !pickingEntry;
    host.selectTool('warp'); host.center(pickingEntry ? w.entry : w.arrival); refresh();
  });
  click('warp-return', () => {
    saveSelected(); const w = warp(); if (!w) return;
    const destination = host.mapId() === w.to && w.from !== w.to ? w.from : w.to;
    const point = w.from === w.to || destination === w.to ? w.arrival : w.entry;
    const reverse = host.project().warps?.find(other => other.id === w.reverseId && other.from === destination);
    pickingArrival = pickingEntry = false;
    if (reverse) selected = reverse.id;
    host.switchMap(destination); host.center(point); host.selectTool('select'); host.inspect(); refresh();
  });
  click('warp-delete', () => host.change(() => { const reverseId = warp()?.reverseId; host.project().warps = host.project().warps?.filter(w => w.id !== selected && w.id !== reverseId); selected = ''; }));
  function dragTarget(p: Vec2): { id: string; side: 'entry' | 'arrival'; x: number; y: number } | undefined {
    const w = warp(); if (!w) return;
    if ((host.isElevationVisible?.(w.entryElevation ?? 0) ?? true) && w.from === host.mapId() && p.x>=w.entry.x && p.y>=w.entry.y && p.x<w.entry.x+(w.entrySize?.x??1) && p.y<w.entry.y+(w.entrySize?.y??1)) return { id: w.id, side: 'entry', ...w.entry };
    if ((host.isElevationVisible?.(w.arrivalElevation ?? 0) ?? true) && w.to === host.mapId() && p.x>=w.arrival.x && p.y>=w.arrival.y && p.x<w.arrival.x+(w.arrivalSize?.x??1) && p.y<w.arrival.y+(w.arrivalSize?.y??1)) return { id: w.id, side: 'arrival', ...w.arrival };
  }
  function moveEndpoint(endpoint: { id: string; side: 'entry' | 'arrival' }, p: Vec2): void {
    const w = host.project().warps?.find(item => item.id === endpoint.id); if (!w) return;
    const bounds = mapDocument(host.project(), host.mapId()).interiorBounds;
    const point = { x: Math.max(bounds ? 0 : -10_000_000, Math.min(bounds ? bounds.width - 1 : 10_000_000, p.x)),
      y: Math.max(bounds ? 0 : -10_000_000, Math.min(bounds ? bounds.height - 1 : 10_000_000, p.y)) };
    w[endpoint.side] = point;
    if (w.reverseId) setWarpReturn(host.project(), w, true, `warp-${crypto.randomUUID()}`);
  }
  function place(p: Vec2): boolean {
    const hit = (w: WorldWarp, side: 'entry' | 'arrival') => {
      const point = w[side], size = (side === 'entry' ? w.entrySize : w.arrivalSize) ?? { x: 1, y: 1 };
      const elevation = (side === 'entry' ? w.entryElevation : w.arrivalElevation) ?? 0;
      return (side === 'entry' ? w.from : w.to) === host.mapId() && elevation === (host.elevation?.() ?? elevation) && (host.isElevationVisible?.(elevation) ?? true)
        && p.x >= point.x && p.y >= point.y && p.x < point.x + size.x && p.y < point.y + size.y;
    };
    if (host.tool() === 'erase') {
      const w = host.project().warps?.find(w => hit(w, 'entry') || hit(w, 'arrival'));
      if (w) { host.change(() => { host.project().warps = host.project().warps?.filter(item => item.id !== w.id && item.id !== w.reverseId); selected = ''; }); host.inspect(); return true; }
    }
    if (host.tool() !== 'warp') {
      if (host.tool() === 'select') {
        const w = host.project().warps?.find(w => hit(w, 'entry')) ?? host.project().warps?.find(w => hit(w, 'arrival'));
        if (w) { editingNew = false; ownerId = host.mapId() !== 'world' ? host.mapId() : w.to !== 'world' ? w.to : w.from; if (owner()) el('area-kind').value = owner()?.kind ?? 'building'; selected = w.id; host.inspect(); refresh(); return true; }
      }
      selected = ''; inspector.hidden = true;
      return false;
    }
    if ((pickingArrival || pickingEntry) && warp()) {
      host.change(() => { const w = warp()!; if (pickingEntry) w.entry = p; else w.arrival = p;
        if (w.reverseId) setWarpReturn(host.project(), w, true, `warp-${crypto.randomUUID()}`); });
      pickingArrival = pickingEntry = false; host.selectTool('select'); refresh(); return true;
    }
    if (!pending) {
      const destination = value('warp-destination');
      if (!destination) throw new Error('Scegli la mappa per B.');
      pending = { from: host.mapId(), to: destination, entry: { ...p }, entryElevation: host.elevation?.() ?? 0, owner: host.mapId() !== 'world' ? host.mapId() : destination !== 'world' ? destination : 'world', bidirectional: newWarpDirection !== 'one-way' };
      if (destination !== host.mapId()) host.switchMap(destination); host.selectTool('warp'); refresh(); return true;
    }
    if (host.mapId() === pending.from && p.x === pending.entry.x && p.y === pending.entry.y) throw new Error('Scegli per B un punto diverso da A.');
    pending.to = host.mapId();
    if (pending.from === 'world') pending.owner = pending.to;
    const connection = pending;
    selected = `warp-${crypto.randomUUID()}`;
    host.change(() => {
      (host.project().warps ??= []).push({ id: selected, name: `${host.project().interiors?.find(m => m.id === connection.owner)?.name ?? 'Mondo'} · Passaggio ${(host.project().warps ?? []).filter(w => w.from === connection.owner).length + 1}`.slice(0, 160), from: connection.from, to: connection.to,
        entry: connection.entry, arrival: { ...p }, entryElevation: connection.entryElevation, arrivalElevation: host.elevation?.() ?? 0, activation: 'walk' });
      if (connection.bidirectional) setWarpReturn(host.project(), warp()!, true, `warp-${crypto.randomUUID()}`);
      const roomAt = (id: string, point: Vec2) => host.rooms?.(id).find(room => room.tiles.some(tile => tile.x === point.x && tile.y === point.y));
      if (connection.from === connection.to && (roomAt(connection.from, connection.entry) || roomAt(connection.to, p))) {
        const w = warp()!; w.name = `${roomAt(connection.from, connection.entry)?.name ?? 'Spazio comune'} → ${roomAt(connection.to, p)?.name ?? 'Spazio comune'}`.slice(0,160);
        if (w.reverseId) setWarpReturn(host.project(), w, true, `warp-${crypto.randomUUID()}`);
      }
    });
    pending = undefined; host.selectTool('select'); host.switchMap(connection.from); host.center(connection.entry); host.inspect(); refresh(); return true;
  }

  function draw(canvas: HTMLCanvasElement, view: { x: number; y: number; scale: number }, visible?: ElevationVisibility) {
    const ctx = canvas.getContext('2d')!, dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width), s = view.scale;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, view.x * dpr, view.y * dpr);
    for (const w of host.project().warps ?? []) {
      if (w.from === host.mapId() && floorVisible(visible, w.entryElevation ?? 0)) {
        ctx.fillStyle = w.id === selected ? '#a770d799' : '#82bce777'; ctx.strokeStyle = w.id === selected ? '#c592f0' : '#a5d8fa'; ctx.lineWidth = 2;
        ctx.fillRect(w.entry.x * s, w.entry.y * s, s*(w.entrySize?.x??1), s*(w.entrySize?.y??1)); ctx.strokeRect(w.entry.x * s, w.entry.y * s, s*(w.entrySize?.x??1), s*(w.entrySize?.y??1));
        ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.fillText(`${w.id === selected ? 'Partenza · ' : ''}${displayName(w)}`, w.entry.x * s, w.entry.y * s - 4);
      }
      if (w.to === host.mapId() && !w.reverseId && floorVisible(visible, w.arrivalElevation ?? 0)) { ctx.strokeStyle = '#e8cf80'; ctx.lineWidth = w.id === selected ? 3 : 2; ctx.beginPath(); ctx.arc((w.arrival.x + .5) * s, (w.arrival.y + .5) * s, Math.max(3, s * .2), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#e8cf80'; ctx.font = '12px system-ui'; ctx.fillText(`Arrivo · ${displayName(w)}`, w.arrival.x * s, w.arrival.y * s - 4); }
    }
    if (pending?.from === host.mapId() && floorVisible(visible, 0)) {
      ctx.strokeStyle = '#c592f0'; ctx.fillStyle = '#a770d755'; ctx.lineWidth = 3;
      ctx.fillRect(pending.entry.x * s, pending.entry.y * s, s, s); ctx.strokeRect(pending.entry.x * s, pending.entry.y * s, s, s);
      ctx.fillStyle = '#e7c9ff'; ctx.font = '12px system-ui'; ctx.fillText('A · in attesa di B', pending.entry.x * s, pending.entry.y * s - 5);
    }
    const current = warp();
    if (current?.to === host.mapId() && floorVisible(visible, current.arrivalElevation ?? 0)) {
      ctx.strokeStyle = '#77ddf5'; ctx.lineWidth = 3;
      ctx.strokeRect(current.arrival.x * s, current.arrival.y * s, s, s);
      ctx.fillStyle = '#77ddf5'; ctx.font = '12px system-ui';
      ctx.fillText('Arrivo / ritorno', current.arrival.x * s, (current.arrival.y + 1) * s + 14);
    }
    if (current?.from === host.mapId() && current.to === host.mapId() && floorVisible(visible, current.entryElevation ?? 0) && floorVisible(visible, current.arrivalElevation ?? 0)) {
      ctx.strokeStyle = '#c592f0'; ctx.setLineDash([5, 5]); ctx.beginPath();
      ctx.moveTo((current.entry.x + .5) * s, (current.entry.y + .5) * s);
      ctx.lineTo((current.arrival.x + .5) * s, (current.arrival.y + .5) * s); ctx.stroke();
    }
    ctx.restore();
  }
  return { refresh, place, draw, dragTarget, moveEndpoint, hasSelection: () => !!warp(), isPlacing: () => !!pending, selectedId: () => selected,
    select: (id: string) => { selected = id; pending = undefined; host.selectTool('select'); host.inspect(); refresh(); },
    clearSelection: () => { pending = undefined; selected = ''; pickingArrival = pickingEntry = false; inspector.hidden = true; } };
}
