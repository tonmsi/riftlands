import { dungeonFloorGraph } from './dungeon-floor-graph';
import { dungeonRoomAt, dungeonRoomContains, dungeonRoomTiles, type DungeonRoom } from '../../../shared/dungeon-topology';
import { roomBrush, roomRectangle } from '../../../shared/dungeon-room-editing';
import { topologyPanel } from './dungeon-topology-panel';
import { setupDungeonLibrary } from './dungeon-library';
import './dungeon-maker.css';
import { WORLD_DOCUMENT } from '../../../shared/world-content';
import { newWorldDocument, parseWorldDocument, worldAssetVisual, type WorldAsset } from '../../../shared/world-schema';
import { loadWorldCheckpoint } from '../world/world-editor-storage';
import { WorldAssetCatalog } from '../world/world-asset-catalog';
import { WorldAssetArt } from '../../render/world-asset-art';
import { parseDungeonFile } from '../../../shared/dungeon-import';
import { BOSS_TEMPLATES as BOSS_DEFINITIONS, BOSS_TEMPLATE_BY_ID } from '../../../shared/boss-templates';
import { parseActorCatalog } from '../../../shared/actor-catalog';
import { DUNGEON_DEFINITIONS, flameBarrierFromTiles, inwardFlameAngle } from '../../../shared/dungeons';
import { NPC_DEFINITIONS, type NpcTemplateId } from '../../../shared/npcs';
import { CLASSES } from '../../../shared/config';
import { createDungeonPlaytest, type DungeonPlaytest } from './dungeon-playtest';
import { Renderer } from '../../render/render';
import { serializeDungeonDraft, compactDungeonDraft, DEFAULT_BOSS_AGGRO_RADIUS, PICKUP_CATALOG, compileDungeonDraft, draftFlameTiles, draftFromDungeon, newDungeonDraft, parseDungeonDraft, TERRAIN_CATALOG, validateDungeonDraft, type DraftEntity, type DungeonDraft } from '../../../shared/dungeon-draft';
import type { AbilitySlot, ClassId, PickupKind, TileKind, Vec2 } from '../../../shared/types';
const root = document.querySelector<HTMLDivElement>('#maker')!;
const field = (id: string, label: string, type = 'text') => `<label>${label}<input id="${id}" type="${type}"></label>`;
root.innerHTML = `
<header><a href="/" class="brand">◇ RIFTLANDS <span>/ STUDIO</span></a><span class="local-badge">Bozza locale</span><a href="/world-maker.html" id="world-studio-link">World Maker ↗</a><a href="/">Torna al gioco ↗</a></header>
<div class="title-row"><div><span class="eyebrow">WORLD BUILDING / 01</span><h1>Dungeon maker<span>.</span></h1><p>Disegna il terreno. Popola la mappa. Prepara gli incontri.</p></div><div class="file-actions"><button id="import">Importa dungeon</button><button id="download">Salva dungeon</button><button id="compile" class="primary">Esporta runtime (avanzato)</button></div></div>
<main><aside class="palette panel"><h2>01 <span>Strumenti</span></h2><div class="tool-grid"><button data-tool="select">↖ Seleziona</button><button data-tool="erase">⌫ Rimuovi entità</button></div><h3>Terreno</h3><div id="terrain" class="tool-grid"></div><h3>Creature</h3><div id="npcs" class="tool-list"></div><h3>Boss disponibili</h3><div id="bosses" class="tool-list"></div><h3>Incontro</h3><div class="tool-list"><button data-tool="boss">◇ Boss / segnaposto</button><button data-tool="party">⊕ Spawn solo / gruppo · opzionale</button><button data-tool="activation">◇ Punto di attivazione</button><button data-tool="flame">Fiamme</button><button data-tool="visitors">▧ Zona visitatori</button><button data-tool="visitors-erase">Cancella zona visitatori</button></div><p class="hint">Blu trasparente: zona accessibile a nemici e compagni esclusi dallo scontro, per l’incontro selezionato. Fuori dalla zona vengono espulsi. Trascina per dipingere o spostare. Rotella per zoom; tasto destro per spostare la vista.</p></aside>
<section class="workspace panel"><div class="canvas-toolbar"><div><button id="undo" aria-label="Annulla modifica">↶</button><button id="redo" aria-label="Ripeti modifica">↷</button></div><span id="tool-name"></span><div><button id="zoom-out">−</button><button id="fit">Adatta</button><button id="zoom-in">+</button></div></div><div class="viewport"><canvas id="map" tabindex="0" aria-label="Mappa dungeon modificabile"></canvas><div id="preview-label" hidden>ANTEPRIMA MOVIMENTO · WASD / FRECCE · ESC PER USCIRE</div></div><div class="canvas-footer"><span id="map-info"></span><button id="preview">Prova movimento</button></div></section>
<aside class="inspector panel"><section id="dungeon-library" hidden><h2>Catalogo installato</h2><select aria-label="Dungeon installato"></select><div class="tool-list"><button data-library="open">Apri nel maker</button><button data-action="install">Installa bozza</button><button data-action="update">Aggiorna bozza installata</button><button data-action="remove">Elimina dungeon selezionato</button></div><p class="hint">Modifiche locali a server fermo. Aggiornare azzera lo stato dei boss del dungeon.</p></section><section id="dungeon-backups" hidden><h2>Backup locali</h2><label>Backup da eliminare<select id="backup-scope"></select></label><p id="backup-summary" class="hint"></p><details><summary>File inclusi</summary><ul id="backup-files"></ul></details><button id="delete-backups">Elimina backup selezionati</button><p class="hint">Elimina solo le copie di recupero. Catalogo e account attuali restano invariati. I backup sono copie complete dei file, anche quando associati a un solo dungeon.</p></section><h2>02 <span>Proprietà</span></h2>${field('name', 'Nome dungeon')}${field('map-id', 'ID mappa')}<p class="hint">Posizione sulla mappa gestita dal World Maker.</p><h3>Incontri</h3><label>Incontro attivo<select id="encounter"></select></label><button id="add-encounter">Nuovo incontro separato</button><button id="remove-encounter">Rimuovi incontro vuoto</button>${field('encounter-name', 'Nome incontro')}<div class="two-fields">${field('encounter-x', 'Colonna regione', 'number')}${field('encounter-y', 'Riga regione', 'number')}${field('encounter-width', 'Larghezza', 'number')}${field('encounter-height', 'Altezza', 'number')}</div><p class="hint">Zona visitatori blu: accesso durante lo scontro senza diventare partecipanti. Più boss nello stesso incontro: fiamme fino alla morte dell’ultimo. Incontri separati: regioni senza sovrapposizioni.</p>
<div id="entity-properties" hidden><h3>Entità selezionata</h3>${field('entity-label', 'Etichetta')}<div class="two-fields">${field('entity-x', 'Colonna', 'number')}${field('entity-y', 'Riga', 'number')}</div><div id="level-label">${field('entity-level', 'Livello', 'number')}</div><label id="template-label">Boss<select id="entity-template"><option value="">Segnaposto · da creare</option></select></label><label id="inherit-radius-label"><input id="entity-inherit-radius" type="checkbox">Eredita hitbox dal catalogo boss</label><div id="radius-label">${field('entity-radius', 'Raggio boss', 'number')}</div><div id="aggro-label">${field('entity-aggroRadius', 'Raggio aggro (unità; 48 = 1 tile)', 'number')}</div><label id="entity-encounter-label">Incontro dell’entità<select id="entity-encounter"></select></label><div id="flame-properties">${field('entity-span', 'Lunghezza (tile)', 'number')}<label>Direzione<select id="entity-vertical"><option value="false">Orizzontale</option><option value="true">Verticale</option></select></label></div><button id="delete">Rimuovi entità</button></div><h3>Controllo mappa</h3><ul id="issues"></ul><p class="hint">Installa la bozza nel progetto: npm run dungeon:import -- percorso/file.draft.json. Poi ricompila e riavvia. I segnaposto richiedono un boss implementato. Punti di attivazione o aggro avviano il dungeon: subito in solo, dopo 5 secondi in gruppo. All’avvio i giocatori vengono posizionati sugli spawn gruppo (metti 5 punti distinti per un team completo). I boss lontani attendono il proprio aggro. I punti di attivazione non hanno il limite di 5. Le fiamme appaiono solo dove le disegni, puntano verso l’interno e sono letali durante lo scontro. Per gestire il catalogo direttamente qui: npm run dungeon:studio.</p></aside></main>
<footer><div class="new-map"><label>Nuova mappa <input id="width" type="number" value="24" min="8" max="96"> × <input id="height" type="number" value="18" min="8" max="96"></label><button id="new">Crea</button><select id="example"><option value="">Copia da catalogo…</option></select></div><span id="status" role="status">Pronto</span></footer><input id="file" type="file" accept=".json,application/json" hidden>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const value = (id: string) => input(id).value;
const button = (id: string, action: () => void) => el(id).addEventListener('click', action);
const status = (message: string) => { el('status').textContent = message; };
el('npcs').previousElementSibling!.insertAdjacentHTML('beforebegin', '<section class="shared-assets"><h3>Asset condivisi</h3><input id="dungeon-asset-search" placeholder="Cerca un asset…" aria-label="Cerca asset condivisi"><div class="catalog-actions"><button id="dungeon-assets-expand">Espandi tutti</button><button id="dungeon-assets-collapse">Comprimi tutti</button></div><div id="dungeon-assets" class="asset-list"></div><p class="hint">Importa e modifica gli asset nel World Maker. Applica il catalogo prima di installare dungeon che usano nuovi asset.</p></section>');
el('entity-properties').insertAdjacentHTML('afterend', `<section id="asset-placement-properties" hidden><h3>Asset selezionato</h3><p id="asset-placement-name"></p><div class="two-fields">${field('asset-placement-x', 'Colonna', 'number')}${field('asset-placement-y', 'Riga', 'number')}</div><button id="delete-asset-placement">Rimuovi asset</button></section>`);
el('npcs').insertAdjacentHTML('afterend', '<h3>Powerup e powerdown</h3><div id="pickups" class="tool-list"></div>');
el('issues').insertAdjacentHTML('afterend', '<p id="issue-detail" class="hint" role="status" hidden></p>');
el('preview').textContent = 'Prova gioco locale';
el('preview').insertAdjacentHTML('beforebegin', `<label class="preview-class">Classe<select id="preview-class">${Object.values(CLASSES).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></label>`);
input('preview-class').value = 'warrior';
root.insertAdjacentHTML('beforeend', '<dialog id="playtest-dialog" class="playtest-dialog"><div class="playtest-toolbar"><strong>Prova locale</strong><button id="playtest-restart">Ricomincia</button><button id="playtest-close">Torna al maker</button></div><p>WASD / frecce: movimento · Mouse: mira · Click / spazio: attacco · Q E R: abilità · Esc: esci</p><div class="playtest-viewport"><canvas id="playtest-canvas" tabindex="0" aria-label="Prova locale del dungeon"></canvas></div><div id="playtest-status" role="status"></div><div id="playtest-abilities" class="playtest-abilities"></div></dialog>');
const playtestDialog = el<HTMLDialogElement>('playtest-dialog');
const playtestCanvas = el<HTMLCanvasElement>('playtest-canvas');
root.querySelector('[data-tool="flame"]')!.insertAdjacentHTML('afterend', '<button id="random-flame">Fiamma in un punto casuale</button>');
const rules = el('issues').parentElement!.querySelector<HTMLParagraphElement>(':scope > p.hint:last-child')!;
rules.textContent = 'Gli ingressi, anche in erba, si chiudono automaticamente con massi durante lo scontro. Il terreno originale ritorna alla vittoria o alla morte di un partecipante. In solo e in gruppo restano i tempi di ingresso del gioco. Gli spawn sono opzionali: senza punti configurati ogni partecipante conserva la posizione raggiunta entrando; se presenti valgono anche per il singolo. I boss lontani attendono il proprio aggro. Le fiamme sono letali e compaiono solo durante lo scontro. Clicca un errore per vedere i punti coinvolti e come correggerlo. La prova locale usa il combattimento del gioco e non salva progressi.';
// The retired drafts referenced removed map instances rather than reusable boss models.
localStorage.removeItem('riftlands.dungeon-draft.v1');
const KEY = 'riftlands.dungeon-draft.v2';
let draft = newDungeonDraft(), selected: string | null = null, activeEncounter = 'main', tool = 'tile:path';
let past: DungeonDraft[] = [], future: DungeonDraft[] = [];
let stroke: DungeonDraft | null = null, lastTile: Vec2 | null = null, pointer: number | null = null, pan: Vec2 | null = null;
let preview: DungeonPlaytest | null = null, previewRenderer: Renderer | null = null;
let aim = 0, attacking = false, highlighted: Vec2[] = [], queuedCast: AbilitySlot | undefined;
const keys = new Set<string>();
let view = { x: 0, y: 0, scale: 26 };
const canvas = el<HTMLCanvasElement>('map'), ctx = canvas.getContext('2d')!;
let sharedAssets: readonly WorldAsset[] = WORLD_DOCUMENT.assets;
let animatedAssets = false;
let assetDragOffset: Vec2 | null = null;
const assetArt = new WorldAssetArt(() => draw());
const assetCatalog = new WorldAssetCatalog(el('dungeon-assets'), id => { selected = null; setTool(`asset:${id}`); refresh(); });
const studioChannel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('riftlands.studio') : undefined;
button('dungeon-assets-expand', () => assetCatalog.expandAll(true));
button('dungeon-assets-collapse', () => assetCatalog.expandAll(false));
input('dungeon-asset-search').addEventListener('input', () => refresh());
for (const axis of ['x', 'y'] as const) input(`asset-placement-${axis}`).addEventListener('change', () => change(() => {
    const p = draft.assetPlacements?.find(p => p.id === selected);
    if (p) p[axis] = Number(value(`asset-placement-${axis}`));
}));
button('delete-asset-placement', () => remove());
let storageError = '';
try {
    const stored = localStorage.getItem(KEY);
    if (stored)
        draft = parseDungeonDraft(stored);
}
catch {
    storageError = 'Salvataggio locale non leggibile. Importa una bozza JSON.';
}
function palette(container: string, label: string, tool: string, color: string): void {
    const b = document.createElement('button');
    b.dataset.tool = tool;
    b.textContent = label;
    const swatch = document.createElement('i');
    swatch.style.background = color;
    b.prepend(swatch);
    el(container).append(b);
}
for (const [id, item] of Object.entries(TERRAIN_CATALOG))
    palette('terrain', item.name, `tile:${id}`, item.color);
for (const [id, item] of Object.entries(NPC_DEFINITIONS))
    palette('npcs', item.name, `npc:${id}`, item.color);
for (const [id, item] of Object.entries(PICKUP_CATALOG))
    palette('pickups', item.name, `pickup:${id}`, item.color);
function refreshBossPalette() { el("bosses").replaceChildren(); el("entity-template").replaceChildren(new Option("Segnaposto · da creare",""));
for (const boss of BOSS_DEFINITIONS) {
    palette('bosses', boss.name, `boss:${boss.id}`, '#df946f');
    el<HTMLSelectElement>('entity-template').add(new Option(boss.name, boss.id));
}
}
refreshBossPalette();
for (const dungeon of DUNGEON_DEFINITIONS)
    el<HTMLSelectElement>('example').add(new Option(dungeon.name, dungeon.id));
function save(): void { try {
    localStorage.setItem(KEY, serializeDungeonDraft(draft));
    status('Bozza salvata su questo dispositivo');
}
catch {
    status('Salvataggio locale non disponibile: esporta la bozza.');
} }
function commit(before: DungeonDraft): void { if (JSON.stringify(before) === JSON.stringify(draft))
    return; highlighted = []; el('issue-detail').hidden = true; past.push(before); if (past.length > 50)
    past.shift(); future = []; refresh(); save(); }
function change(action: () => void): void { const before = structuredClone(draft); try {
    stopPreview();
    action();
    draft = parseDungeonDraft(JSON.stringify(draft));
    commit(before);
}
catch (error) {
    draft = before;
    refresh();
    status(error instanceof Error ? error.message : String(error));
} }
function setTool(next: string): void { stopPreview(); if (next !== tool) pendingWarp = undefined; roomDrag = undefined; tool = next; if (next === 'warp-place') status('Warp: clicca la partenza, poi la destinazione (anche su un altro piano).'); root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.tool === tool)); if (b.dataset.tool === tool)
    el('tool-name').textContent = b.textContent; }); if (tool.startsWith('asset:')) el('tool-name').textContent = `Asset · ${sharedAssets.find(a => a.id === tool.slice(6))?.name ?? tool.slice(6)}`; }
root.addEventListener("click", event => { const b = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tool]"); if(b) setTool(b.dataset.tool!); });
let editorFloor: number | 'all' = 'all', activeRoom = '', pendingWarp: Vec2 | undefined;
let roomDrag: { from: Vec2; to: Vec2; roomId?: string } | undefined;
const mapRoomTools = document.createElement('div'); mapRoomTools.id = 'room-map-tools'; mapRoomTools.className = 'tool-list';
mapRoomTools.innerHTML = `<h3>Stanze e warp sulla mappa</h3><label>Piano visualizzato<select id="edit-floor"><option value="all">Tutti i piani</option></select></label><label>Stanza da rimodellare<select id="edit-room"></select></label>
<button data-tool="room-select">Seleziona stanza sulla mappa</button><button data-tool="room-new">Disegna nuova stanza</button><button data-tool="room-rectangle">Ridisegna rettangolo</button><button data-tool="room-add">Aggiungi forma</button><button data-tool="room-cut">Ritaglia forma</button><button data-tool="warp-place">Posiziona warp · 2 click</button><label>Warp da modificare<select id="edit-warp"></select></label><button id="map-warp-from">Sposta partenza del warp</button><button id="map-warp-to">Sposta destinazione del warp</button><button id="map-warp-reverse">Crea ritorno del warp</button><button data-tool="shadow-new">Disegna zona d’ombra</button><label><input id="warp-return" type="checkbox" checked> Crea anche il ritorno</label><button id="new-edit-floor">Nuovo piano</button><p class="hint">Trascina per disegnare. Aggiungi o ritaglia caselle per ottenere una L. Per un warp: partenza, poi destinazione; puoi cambiare piano tra i click.</p>`;
el('terrain').previousElementSibling!.before(mapRoomTools);
function refreshMapRoomTools(): void {
    mapRoomTools.hidden = !draft.topology;
    if (!draft.topology) { editorFloor = 'all'; activeRoom = ''; pendingWarp = undefined; return; }
    const t = draft.topology;
    if (!t.rooms.some(r => r.id === activeRoom)) activeRoom = t.rooms[0]?.id ?? '';
    const floors = [...new Set([...t.rooms.map(r => r.floor), ...(editorFloor === 'all' ? [] : [editorFloor])])].sort((a,b)=>b-a);
    el<HTMLSelectElement>('edit-floor').replaceChildren(new Option('Tutti i piani','all'), ...floors.map(f => new Option(`Piano ${f}`,String(f))));
    input('edit-floor').value = String(editorFloor);
    const visible = t.rooms.filter(r => editorFloor === 'all' || r.floor === editorFloor);
    if (!visible.some(r => r.id === activeRoom) && visible.length) activeRoom = visible[0].id;
    el<HTMLSelectElement>('edit-room').replaceChildren(...visible.map(r => new Option(r.name,r.id))); input('edit-room').value = activeRoom;
    const oldWarp=value('edit-warp'); el<HTMLSelectElement>('edit-warp').replaceChildren(...t.warps.map((w,i)=>new Option(`Warp ${i+1} · ${w.from.x},${w.from.y} → ${w.to.x},${w.to.y}`,w.id))); if (t.warps.some(w=>w.id===oldWarp)) input('edit-warp').value=oldWarp;
    for (const id of ['map-warp-from','map-warp-to','map-warp-reverse']) el<HTMLButtonElement>(id).disabled=!t.warps.length;
}
input('edit-floor').addEventListener('change', () => { editorFloor = value('edit-floor') === 'all' ? 'all' : Number(value('edit-floor')); refreshMapRoomTools(); draw(); });
input('edit-room').addEventListener('change', () => { activeRoom = value('edit-room'); const r = draft.topology?.rooms.find(r=>r.id===activeRoom); if (r) focusRoom(r); });
button('map-warp-from',()=>{ if(value('edit-warp'))setTool(`warp-from:${value('edit-warp')}`); });
button('map-warp-to',()=>{ if(value('edit-warp'))setTool(`warp-to:${value('edit-warp')}`); });
button('map-warp-reverse',()=>change(()=>{ const w=draft.topology?.warps.find(w=>w.id===value('edit-warp')); if(w) draft.topology!.warps.push({id:`warp-${crypto.randomUUID()}`,from:{...w.to},to:{...w.from}}); }));
button('new-edit-floor', () => { if (!draft.topology) return; editorFloor = Math.min(...draft.topology.rooms.map(r=>r.floor))-1; activeRoom = ''; setTool('room-new'); refreshMapRoomTools(); draw(); status('Nuovo piano: trascina una stanza in uno spazio libero.'); });
const floorOverview = document.createElement('div');
floorOverview.hidden = true;
floorOverview.style.cssText = 'position:absolute;inset:0;padding:24px;background:#111b1e;overflow:auto;z-index:2';
canvas.parentElement!.append(floorOverview);
el('zoom-in').insertAdjacentHTML('beforebegin', '<button id="floor-overview" aria-pressed="false">Vista piani</button>');
function focusRoom(room: DungeonRoom): void {
    activeRoom = room.id; editorFloor = room.floor; refreshMapRoomTools();
    floorOverview.hidden = true; el('floor-overview').setAttribute('aria-pressed', 'false');
    const r = canvas.getBoundingClientRect(); view.x = r.width/2 - (room.x+room.width/2)*view.scale; view.y = r.height/2 - (room.y+room.height/2)*view.scale;
    draw(); status(`${room.name} · piano ${room.floor}`);
}
function refreshFloorOverview(): void {
    floorOverview.replaceChildren();
    if (draft.topology) {
        const graph = dungeonFloorGraph(draft.topology, focusRoom), svg = graph.querySelector('svg')!;
        svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.minWidth = '360px';
        floorOverview.append(graph);
    }
    el<HTMLButtonElement>('floor-overview').disabled = !draft.topology;
    if (!draft.topology) floorOverview.hidden = true;
}
button('floor-overview', () => { refreshFloorOverview(); floorOverview.hidden = !floorOverview.hidden; el('floor-overview').setAttribute('aria-pressed', String(!floorOverview.hidden)); });
const portalTools = document.createElement('div'); portalTools.id = 'dungeon-portal-tools'; portalTools.className = 'tool-list'; mapRoomTools.after(portalTools);
const refreshTopology = topologyPanel(el('entity-properties').parentElement!, () => draft, change, focusRoom, portalTools);
function refresh(): void {
    refreshMapRoomTools();
    refreshTopology();
    refreshFloorOverview();
    const animated = new Set(sharedAssets.filter(a => worldAssetVisual(a).kind === 'fire').map(a => a.id));
    animatedAssets = (draft.assetPlacements ?? []).some(p => animated.has(p.assetId));
    if (!draft.encounters.some(g => g.id === activeEncounter))
        activeEncounter = draft.encounters[0].id;
    for (const id of ['encounter', 'entity-encounter'])
        el<HTMLSelectElement>(id).replaceChildren(...draft.encounters.map(g => new Option(g.name, g.id)));
    input('encounter').value = activeEncounter;
    const group = draft.encounters.find(g => g.id === activeEncounter)!;
    for (const f of ['name', 'x', 'y', 'width', 'height'] as const)
        input(`encounter-${f}`).value = String(group[f]);
    input('name').value = draft.name;
    input('map-id').value = draft.id;
    el<HTMLButtonElement>('undo').disabled = !past.length;
    el<HTMLButtonElement>('redo').disabled = !future.length;
    el('map-info').textContent = `${draft.width} × ${draft.height} caselle · ${draft.entities.length} entità · 48 unità / casella`;
    const e = draft.entities.find(e => e.id === selected);
    const placement = draft.assetPlacements?.find(p => p.id === selected);
    el('asset-placement-properties').hidden = !placement;
    if (placement) {
        el('asset-placement-name').textContent = sharedAssets.find(a => a.id === placement.assetId)?.name ?? placement.assetId;
        input('asset-placement-x').value = String(placement.x); input('asset-placement-y').value = String(placement.y);
    }
    assetCatalog.update(sharedAssets, tool.startsWith('asset:') ? tool.slice(6) : '', value('dungeon-asset-search'));
    el('entity-properties').hidden = !e;
    if (e) {
        for (const f of ['label', 'x', 'y', 'level', 'radius', 'template'] as const)
            input(`entity-${f}`).value = String(e[f]);
        input('entity-encounter').value = e.encounterId ?? draft.encounters[0].id;
        input('entity-span').value = String(e.span ?? 1);
        input('entity-aggroRadius').value = String(e.aggroRadius ?? DEFAULT_BOSS_AGGRO_RADIUS);
        el('aggro-label').hidden = e.kind !== 'boss';
        input('entity-vertical').value = String(e.vertical ?? false);
        el('level-label').hidden = e.kind !== 'npc';
        el('template-label').hidden = el('radius-label').hidden = el('inherit-radius-label').hidden = e.kind !== 'boss';
        input('entity-inherit-radius').checked = e.inheritRadius === true;
        input('entity-radius').disabled = e.inheritRadius === true;
        el('entity-encounter-label').hidden = e.kind === 'npc' || e.kind === 'pickup';
        el('flame-properties').hidden = e.kind !== 'flame';
    }
    const issues = validateDungeonDraft(draft, sharedAssets);
    el('issues').replaceChildren(...(issues.length ? issues : ['Terreno e posizioni validi.']).map(message => {
        const li = document.createElement('li');
        if (!issues.length) li.textContent = message;
        else { const action = document.createElement('button'); action.textContent = message; action.addEventListener('click', () => explainIssue(message)); li.append(action); }
        return li;
    }));
    el('issues').classList.toggle('valid', !issues.length);
    el<HTMLButtonElement>('compile').disabled = issues.length > 0;
    draw();
}
function explainIssue(message: string): void {
    stopPreview();
    const involved = draft.entities.filter(e => message.startsWith(`${e.label}:`) || message.startsWith(`${e.label} e `) || message.includes(` e ${e.label}:`));
    highlighted = involved.flatMap(e => e.kind === 'flame' ? draftFlameTiles(e) : [{ x: e.x, y: e.y }]);
    const group = draft.encounters.find(g => message.startsWith(`${g.name}:`) || message.startsWith(`${g.name} e `));
    if (group) { activeEncounter = group.id; if (!highlighted.length) highlighted = [{ x: group.x, y: group.y }]; }
    selected = involved[0]?.id ?? null;
    const advice = message.includes('non raggiungibile') ? 'Apri un percorso continuo largo almeno una casella tra gli spawn e i punti evidenziati; controlla muri e acqua.'
        : message.includes('sovrappost') ? 'Separa le entità o le regioni coinvolte; considera anche il raggio dei boss e la lunghezza delle fiamme.'
        : message.includes('bordo') ? 'Sposta i punti evidenziati all’interno della mappa e della regione. Le caselle esterne diventano massi durante lo scontro.'
        : message.includes('solido') || message.includes('ingombro') ? 'Sposta l’entità o dipingi terreno percorribile attorno al suo intero ingombro: il centro libero da solo non basta.'
        : message.includes('regione') ? 'Seleziona l’incontro corretto e correggi posizione, dimensioni o assegnazione delle entità.'
        : message.includes('boss') ? 'Scegli un boss dalla palette e posizionalo nella regione del suo incontro.'
        : message.includes('Asset') || message.includes('asset') ? 'Controlla il catalogo condiviso nel World Maker e mantieni l’asset dentro la mappa.'
        : 'Gli spawn sono opzionali; se li usi, posiziona al massimo cinque punti liberi e distinti nella regione.';
    el('issue-detail').hidden = false;
    el('issue-detail').textContent = `${message} ${advice}${highlighted.length ? ` Caselle (colonna, riga): ${highlighted.map(p => `(${p.x}, ${p.y})`).join(', ')}.` : ''}`;
    refresh(); fit();
}
function fit(): void { const r = canvas.getBoundingClientRect(); view.scale = Math.max(4, Math.min(46, (r.width - 60) / draft.width, (r.height - 60) / draft.height)); view.x = (r.width - draft.width * view.scale) / 2; view.y = (r.height - draft.height * view.scale) / 2; draw(); }
function draw(): void {
    const dpr = Math.min(2, devicePixelRatio || 1), r = canvas.getBoundingClientRect(), s = view.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#111b1e';
    ctx.fillRect(0, 0, r.width, r.height);
    ctx.translate(view.x, view.y);
    if (draft.topology && ['room-new','room-add','room-rectangle','room-cut','shadow-new'].includes(tool)) {
        ctx.strokeStyle = '#43515a44'; ctx.lineWidth = 1;
        for (let x=0; x<=draft.width; x++) { ctx.beginPath(); ctx.moveTo(x*s,0); ctx.lineTo(x*s,draft.height*s); ctx.stroke(); }
        for (let y=0; y<=draft.height; y++) { ctx.beginPath(); ctx.moveTo(0,y*s); ctx.lineTo(draft.width*s,y*s); ctx.stroke(); }
    }
    ctx.save();
    if (draft.topology) {
        ctx.beginPath();
        for (const room of draft.topology.rooms.filter(r=>editorFloor==='all'||r.floor===editorFloor)) { if (room.tiles) for (const p of room.tiles) ctx.rect(p.x*s,p.y*s,s,s); else ctx.rect(room.x*s,room.y*s,room.width*s,room.height*s); }
        ctx.clip();
    }
    for (let y = 0; y < draft.height; y++)
        for (let x = 0; x < draft.width; x++) {
            ctx.fillStyle = TERRAIN_CATALOG[draft.tiles[y * draft.width + x]].color;
            ctx.fillRect(x * s, y * s, s, s);
            if (s > 12) {
                ctx.strokeStyle = '#00000020';
                ctx.lineWidth = 1;
                ctx.strokeRect(x * s, y * s, s, s);
            }
        }
    if (draft.topology) {
      ctx.font = '12px system-ui'; ctx.textAlign = 'left';
      for (const room of draft.topology.rooms.filter(r=>editorFloor==='all'||r.floor===editorFloor)) {
        ctx.strokeStyle = room.id === activeRoom ? '#f4dd97' : '#bb97ff'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (const p of dungeonRoomTiles(room)) {
          if (!dungeonRoomContains(room,p.x-1,p.y)) { ctx.moveTo(p.x*s,p.y*s); ctx.lineTo(p.x*s,(p.y+1)*s); }
          if (!dungeonRoomContains(room,p.x+1,p.y)) { ctx.moveTo((p.x+1)*s,p.y*s); ctx.lineTo((p.x+1)*s,(p.y+1)*s); }
          if (!dungeonRoomContains(room,p.x,p.y-1)) { ctx.moveTo(p.x*s,p.y*s); ctx.lineTo((p.x+1)*s,p.y*s); }
          if (!dungeonRoomContains(room,p.x,p.y+1)) { ctx.moveTo(p.x*s,(p.y+1)*s); ctx.lineTo((p.x+1)*s,(p.y+1)*s); }
        }
        ctx.stroke(); ctx.fillStyle = '#e5d8ff'; ctx.fillText(`${room.name} · piano ${room.floor}`,room.x*s+4,room.y*s+16);
      }
      for (const shadow of draft.topology.shadows) { ctx.fillStyle = '#160d3977'; ctx.fillRect(shadow.x*s, shadow.y*s, shadow.width*s, shadow.height*s); }
      for (const p of draft.topology.warps.map(w => w.from)) { ctx.strokeStyle = '#d6b5ff'; ctx.lineWidth = 3; ctx.strokeRect(p.x*s+3, p.y*s+3, s-6, s-6); }
      for (const w of draft.topology.warps) { ctx.strokeStyle = '#c59aff'; ctx.beginPath(); ctx.moveTo((w.from.x+.5)*s,(w.from.y+.5)*s); ctx.lineTo((w.to.x+.5)*s,(w.to.y+.5)*s); ctx.stroke(); }
      for (const marker of [{ point: draft.topology.entry, color: '#c59aff', label: 'IN' }, { point: draft.topology.exit, color: '#76e4ff', label: 'OUT' }]) {
        const p = marker.point;
        if (!draft.topology.rooms.some(r => (editorFloor === 'all' || r.floor === editorFloor) && dungeonRoomContains(r, p.x, p.y))) continue;
        ctx.save(); ctx.strokeStyle = marker.color; ctx.fillStyle = marker.color + '44'; ctx.lineWidth = 3;
        ctx.fillRect(p.x*s+2, p.y*s+2, s-4, s-4); ctx.strokeRect(p.x*s+2, p.y*s+2, s-4, s-4);
        ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 3; ctx.strokeStyle = '#111b1e'; ctx.strokeText(marker.label, (p.x+.5)*s, (p.y+.5)*s);
        ctx.fillStyle = marker.color; ctx.fillText(marker.label, (p.x+.5)*s, (p.y+.5)*s); ctx.restore();
      }

    }
    const placements = [...(draft.assetPlacements ?? [])].sort((p, q) => {
        const a = sharedAssets.find(a => a.id === p.assetId), b = sharedAssets.find(a => a.id === q.assetId);
        return (a?.layer === 'ground' ? -1 : 1) - (b?.layer === 'ground' ? -1 : 1) || p.y + (a?.height ?? 1) * (a?.pivot.y ?? 1) - q.y - (b?.height ?? 1) * (b?.pivot.y ?? 1);
    });
    for (const p of placements) {
        const a = sharedAssets.find(a => a.id === p.assetId);
        if (a) assetArt.draw(ctx, a, p, 1, s, performance.now());
        if (!a || p.id === selected) {
            ctx.strokeStyle = a ? '#fff' : '#ed997e'; ctx.lineWidth = 2;
            ctx.strokeRect(p.x * s, p.y * s, (a?.width ?? 1) * s, (a?.height ?? 1) * s);
        }
    }
    for (const g of draft.encounters) {
        ctx.fillStyle = g.id === activeEncounter ? 'rgba(45,145,255,0.22)' : 'rgba(45,145,255,0.10)';
        for (const tile of g.visitorTiles ?? []) ctx.fillRect(tile.x*s,tile.y*s,s,s);
        ctx.strokeStyle = g.id === activeEncounter ? '#ffffffbb' : '#7fe0d377';
        ctx.lineWidth = 2;
        ctx.strokeRect(g.x * s, g.y * s, g.width * s, g.height * s);
        ctx.fillStyle = '#fff';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(g.name, g.x * s + 4, g.y * s + 4);
    }
    for (const e of draft.entities) {
        ctx.strokeStyle = e.id === selected ? '#fff' : '#111b1e';
        ctx.lineWidth = e.id === selected ? 3 : 1.5;
        if (e.kind === 'flame') {
            const angle = inwardFlameAngle(flameBarrierFromTiles(draftFlameTiles(e), e.vertical),
                { minTx: 0, minTy: 0, maxTx: draft.width - 1, maxTy: draft.height - 1 });
            for (const t of draftFlameTiles(e)) {
                ctx.fillStyle = '#ff743acc';
                ctx.fillRect(t.x * s + 2, t.y * s + 2, s - 4, s - 4);
                ctx.strokeRect(t.x * s + 2, t.y * s + 2, s - 4, s - 4);
                ctx.save(); ctx.translate((t.x + .5) * s, (t.y + .5) * s); ctx.rotate(angle);
                ctx.fillStyle = '#32170c'; ctx.beginPath(); ctx.moveTo(-s * .2, -s * .16);
                ctx.lineTo(s * .2, -s * .16); ctx.lineTo(0, s * .28); ctx.closePath(); ctx.fill(); ctx.restore();
            }
            continue;
        }
        const x = (e.x + .5) * s, y = (e.y + .5) * s;
        if (e.kind === 'boss' && e.id === selected) {
            const g = draft.encounters.find(g => g.id === (e.encounterId ?? draft.encounters[0].id))!;
            ctx.save(); ctx.beginPath(); ctx.rect(g.x*s,g.y*s,g.width*s,g.height*s); ctx.clip();
            ctx.beginPath(); ctx.arc(x,y,(e.aggroRadius ?? DEFAULT_BOSS_AGGRO_RADIUS)/48*s,0,Math.PI*2);
            ctx.fillStyle = '#df946f22'; ctx.fill(); ctx.strokeStyle = '#df946f'; ctx.setLineDash([5,4]); ctx.stroke(); ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(x, y, Math.max(5, e.radius / 48 * s), 0, Math.PI * 2);
        ctx.fillStyle = e.kind === 'boss' ? '#df946f' : e.kind === 'party' ? '#7fe0d3' : e.kind === 'activation' ? '#d4b5ff' : e.kind === 'pickup' ? PICKUP_CATALOG[e.template as PickupKind].color : NPC_DEFINITIONS[e.template as NpcTemplateId].color;
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#102023';
        ctx.font = `bold ${Math.max(9, s * .35)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(e.kind === 'boss' ? 'B' : e.kind === 'party' ? 'P' : e.kind === 'activation' ? 'A' : e.kind === 'pickup' ? (e.template === 'weakness' ? '−' : '+') : e.template[0].toUpperCase(), x, y);
    }
    ctx.strokeStyle = '#ffdf7e'; ctx.lineWidth = 3;
    for (const p of highlighted) ctx.strokeRect(p.x * s + 1, p.y * s + 1, s - 2, s - 2);
    ctx.restore();
    if (roomDrag) { const x=Math.min(roomDrag.from.x,roomDrag.to.x), y=Math.min(roomDrag.from.y,roomDrag.to.y), w=Math.abs(roomDrag.to.x-roomDrag.from.x)+1,h=Math.abs(roomDrag.to.y-roomDrag.from.y)+1; ctx.fillStyle='#c59aff33'; ctx.fillRect(x*s,y*s,w*s,h*s); ctx.strokeStyle='#f4dd97'; ctx.strokeRect(x*s,y*s,w*s,h*s); }
    if (pendingWarp) { ctx.strokeStyle='#76e4ff'; ctx.lineWidth=3; ctx.strokeRect(pendingWarp.x*s+2,pendingWarp.y*s+2,s-4,s-4); }
}
function tileAt(event: PointerEvent): Vec2 { const r = canvas.getBoundingClientRect(); return { x: Math.floor((event.clientX - r.left - view.x) / view.scale), y: Math.floor((event.clientY - r.top - view.y) / view.scale) }; }
function paint(p: Vec2): void {
    if (p.x < 0 || p.y < 0 || p.x >= draft.width || p.y >= draft.height)
        return;
    if (draft.topology && tool==='shadow-new') { roomDrag??={from:p,to:p}; roomDrag.to=p; lastTile=p; draw(); return; }
    if (draft.topology && tool.startsWith('room-')) {
        const t=draft.topology;
        if (tool==='room-select' && !lastTile) { const room=dungeonRoomAt(t,{x:0,y:0},{x:(p.x+.5)*48,y:(p.y+.5)*48}); if (room && (editorFloor==='all'||room.floor===editorFloor)) { activeRoom=room.id; refreshMapRoomTools(); } }
        else if (tool==='room-add' || tool==='room-cut') { roomBrush(draft,activeRoom,lastTile??p,p,tool==='room-cut'); }
        else if (tool==='room-new' || tool==='room-rectangle') { roomDrag ??= {from:p,to:p,roomId:tool==='room-rectangle'?activeRoom:undefined}; roomDrag.to=p; }
        lastTile=p; draw(); return;
    }
    if (draft.topology && (tool==='warp-place' || tool.startsWith('warp-from:') || tool.startsWith('warp-to:') || tool==='entry-place' || tool==='exit-place')) {
        if (lastTile) return;
        const t=draft.topology, room=dungeonRoomAt(t,{x:0,y:0},{x:(p.x+.5)*48,y:(p.y+.5)*48});
        if (!room || (editorFloor!=='all' && room.floor!==editorFloor) || ['rock','water'].includes(draft.tiles[p.y*draft.width+p.x])) { status('Scegli una casella libera all’interno di una stanza del piano visualizzato.'); return; }
        if (tool==='entry-place') t.entry={...p};
        else if (tool==='exit-place') t.exit={...p};
        else if (tool.startsWith('warp-from:') || tool.startsWith('warp-to:')) { const w=t.warps.find(w=>w.id===tool.split(':')[1]); if (w) { if (tool.startsWith('warp-from:')) w.from={...p}; else w.to={...p}; } }
        else if (!pendingWarp) { pendingWarp={...p}; status('Partenza scelta: clicca la destinazione. Puoi cambiare piano.'); }
        else if (pendingWarp.x===p.x && pendingWarp.y===p.y) { status('La destinazione deve essere diversa dalla partenza.'); }
        else { const id=`warp-${crypto.randomUUID()}`; t.warps.push({id,from:{...pendingWarp},to:{...p}}); if (input('warp-return').checked) t.warps.push({id:`${id}-back`,from:{...p},to:{...pendingWarp}}); pendingWarp=undefined; status('Warp creato.'); }
        lastTile=p; draw(); return;
    }
    if (draft.topology && editorFloor!=='all' && !draft.topology.rooms.some(r=>r.floor===editorFloor&&dungeonRoomContains(r,p.x,p.y))) return;
    const existing = draft.entities.find(e => e.kind === 'flame' ? draftFlameTiles(e).some(t => t.x === p.x && t.y === p.y) : e.x === p.x && e.y === p.y);
    const existingAsset = [...(draft.assetPlacements ?? [])].reverse().find(item => {
        const a = sharedAssets.find(a => a.id === item.assetId);
        return p.x >= item.x && p.y >= item.y && p.x < item.x + (a?.columns ?? 1) && p.y < item.y + (a?.rows ?? 1);
    });
    if (tool === 'visitors' || tool === 'visitors-erase') {
        const group = draft.encounters.find(g=>g.id===activeEncounter)!;
        const tiles = new Map((group.visitorTiles ?? []).map(t=>[`${t.x},${t.y}`,t]));
        const from=lastTile ?? p, n=Math.max(Math.abs(p.x-from.x),Math.abs(p.y-from.y));
        for(let i=0;i<=n;i++) {
            const t=n ? i/n : 1, x=Math.round(from.x+(p.x-from.x)*t), y=Math.round(from.y+(p.y-from.y)*t);
            if (tool==='visitors-erase') tiles.delete(`${x},${y}`);
            else if (x>=group.x && y>=group.y && x<group.x+group.width && y<group.y+group.height) tiles.set(`${x},${y}`,{x,y});
        }
        group.visitorTiles=[...tiles.values()];
    }
    else if (tool.startsWith('tile:')) {
        const from = lastTile ?? p, n = Math.max(Math.abs(p.x - from.x), Math.abs(p.y - from.y));
        for (let i = 0; i <= n; i++) {
            const t = n ? i / n : 1;
            draft.tiles[Math.round(from.y + (p.y - from.y) * t) * draft.width + Math.round(from.x + (p.x - from.x) * t)] = tool.slice(5) as TileKind;
        }
    }
    else if (tool === 'erase') {
        if (existing)
            draft.entities = draft.entities.filter(e => e !== existing);
        else if (existingAsset) draft.assetPlacements = draft.assetPlacements!.filter(a => a !== existingAsset);
    }
    else if (tool === 'select') {
        const e = draft.entities.find(e => e.id === selected);
        const asset = draft.assetPlacements?.find(a => a.id === selected);
        if (e && lastTile)
            Object.assign(e, p);
        else if (asset && lastTile) {
            const a = sharedAssets.find(a => a.id === asset.assetId), x = p.x - (assetDragOffset?.x ?? 0), y = p.y - (assetDragOffset?.y ?? 0);
            if (x >= 0 && y >= 0 && x + (a?.columns ?? 1) <= draft.width && y + (a?.rows ?? 1) <= draft.height) Object.assign(asset, { x, y });
        }
        else if (!lastTile) {
            selected = existing?.id ?? existingAsset?.id ?? null;
            assetDragOffset = existingAsset ? { x: p.x - existingAsset.x, y: p.y - existingAsset.y } : null;
        }
    }
    else if (tool.startsWith('asset:')) {
        const asset = sharedAssets.find(a => a.id === tool.slice(6));
        if (!lastTile && asset && (draft.assetPlacements?.length ?? 0) < 4096) {
            if (p.x + asset.columns > draft.width || p.y + asset.rows > draft.height) { status('L’asset deve restare dentro la mappa.'); return; }
            const placement = { id: crypto.randomUUID(), assetId: asset.id, ...p };
            (draft.assetPlacements ??= []).push(placement); selected = placement.id;
        }
    }
    else if (tool === 'activation') {
        const from = lastTile ?? p, n = Math.max(Math.abs(p.x-from.x),Math.abs(p.y-from.y));
        for(let i=0;i<=n && draft.entities.length<500;i++) {
            const t=n ? i/n : 1, x=Math.round(from.x+(p.x-from.x)*t), y=Math.round(from.y+(p.y-from.y)*t);
            if (draft.entities.some(e=>e.kind==='activation' && e.x===x && e.y===y)) continue;
            const e: DraftEntity = {id:crypto.randomUUID(),kind:'activation',template:'',label:'Punto di attivazione',x,y,level:1,radius:15,encounterId:activeEncounter};
            draft.entities.push(e); selected=e.id;
        }
    }
    else if (!lastTile && !existing) {
        if (draft.entities.length >= 500)
            return;
        const kind = tool.startsWith('pickup:') ? 'pickup' : tool.startsWith('npc:') ? 'npc' : tool.startsWith('boss:') ? 'boss' : tool as 'boss' | 'party' | 'activation' | 'flame';
        if (kind === 'flame' && (p.x === 0 || p.y === 0 || p.x === draft.width - 1 || p.y === draft.height - 1)) { status('Il bordo si chiude con i massi: posiziona le fiamme all’interno.'); return; }
        const template = kind === 'pickup' ? tool.slice(7) : kind === 'npc' ? tool.slice(4) : tool.startsWith('boss:') ? tool.slice(5) : '';
        const npc = kind === 'npc' ? NPC_DEFINITIONS[template as NpcTemplateId] : undefined, boss = BOSS_DEFINITIONS.find(b => b.id === template);
        const e: DraftEntity = { id: crypto.randomUUID(), kind, template, label: npc?.name ?? boss?.name ?? (kind === 'boss' ? 'Boss da creare' : kind === 'flame' ? 'Fiamme' : kind === 'activation' ? 'Punto di attivazione' : 'Spawn gruppo'), ...p, level: 1, radius: npc?.radius ?? boss?.radius ?? (kind === 'boss' ? 36 : 15), ...(kind !== 'npc' ? { encounterId: activeEncounter } : {}), ...(kind === 'boss' ? { inheritRadius: true, aggroRadius: DEFAULT_BOSS_AGGRO_RADIUS } : {}), ...(kind === 'flame' ? { span: 1, vertical: false } : {}) };
        draft.entities.push(e);
        if (kind === 'pickup') { e.label = PICKUP_CATALOG[template as PickupKind].name; e.radius = 12; delete e.encounterId; }
        selected = e.id;
    }
    lastTile = p;
    draw();
}
canvas.addEventListener('pointerdown', e => { if (preview || pointer !== null || ![0, 2].includes(e.button))
    return; e.preventDefault(); canvas.focus(); pointer = e.pointerId; canvas.setPointerCapture(pointer); if (e.button === 2)
    pan = { x: e.clientX, y: e.clientY };
else {
    stroke = structuredClone(draft);
    lastTile = null;
    paint(tileAt(e));
} });
canvas.addEventListener('pointermove', e => { if (e.pointerId !== pointer)
    return; if (pan) {
    view.x += e.clientX - pan.x;
    view.y += e.clientY - pan.y;
    pan = { x: e.clientX, y: e.clientY };
    draw();
}
else if (stroke)
    paint(tileAt(e)); });
