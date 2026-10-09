import { compactWorldTiles } from '../../../shared/world-tiles';
import { mapDocument, newInterior, newDungeonInterior, setWarpReturn } from '../../../shared/warps';
import type { DungeonDefinition } from '../../../shared/dungeons';
import type { Vec2 } from '../../../shared/types';
import type { WorldDocument, WorldWarp } from '../../../shared/world-schema';

interface WarpEditorHost {
  project(): WorldDocument; mapId(): string; switchMap(id: string): void;
  change(action: () => void): void; tool(): string; selectTool(tool: string): void; center(p: Vec2): void;
  inspect(): void;
  catalog(): readonly DungeonDefinition[];
}
export function installWarpEditor(root: HTMLElement, host: WarpEditorHost) {
  const section = document.createElement('section');
  section.innerHTML = `<details id="maps-passages"><summary>Interni, dungeon e passaggi</summary><div class="map-controls"><label>Mappa da modificare<select id="surface-map"></select></label>
    <div class="fields"><label>Nome interno<input id="interior-name" value="Nuovo edificio" maxlength="160"></label>
    <label>Tipo<select id="interior-kind"><option value="building">Edificio</option><option value="dungeon">Dungeon</option></select></label>
    <label>PvP dell'interno<select id="interior-pvp"><option value="false">Disabilitato · zona sicura</option><option value="true">Abilitato · combattimento tra giocatori</option></select></label>
    <div class="pair"><label>Larghezza<input id="interior-width" type="number" min="4" max="512" value="24"></label><label>Altezza<input id="interior-height" type="number" min="4" max="512" value="18"></label></div></div>
    <button id="interior-create" class="wide">＋ Crea interno</button><button id="interior-update" class="wide">Aggiorna interno</button><button id="interior-delete" class="wide danger">Elimina interno e collegamenti</button>
    <label>Dungeon installato<select id="interior-dungeon"></select></label><button id="interior-from-dungeon" class="wide">＋ Crea interno da questo dungeon</button>
    <p class="hint">Il dungeon viene spostato in una mappa separata, con boss e incontri. Collega le porte con Posiziona passaggio. Le zone PvP specifiche prevalgono sulla regola dell'interno; i nemici restano attivi anche senza PvP.</p>
    <button id="warp-tool" class="wide">＋ Posiziona passaggio</button><p class="hint" id="warp-action-hint">Seleziona una porta azzurra o un arrivo dorato per modificarlo.</p><div id="warp-list" class="fields"></div></div></details>`;
  root.querySelector('main > aside')!.prepend(section);
  const inspector = document.createElement('section'); inspector.id = 'warp-inspector'; inspector.hidden = true;
  inspector.innerHTML = `<h2>Collegamento warp</h2><div class="fields"><label>Nome<input id="warp-name" maxlength="160"></label>
    <label>Mappa del primo lato<select id="warp-from"></select></label><div class="pair"><label>Porta X<input id="warp-x" type="number"></label><label>Porta Y<input id="warp-y" type="number"></label></div>
    <label>Destinazione<select id="warp-to"></select></label><div class="pair"><label>Arrivo X<input id="warp-arrival-x" type="number"></label><label>Arrivo Y<input id="warp-arrival-y" type="number"></label></div>
    <label>Attivazione<select id="warp-activation"><option value="walk">Attraversamento automatico</option><option value="interact">Interazione · F / pulsante</option></select></label>
    <label><input id="warp-one-way" type="checkbox"> Solo andata (nessun ritorno da questa porta)</label></div>
    <p class="hint" id="warp-current-side"></p><button id="warp-update" class="wide">Aggiorna passaggio</button>
    <button id="warp-return" class="wide">Apri altro lato</button><button id="warp-move" class="wide">Sposta passaggio</button><button id="warp-delete" class="wide danger">Elimina passaggio</button>
    <p class="hint">Il passaggio collega due porte e funziona in entrambe le direzioni, salvo Solo andata. Arrivi sulla porta; per attraversarla di nuovo devi allontanarti e rientrare. La croce indica lo spawn generale, separato dagli arrivi dei passaggi.</p>`;
  root.querySelector('.inspector')!.prepend(inspector);
  const el = (id: string) => document.getElementById(id) as HTMLInputElement;
  const value = (id: string) => el(id).value, num = (id: string) => Number(value(id));
  let selected = '', pickingArrival = false, pickingEntry = false;
  const warp = () => host.project().warps?.find(w => w.id === selected);
  const click = (id: string, action: () => void) => el(id).onclick = () => { try { action(); } catch (e) { document.getElementById('status')!.textContent = (e as Error).message; } };
  function refresh() {
    const project = host.project();
    const options = [['world', 'Open world'], ...(project.interiors ?? []).map(m => [m.id, m.name])];
    for (const id of ['surface-map', 'warp-from', 'warp-to']) {
      const select = el(id) as unknown as HTMLSelectElement, old = select.value;
      select.replaceChildren(...options.map(([id, name]) => new Option(name, id))); select.value = old;
    }
    el('surface-map').value = host.mapId();
    const interior = project.interiors?.find(m => m.id === host.mapId());
    const dungeonSelect = el('interior-dungeon') as unknown as HTMLSelectElement, oldDungeon = dungeonSelect.value;
    dungeonSelect.replaceChildren(...host.catalog().map(d => new Option(d.name, d.id)));
    if (host.catalog().some(d => d.id === oldDungeon)) dungeonSelect.value = oldDungeon;
    (el('interior-from-dungeon') as unknown as HTMLButtonElement).disabled = !host.catalog().length;
    (el('interior-update') as unknown as HTMLButtonElement).disabled = !interior;
    (el('interior-delete') as unknown as HTMLButtonElement).disabled = !interior;
    if (interior) { el('interior-name').value = interior.name; el('interior-width').value = String(interior.width); el('interior-height').value = String(interior.height);
      el('interior-kind').value = interior.kind ?? 'building'; el('interior-pvp').value = String(interior.pvp ?? false); }
    const w = warp(); inspector.hidden = !w;
    document.getElementById('warp-action-hint')!.textContent = pickingArrival || pickingEntry ? 'Clicca sulla nuova casella del passaggio nella mappa che stai guardando.'
      : 'Con Seleziona, clicca una porta azzurra o un arrivo dorato per modificarlo.';
    if (w) {
      for (const [id, v] of Object.entries({ 'warp-name': w.name, 'warp-from': w.from, 'warp-to': w.to, 'warp-x': w.entry.x,
        'warp-y': w.entry.y, 'warp-arrival-x': w.arrival.x, 'warp-arrival-y': w.arrival.y, 'warp-activation': w.activation })) el(id).value = String(v);
      el('warp-one-way').checked = !w.reverseId;
      document.getElementById('warp-current-side')!.textContent = `Lato visualizzato: ${options.find(([id]) => id === host.mapId())?.[1] ?? host.mapId()}`;
    }
    document.getElementById('warp-list')!.replaceChildren(...(project.warps ?? []).filter(w => w.from === host.mapId() || (w.to === host.mapId() && !w.reverseId)).map(w => {
      const local = w.from === host.mapId();
      const b = document.createElement('button'); b.textContent = `${local ? '' : 'Arrivo · '}${w.name} ${w.reverseId ? '↔' : '→'} ${options.find(([id]) => id === (local ? w.to : w.from))?.[1] ?? w.to}`;
      b.onclick = () => { selected = w.id; pickingArrival = pickingEntry = false; host.selectTool('select'); host.center(local ? w.entry : w.arrival); host.inspect(); refresh(); }; return b;
    }));
    root.querySelector('.map-note')!.textContent = interior ? `${interior.name} · ${interior.width} × ${interior.height} · ${interior.pvp ? 'PvP' : 'Senza PvP'}` : 'MONDO PROCEDURALE';
  }
  el('surface-map').onchange = () => { pickingArrival = pickingEntry = false; selected = ''; host.switchMap(value('surface-map')); };
  click('interior-create', () => {
    const id = `interior-${crypto.randomUUID()}`;
    host.change(() => {
      const m = newInterior(id, value('interior-name'), num('interior-width'), num('interior-height'), host.project().seed);
      m.pvp = value('interior-pvp') === 'true'; m.kind = value('interior-kind') as 'building' | 'dungeon';
      m.document = compactWorldTiles(m.document); (host.project().interiors ??= []).push(m);
    });
    if (host.project().interiors?.some(m => m.id === id)) host.switchMap(id);
  });
  click('interior-from-dungeon', () => {
    const dungeon = host.catalog().find(d => d.id === value('interior-dungeon')); if (!dungeon) return;
    if (host.project().interiors?.some(m => m.document.dungeons.some(d => d.dungeonId === dungeon.id && d.enabled !== false)))
      throw new Error('Questo dungeon è già assegnato a un interno. Seleziona quella mappa per modificarlo.');
    const id = `interior-${crypto.randomUUID()}`;
    host.change(() => { const map = newDungeonInterior(id, dungeon, value('interior-pvp') === 'true', host.project().seed);
      map.document = compactWorldTiles(map.document); (host.project().interiors ??= []).push(map); });
    if (host.project().interiors?.some(m => m.id === id)) host.switchMap(id);
  });
  click('interior-update', () => host.change(() => {
    const m = host.project().interiors?.find(m => m.id === host.mapId()); if (!m) return;
    m.name = value('interior-name'); m.width = num('interior-width'); m.height = num('interior-height');
    m.pvp = value('interior-pvp') === 'true'; m.kind = value('interior-kind') as 'building' | 'dungeon';
  }));
  click('interior-delete', () => {
    const id = host.mapId(); if (id === 'world') return;
    host.change(() => { host.project().interiors = host.project().interiors?.filter(m => m.id !== id);
      host.project().warps = host.project().warps?.filter(w => w.from !== id && w.to !== id); selected = ''; });
    host.switchMap('world');
  });
  click('warp-tool', () => { pickingArrival = pickingEntry = false; host.selectTool('warp'); refresh(); });
  function saveSelected(): void {
    const w = warp(); if (!w) return;
    const next = { name: value('warp-name'), from: value('warp-from'), to: value('warp-to'), entry: { x: num('warp-x'), y: num('warp-y') },
      arrival: { x: num('warp-arrival-x'), y: num('warp-arrival-y') }, activation: value('warp-activation') as WorldWarp['activation'] };
    // Changing maps must not reuse a coordinate belonging to the previous destination.
    if (next.to !== w.to && next.arrival.x === w.arrival.x && next.arrival.y === w.arrival.y) next.arrival = { ...mapDocument(host.project(), next.to).spawn };
    if (next.from !== w.from && next.entry.x === w.entry.x && next.entry.y === w.entry.y) next.entry = { ...mapDocument(host.project(), next.from).spawn };
    const returnEnabled = !el('warp-one-way').checked;
    if (Object.entries(next).every(([key, v]) => JSON.stringify(w[key as keyof WorldWarp]) === JSON.stringify(v)) && !!w.reverseId === returnEnabled) return;
    host.change(() => { const current = warp(); if (!current) return; Object.assign(current, next);
      setWarpReturn(host.project(), current, returnEnabled, `warp-${crypto.randomUUID()}`); });
  }
  click('warp-update', saveSelected);
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
    const destination = host.mapId() === w.to ? w.from : w.to;
    const point = destination === w.from ? w.entry : w.arrival;
    const reverse = host.project().warps?.find(other => other.id === w.reverseId && other.from === destination);
    pickingArrival = pickingEntry = false;
    if (reverse) selected = reverse.id;
    host.switchMap(destination); host.center(point); host.selectTool('select'); host.inspect(); refresh();
  });
  click('warp-delete', () => host.change(() => { const reverseId = warp()?.reverseId; host.project().warps = host.project().warps?.filter(w => w.id !== selected && w.id !== reverseId); selected = ''; }));
  function place(p: Vec2): boolean {
    if (host.tool() !== 'warp') {
      if (host.tool() === 'select') {
        const w = host.project().warps?.find(w => w.from === host.mapId() && w.entry.x === p.x && w.entry.y === p.y)
          ?? host.project().warps?.find(w => w.to === host.mapId() && w.arrival.x === p.x && w.arrival.y === p.y);
        if (w) { selected = w.id; host.inspect(); refresh(); return true; }
      }
      selected = ''; inspector.hidden = true;
      return false;
    }
    if ((pickingArrival || pickingEntry) && warp()) {
      host.change(() => { const w = warp()!; if (pickingEntry) w.entry = p; else w.arrival = p;
        if (w.reverseId) setWarpReturn(host.project(), w, true, `warp-${crypto.randomUUID()}`); });
      pickingArrival = pickingEntry = false; host.selectTool('select'); refresh(); return true;
    }
    const project = host.project(), destination = host.mapId() === 'world' ? project.interiors?.[0]?.id : 'world';
    if (!destination) throw new Error('Crea prima una mappa interna.');
    selected = `warp-${crypto.randomUUID()}`;
    host.change(() => { (host.project().warps ??= []).push({ id: selected, name: 'Nuovo passaggio', from: host.mapId(), to: destination,
      entry: p, arrival: { ...mapDocument(host.project(), destination).spawn }, activation: 'walk' });
      setWarpReturn(host.project(), warp()!, true, `warp-${crypto.randomUUID()}`); });
    host.selectTool('select'); host.inspect(); refresh(); return true;
  }
  function draw(canvas: HTMLCanvasElement, view: { x: number; y: number; scale: number }) {
    const ctx = canvas.getContext('2d')!, dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width), s = view.scale;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, view.x * dpr, view.y * dpr);
    for (const w of host.project().warps ?? []) {
      if (w.from === host.mapId()) {
        ctx.fillStyle = w.id === selected ? '#f5cf6d99' : '#82bce777'; ctx.strokeStyle = '#a5d8fa'; ctx.lineWidth = 2;
        ctx.fillRect(w.entry.x * s, w.entry.y * s, s, s); ctx.strokeRect(w.entry.x * s, w.entry.y * s, s, s);
        ctx.fillStyle = '#fff'; ctx.font = '12px system-ui'; ctx.fillText(w.name, w.entry.x * s, w.entry.y * s - 4);
      }
      if (w.to === host.mapId() && !w.reverseId) { ctx.strokeStyle = '#e8cf80'; ctx.lineWidth = w.id === selected ? 3 : 2; ctx.beginPath(); ctx.arc((w.arrival.x + .5) * s, (w.arrival.y + .5) * s, Math.max(3, s * .2), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#e8cf80'; ctx.font = '12px system-ui'; ctx.fillText(`Arrivo · ${w.name}`, w.arrival.x * s, w.arrival.y * s - 4); }
    }
    ctx.restore();
  }
  return { refresh, place, draw, hasSelection: () => !!warp(), clearSelection: () => { selected = ''; pickingArrival = pickingEntry = false; inspector.hidden = true; } };
}