function finishStroke(cancelled = false): void { if (stroke) {
    if (cancelled) draft = stroke;
    else {
        try {
            if (roomDrag && draft.topology && tool==='shadow-new') { const a=roomDrag.from,b=roomDrag.to; draft.topology.shadows.push({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x)+1,height:Math.abs(a.y-b.y)+1,revealRadius:4}); }
            else if (roomDrag && draft.topology) { const room=roomRectangle(draft,roomDrag.from,roomDrag.to,editorFloor==='all'?0:editorFloor,roomDrag.roomId); activeRoom=room.id; editorFloor=room.floor; if (tool==='room-new') focusRoom(room); }
            if (JSON.stringify(draft)!==JSON.stringify(stroke)) commit(stroke);
        } catch(error) { draft=stroke; status(error instanceof Error?error.message:String(error)); }
    }
} stroke = null; lastTile = null; pointer = null; pan = null; roomDrag = undefined; refresh(); }
canvas.addEventListener('pointerup', () => finishStroke());
canvas.addEventListener('pointercancel', () => finishStroke(true));
canvas.addEventListener('lostpointercapture', () => { if (pointer !== null)
    finishStroke(true); });
canvas.addEventListener('contextmenu', e => e.preventDefault());
function zoom(factor: number, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2): void { const old = view.scale; view.scale = Math.max(4, Math.min(90, old * factor)); view.x = x - (x - view.x) * view.scale / old; view.y = y - (y - view.y) * view.scale / old; draw(); }
canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
button('fit', fit);
button('zoom-in', () => zoom(1.2));
button('zoom-out', () => zoom(1 / 1.2));
function history(undo: boolean): void { stopPreview(); const source = undo ? past : future, target = undo ? future : past, next = source.pop(); if (!next)
    return; target.push(draft); draft = next; selected = null; refresh(); save(); }
button('undo', () => history(true));
button('redo', () => history(false));
for (const [id, f] of [['name', 'name'], ['map-id', 'id']] as const)
    input(id).addEventListener('change', () => change(() => { draft[f] = value(id).trim(); }));
el('encounter').addEventListener('change', () => { activeEncounter = value('encounter'); refresh(); });
for (const f of ['name', 'x', 'y', 'width', 'height'] as const)
    input(`encounter-${f}`).addEventListener('change', () => change(() => { const g = draft.encounters.find(g => g.id === activeEncounter)!; if (f === 'name')
        g.name = value('encounter-name');
    else
        g[f] = Number(value(`encounter-${f}`)); }));
button('add-encounter', () => change(() => { activeEncounter = crypto.randomUUID(); draft.encounters.push({ id: activeEncounter, name: `Incontro ${draft.encounters.length + 1}`, x: 0, y: 0, width: draft.width, height: draft.height }); }));
button('remove-encounter', () => change(() => { if (draft.encounters.length === 1 || draft.entities.some(e => e.kind !== 'npc' && (e.encounterId ?? draft.encounters[0].id) === activeEncounter))
    throw new Error('Riassegna prima le entità. Deve restare almeno un incontro.'); draft.encounters = draft.encounters.filter(g => g.id !== activeEncounter); }));
for (const f of ['label', 'x', 'y', 'level', 'radius', 'template', 'encounter', 'span', 'vertical', 'aggroRadius'] as const)
    el(`entity-${f}`).addEventListener('change', () => change(() => { const e = draft.entities.find(e => e.id === selected); if (!e)
        return; if (f === 'label' || f === 'template')
        e[f] = value(`entity-${f}`);
    else if (f === 'encounter')
        e.encounterId = value('entity-encounter');
    else if (f === 'vertical')
        e.vertical = value('entity-vertical') === 'true';
    else
        e[f] = Number(value(`entity-${f}`)); if (f === 'radius') e.inheritRadius = false; if (f === 'template') {
        const b = BOSS_DEFINITIONS.find(b => b.id === e.template);
        if (b) {
            e.label = b.name;
            e.radius = b.radius; e.inheritRadius = true;
        }
    } }));
const remove = () => change(() => { draft.entities = draft.entities.filter(e => e.id !== selected); if (draft.assetPlacements) draft.assetPlacements = draft.assetPlacements.filter(p => p.id !== selected); selected = null; });
button('delete', remove);
button('new', () => { change(() => { draft = newDungeonDraft(Number(value('width')), Number(value('height'))); selected = null; }); fit(); });
el('example').addEventListener('change', () => { const d = DUNGEON_DEFINITIONS.find(d => d.id === value('example')); if (!d)
    return; change(() => { draft = draftFromDungeon(d, BOSS_DEFINITIONS.find(b => b.id === d.bossId)?.radius); selected = null; }); fit(); status('Geometria copiata: verifica regioni e ingressi prima di esportare.'); input('example').value = ''; });
function download(data: unknown, name: string): void { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
button('download', () => download(compactDungeonDraft(draft), `${draft.id}.draft.json`));
button('compile', () => { try {
    download(compileDungeonDraft(draft, sharedAssets), `${draft.id}.runtime.json`);
    status('Runtime esportato. Installa usando dungeon:import con la bozza JSON.');
}
catch (e) {
    status(e instanceof Error ? e.message : String(e));
} });
button('import', () => input('file').click());
input('file').addEventListener('change', async () => { const file = input('file').files?.[0]; if (!file)
    return; try {
    if (file.size > 2000000)
        throw new Error('File troppo grande (massimo 2 MB).');
    const imported = parseDungeonFile(await file.text(), sharedAssets);
    change(() => { draft = imported.draft; selected = null; });
    fit();
    if (imported.warnings.length) status(imported.warnings.join(' '));
}
catch (e) {
    status(e instanceof Error ? e.message : String(e));
} input('file').value = ''; });
function stopPreview(): void { preview = null; previewRenderer?.destroy(); previewRenderer = null; keys.clear(); attacking = false; queuedCast = undefined; aim = 0; if (playtestDialog.open) playtestDialog.close(); el('preview').textContent = 'Prova gioco locale'; draw(); }
function startPreview(): void {
    stopPreview();
    try {
        preview = createDungeonPlaytest(draft, value('preview-class') as ClassId, sharedAssets);
        playtestDialog.showModal();
        previewRenderer = new Renderer(playtestCanvas, [preview.definition]);
        previewRenderer.world = preview.world;
        el('preview').textContent = 'Termina prova';
        playtestCanvas.focus();
        el('playtest-abilities').replaceChildren(...Object.entries(CLASSES[preview.player.classId].abilities).map(([slot, ability]) => {
            const b = document.createElement('button'); b.dataset.slot = slot; b.title = ability.description;
            b.addEventListener('pointerdown', () => { queuedCast = slot as AbilitySlot; keys.add(slot === 'basic' ? 'Space' : `Key${slot.toUpperCase()}`); });
            const release = () => keys.delete(slot === 'basic' ? 'Space' : `Key${slot.toUpperCase()}`);
            b.addEventListener('pointerup', release); b.addEventListener('pointerleave', release); b.addEventListener('pointercancel', release);
            return b;
        }));
    } catch (error) { stopPreview(); status(error instanceof Error ? error.message : String(error)); }
}
button('preview', () => preview ? stopPreview() : startPreview());
button('playtest-close', stopPreview);
button('playtest-restart', startPreview);
playtestDialog.addEventListener('cancel', e => { e.preventDefault(); stopPreview(); });
playtestCanvas.addEventListener('pointermove', e => { if (preview && previewRenderer) { const p = previewRenderer.screenToWorld(e.clientX, e.clientY); aim = Math.atan2(p.y - preview.player.y, p.x - preview.player.x); } });
playtestCanvas.addEventListener('pointerdown', e => { if (e.button !== 0 || !preview || !previewRenderer) return; const p = previewRenderer.screenToWorld(e.clientX, e.clientY); aim = Math.atan2(p.y - preview.player.y, p.x - preview.player.x); attacking = true; queuedCast = 'basic'; playtestCanvas.setPointerCapture(e.pointerId); playtestCanvas.focus(); });
playtestCanvas.addEventListener('pointerup', () => { attacking = false; });
playtestCanvas.addEventListener('pointercancel', () => { attacking = false; });
button('random-flame', () => change(() => {
    const group = draft.encounters.find(g => g.id === activeEncounter)!;
    const candidates: DraftEntity[] = [];
    for (let y = Math.max(1, group.y); y < Math.min(draft.height - 1, group.y + group.height); y++)
        for (let x = Math.max(1, group.x); x < Math.min(draft.width - 1, group.x + group.width); x++) {
            if (['rock', 'water'].includes(draft.tiles[y * draft.width + x]) || draft.entities.some(e => (e.kind === 'flame' ? draftFlameTiles(e) : [e]).some(p => p.x === x && p.y === y))) continue;
            candidates.push({ id: crypto.randomUUID(), kind: 'flame', template: '', label: 'Fiamma casuale', x, y, radius: 15, level: 1, span: 1, vertical: false, encounterId: activeEncounter });
        }
    if (!candidates.length) throw new Error('Nessuna casella interna libera per le fiamme.');
    const e = candidates[Math.floor(Math.random() * candidates.length)]; draft.entities.push(e); selected = e.id;
}));
window.addEventListener('keydown', e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)
    return; if (e.key === 'Escape') { stopPreview(); pendingWarp=undefined; floorOverview.hidden=true; if(stroke) finishStroke(true); draw(); } if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    history(!e.shiftKey);
} if (e.code === 'Delete' && selected && !preview)
    remove(); if (preview && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyQ', 'KeyE', 'KeyR'].includes(e.code)) {
    e.preventDefault();
    keys.add(e.code);
    if (e.code === 'Space') queuedCast = 'basic';
    else if (['KeyQ', 'KeyE', 'KeyR'].includes(e.code)) queuedCast = e.code.slice(3).toLowerCase() as AbilitySlot;
} });
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); attacking = false; queuedCast = undefined; if (pointer !== null)
    finishStroke(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden)
    { keys.clear(); attacking = false; queuedCast = undefined; } });
let previous = performance.now();
function frame(now: number): void { const dt = Math.min(.05, (now - previous) / 1000); previous = now; if (!preview && animatedAssets && !document.hidden) draw(); if (preview && previewRenderer && !document.hidden) {
    const held = (...codes: string[]) => Number(codes.some(c => keys.has(c)));
    const dx = held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft'), dy = held('KeyS', 'ArrowDown') - held('KeyW', 'ArrowUp');
    const cast: AbilitySlot | undefined = queuedCast ?? (keys.has('KeyQ') ? 'q' : keys.has('KeyE') ? 'e' : keys.has('KeyR') ? 'r' : attacking || keys.has('Space') ? 'basic' : undefined);
    if (preview.step(dt, { dx, dy, aim, ...(cast ? { cast } : {}) })) queuedCast = undefined;
    const sim = preview.simulation, player = preview.player, encounters = [...sim.bosses.values()];
    previewRenderer.render({ time: sim.now, self: player, actors: [...sim.players.values(), ...sim.npcs.values()], projectiles: [...sim.projectiles.values()], pickups: [...sim.pickups.values()], traps: [...sim.traps.values()], events: sim.events,
        bossPreparations: encounters.flatMap(e => e.preparationFor(player) ?? []), bossLocks: encounters.map(e => e.lockState(player)), bossWindups: encounters.flatMap(e => e.windup ? [e.windup] : []), goldDrops: encounters.flatMap(e => e.state.drops), selectedId: null, previewClass: player.classId, playing: true });
    const state = player.hp <= 0 ? 'Sei morto · ingressi riaperti · rinascita tra pochi secondi' : encounters.some(e => e.ownerId) ? 'Dungeon attivo · ingressi chiusi' : encounters.every(e => e.boss.hp <= 0) ? 'Dungeon completato · ingressi riaperti' : 'Entra e raggiungi un punto di attivazione o il raggio aggro di un boss';
    el('playtest-status').textContent = `${state} | HP ${Math.ceil(player.hp)}/${player.maxHp} · ${CLASSES[player.classId].resource} ${Math.floor(player.resource)}/${player.maxResource}${player.effects.length ? ` · ${player.effects.map(e => e.kind).join(', ')}` : ''}`;
    for (const b of el('playtest-abilities').querySelectorAll<HTMLButtonElement>('button')) {
        const slot = b.dataset.slot as AbilitySlot, ability = CLASSES[player.classId].abilities[slot], remaining = Math.max(0, (player.cooldowns[slot] - sim.now) / 1000);
        b.textContent = `${slot === 'basic' ? 'Spazio' : slot.toUpperCase()} · ${ability.name}${remaining ? ` · ${remaining.toFixed(1)}s` : ''} · costo ${ability.cost}`;
    }
} requestAnimationFrame(frame); }
new ResizeObserver(() => { const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1); canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); fit(); }).observe(canvas);
refresh();
setTool(tool);
fit();
if (storageError)
    status(storageError);
requestAnimationFrame(frame);
async function refreshSharedAssets(): Promise<void> {
    try {
        const response = await fetch('/__world/project');
        if (response.ok) {
            const project = await response.json(), local = await loadWorldCheckpoint();
            sharedAssets = local && local.revision === project.revision ? local.document.assets : parseWorldDocument(project.document).assets;
        }
        const library = await fetch('/__studio/library', { cache: 'no-store' });
        if (library.ok) {
            const actors = (await library.json()).actors;
            if (actors) {
                const bosses = parseActorCatalog(actors).bosses;
                (BOSS_DEFINITIONS as typeof bosses).splice(0, BOSS_DEFINITIONS.length, ...bosses);
                BOSS_TEMPLATE_BY_ID.clear(); for (const b of bosses) BOSS_TEMPLATE_BY_ID.set(b.id, b);
                refreshBossPalette();
                for (const entity of draft.entities) if (entity.kind === 'boss' && entity.inheritRadius)
                    entity.radius = BOSS_TEMPLATE_BY_ID.get(entity.template)?.radius ?? entity.radius;
            }
        }
        refresh();
    } catch { /* The published client uses the bundled shared catalog. */ }
}
if (studioChannel) studioChannel.onmessage = event => {
    if (event.data?.type === 'actors') { stopPreview(); void refreshSharedAssets(); }
    if (event.data?.type === 'assets') {
        try { const document = newWorldDocument(); document.assets = event.data.assets; sharedAssets = parseWorldDocument(document).assets; stopPreview(); refresh(); } catch { /* Ignore invalid catalog updates. */ }
    }
};
window.addEventListener('focus', () => { void refreshSharedAssets(); });
void refreshSharedAssets().then(() => setupDungeonLibrary(() => draft, incoming => { change(() => { draft = incoming; selected = null; }); fit(); status('Dungeon aperto dal catalogo. Modifica e premi Aggiorna bozza installata.'); }, status, refreshBossPalette));
el("entity-inherit-radius").addEventListener("change", () => change(() => { const e=draft.entities.find(e=>e.id===selected); if(!e) return; e.inheritRadius=input("entity-inherit-radius").checked; if(e.inheritRadius) e.radius=BOSS_DEFINITIONS.find(b=>b.id===e.template)?.radius??e.radius; }));
