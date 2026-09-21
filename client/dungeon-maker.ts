import { setupDungeonLibrary } from './dungeon-library';
import './dungeon-maker.css';
import { chooseDungeonPlacement } from './dungeon-placement';
import { parseDungeonFile } from '../shared/dungeon-import';
import { BOSS_TEMPLATES as BOSS_DEFINITIONS } from '../shared/boss-templates';
import { DUNGEON_DEFINITIONS, flameBarrierFromTiles, inwardFlameAngle } from '../shared/dungeons';
import { NPC_CATALOG, type NpcKind } from '../shared/npcs';
import { CLASSES } from '../shared/config';
import { createDungeonPlaytest, type DungeonPlaytest } from './dungeon-playtest';
import { Renderer } from './render';
import { DEFAULT_BOSS_AGGRO_RADIUS, PICKUP_CATALOG, compileDungeonDraft, draftFlameTiles, draftFromDungeon, newDungeonDraft, parseDungeonDraft, TERRAIN_CATALOG, validateDungeonDraft, type DraftEntity, type DungeonDraft } from '../shared/dungeon-draft';
import type { AbilitySlot, ClassId, PickupKind, TileKind, Vec2 } from '../shared/types';
const root = document.querySelector<HTMLDivElement>('#maker')!;
const field = (id: string, label: string, type = 'text') => `<label>${label}<input id="${id}" type="${type}"></label>`;
root.innerHTML = `
<header><a href="/" class="brand">◇ RIFTLANDS <span>/ STUDIO</span></a><span class="local-badge">Bozza locale</span><a href="/">Torna al gioco ↗</a></header>
<div class="title-row"><div><span class="eyebrow">WORLD BUILDING / 01</span><h1>Dungeon maker<span>.</span></h1><p>Disegna il terreno. Popola la mappa. Prepara gli incontri.</p></div><div class="file-actions"><button id="import">Importa dungeon</button><button id="download">Salva dungeon</button><button id="compile" class="primary">Esporta runtime (avanzato)</button></div></div>
<main><aside class="palette panel"><h2>01 <span>Strumenti</span></h2><div class="tool-grid"><button data-tool="select">↖ Seleziona</button><button data-tool="erase">⌫ Rimuovi entità</button></div><h3>Terreno</h3><div id="terrain" class="tool-grid"></div><h3>Creature</h3><div id="npcs" class="tool-list"></div><h3>Boss disponibili</h3><div id="bosses" class="tool-list"></div><h3>Incontro</h3><div class="tool-list"><button data-tool="boss">◇ Boss / segnaposto</button><button data-tool="party">⊕ Spawn gruppo</button><button data-tool="activation">◇ Punto di attivazione</button><button data-tool="flame">Fiamme</button><button data-tool="visitors">▧ Zona visitatori</button><button data-tool="visitors-erase">Cancella zona visitatori</button></div><p class="hint">Blu trasparente: zona accessibile a nemici e compagni esclusi dallo scontro, per l’incontro selezionato. Fuori dalla zona vengono espulsi. Trascina per dipingere o spostare. Rotella per zoom; tasto destro per spostare la vista.</p></aside>
<section class="workspace panel"><div class="canvas-toolbar"><div><button id="undo" aria-label="Annulla modifica">↶</button><button id="redo" aria-label="Ripeti modifica">↷</button></div><span id="tool-name"></span><div><button id="zoom-out">−</button><button id="fit">Adatta</button><button id="zoom-in">+</button></div></div><div class="viewport"><canvas id="map" tabindex="0" aria-label="Mappa dungeon modificabile"></canvas><div id="preview-label" hidden>ANTEPRIMA MOVIMENTO · WASD / FRECCE · ESC PER USCIRE</div></div><div class="canvas-footer"><span id="map-info"></span><button id="preview">Prova movimento</button></div></section>
<aside class="inspector panel"><section id="dungeon-library" hidden><h2>Catalogo installato</h2><select aria-label="Dungeon installato"></select><div class="tool-list"><button data-library="open">Apri nel maker</button><button data-action="install">Installa bozza</button><button data-action="update">Aggiorna bozza installata</button><button data-action="remove">Elimina dungeon selezionato</button></div><p class="hint">Modifiche locali a server fermo. Aggiornare azzera lo stato dei boss del dungeon.</p></section><section id="dungeon-backups" hidden><h2>Backup locali</h2><label>Backup da eliminare<select id="backup-scope"></select></label><p id="backup-summary" class="hint"></p><details><summary>File inclusi</summary><ul id="backup-files"></ul></details><button id="delete-backups">Elimina backup selezionati</button><p class="hint">Elimina solo le copie di recupero. Catalogo e account attuali restano invariati. I backup sono copie complete dei file, anche quando associati a un solo dungeon.</p></section><h2>02 <span>Proprietà</span></h2>${field('name', 'Nome dungeon')}${field('map-id', 'ID mappa')}<button id="world-placement">Scegli sulla mappa del mondo</button><details><summary>Coordinate avanzate</summary><div class="two-fields">${field('origin-x', 'Origine X (tile)', 'number')}${field('origin-y', 'Origine Y (tile)', 'number')}</div></details><h3>Incontri</h3><label>Incontro attivo<select id="encounter"></select></label><button id="add-encounter">Nuovo incontro separato</button><button id="remove-encounter">Rimuovi incontro vuoto</button>${field('encounter-name', 'Nome incontro')}<div class="two-fields">${field('encounter-x', 'Colonna regione', 'number')}${field('encounter-y', 'Riga regione', 'number')}${field('encounter-width', 'Larghezza', 'number')}${field('encounter-height', 'Altezza', 'number')}</div><p class="hint">Zona visitatori blu: accesso durante lo scontro senza diventare partecipanti. Più boss nello stesso incontro: fiamme fino alla morte dell’ultimo. Incontri separati: regioni senza sovrapposizioni.</p>
<div id="entity-properties" hidden><h3>Entità selezionata</h3>${field('entity-label', 'Etichetta')}<div class="two-fields">${field('entity-x', 'Colonna', 'number')}${field('entity-y', 'Riga', 'number')}</div><div id="level-label">${field('entity-level', 'Livello', 'number')}</div><label id="template-label">Boss<select id="entity-template"><option value="">Segnaposto · da creare</option></select></label><div id="radius-label">${field('entity-radius', 'Raggio boss', 'number')}</div><div id="aggro-label">${field('entity-aggroRadius', 'Raggio aggro (unità; 48 = 1 tile)', 'number')}</div><label id="entity-encounter-label">Incontro dell’entità<select id="entity-encounter"></select></label><div id="flame-properties">${field('entity-span', 'Lunghezza (tile)', 'number')}<label>Direzione<select id="entity-vertical"><option value="false">Orizzontale</option><option value="true">Verticale</option></select></label></div><button id="delete">Rimuovi entità</button></div><h3>Controllo mappa</h3><ul id="issues"></ul><p class="hint">Installa la bozza nel progetto: npm run dungeon:import -- percorso/file.draft.json. Poi ricompila e riavvia. I segnaposto richiedono un boss implementato. Punti di attivazione o aggro avviano il dungeon: subito in solo, dopo 5 secondi in gruppo. All’avvio i giocatori vengono posizionati sugli spawn gruppo (metti 5 punti distinti per un team completo). I boss lontani attendono il proprio aggro. I punti di attivazione non hanno il limite di 5. Le fiamme appaiono solo dove le disegni, puntano verso l’interno e sono letali durante lo scontro. Per gestire il catalogo direttamente qui: npm run dungeon:studio.</p></aside></main>
<footer><div class="new-map"><label>Nuova mappa <input id="width" type="number" value="24" min="8" max="96"> × <input id="height" type="number" value="18" min="8" max="96"></label><button id="new">Crea</button><select id="example"><option value="">Copia da catalogo…</option></select></div><span id="status" role="status">Pronto</span></footer><input id="file" type="file" accept=".json,application/json" hidden>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const value = (id: string) => input(id).value;
const button = (id: string, action: () => void) => el(id).addEventListener('click', action);
const status = (message: string) => { el('status').textContent = message; };
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
rules.textContent = 'Gli ingressi, anche in erba, si chiudono automaticamente con massi durante lo scontro. Il terreno originale ritorna alla vittoria o alla morte di un partecipante. In solo l’avvio è immediato; in gruppo ci sono 5 secondi per entrare. Gli spawn gruppo determinano la posizione iniziale dei partecipanti. I boss lontani attendono il proprio aggro. Le fiamme sono letali e compaiono solo durante lo scontro: puoi disporle liberamente all’interno o usare il posizionamento casuale. Clicca un errore per vedere i punti coinvolti e come correggerlo. La prova locale usa il combattimento del gioco e non salva progressi.';
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
for (const [id, item] of Object.entries(NPC_CATALOG))
    palette('npcs', item.name, `npc:${id}`, item.color);
for (const [id, item] of Object.entries(PICKUP_CATALOG))
    palette('pickups', item.name, `pickup:${id}`, item.color);
for (const boss of BOSS_DEFINITIONS) {
    palette('bosses', boss.name, `boss:${boss.id}`, '#df946f');
    el<HTMLSelectElement>('entity-template').add(new Option(boss.name, boss.id));
}
for (const dungeon of DUNGEON_DEFINITIONS)
    el<HTMLSelectElement>('example').add(new Option(dungeon.name, dungeon.id));
function save(): void { try {
    localStorage.setItem(KEY, JSON.stringify(draft));
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
function setTool(next: string): void { stopPreview(); tool = next; root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.tool === tool)); if (b.dataset.tool === tool)
    el('tool-name').textContent = b.textContent; }); }
root.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool!)));
function refresh(): void {
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
    for (const axis of ['x', 'y'] as const)
        input(`origin-${axis}`).value = String(draft.origin[axis]);
    el<HTMLButtonElement>('undo').disabled = !past.length;
    el<HTMLButtonElement>('redo').disabled = !future.length;
    el('map-info').textContent = `${draft.width} × ${draft.height} caselle · ${draft.entities.length} entità · 48 unità / casella`;
    const e = draft.entities.find(e => e.id === selected);
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
        el('template-label').hidden = el('radius-label').hidden = e.kind !== 'boss';
        el('entity-encounter-label').hidden = e.kind === 'npc' || e.kind === 'pickup';
        el('flame-properties').hidden = e.kind !== 'flame';
    }
    const issues = validateDungeonDraft(draft);
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
        : 'Posiziona da uno a cinque spawn gruppo liberi e distinti nella regione dell’incontro.';
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
        ctx.fillStyle = e.kind === 'boss' ? '#df946f' : e.kind === 'party' ? '#7fe0d3' : e.kind === 'activation' ? '#d4b5ff' : e.kind === 'pickup' ? PICKUP_CATALOG[e.template as PickupKind].color : NPC_CATALOG[e.template as NpcKind].color;
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
}
function tileAt(event: PointerEvent): Vec2 { const r = canvas.getBoundingClientRect(); return { x: Math.floor((event.clientX - r.left - view.x) / view.scale), y: Math.floor((event.clientY - r.top - view.y) / view.scale) }; }
function paint(p: Vec2): void {
    if (p.x < 0 || p.y < 0 || p.x >= draft.width || p.y >= draft.height)
        return;
    const existing = draft.entities.find(e => e.kind === 'flame' ? draftFlameTiles(e).some(t => t.x === p.x && t.y === p.y) : e.x === p.x && e.y === p.y);
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
    }
    else if (tool === 'select') {
        const e = draft.entities.find(e => e.id === selected);
        if (e && lastTile)
            Object.assign(e, p);
        else if (!lastTile)
            selected = existing?.id ?? null;
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
        const npc = kind === 'npc' ? NPC_CATALOG[template as NpcKind] : undefined, boss = BOSS_DEFINITIONS.find(b => b.id === template);
        const e: DraftEntity = { id: crypto.randomUUID(), kind, template, label: npc?.name ?? boss?.name ?? (kind === 'boss' ? 'Boss da creare' : kind === 'flame' ? 'Fiamme' : kind === 'activation' ? 'Punto di attivazione' : 'Spawn gruppo'), ...p, level: 1, radius: npc?.radius ?? boss?.radius ?? (kind === 'boss' ? 36 : 15), ...(kind !== 'npc' ? { encounterId: activeEncounter } : {}), ...(kind === 'boss' ? { aggroRadius: DEFAULT_BOSS_AGGRO_RADIUS } : {}), ...(kind === 'flame' ? { span: 1, vertical: false } : {}) };
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
    if (cancelled)
        draft = stroke;
    else
        commit(stroke);
} stroke = null; lastTile = null; pointer = null; pan = null; refresh(); }
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
for (const axis of ['x', 'y'] as const)
    input(`origin-${axis}`).addEventListener('change', () => change(() => { draft.origin[axis] = Number(value(`origin-${axis}`)); }));
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
        e[f] = Number(value(`entity-${f}`)); if (f === 'template') {
        const b = BOSS_DEFINITIONS.find(b => b.id === e.template);
        if (b) {
            e.label = b.name;
            e.radius = b.radius;
        }
    } }));
const remove = () => change(() => { draft.entities = draft.entities.filter(e => e.id !== selected); selected = null; });
button('delete', remove);
button('new', () => { change(() => { draft = newDungeonDraft(Number(value('width')), Number(value('height'))); selected = null; }); fit(); });
el('example').addEventListener('change', () => { const d = DUNGEON_DEFINITIONS.find(d => d.id === value('example')); if (!d)
    return; change(() => { draft = draftFromDungeon(d, BOSS_DEFINITIONS.find(b => b.id === d.bossId)?.radius); selected = null; }); fit(); status('Geometria copiata: verifica regioni e ingressi prima di esportare.'); input('example').value = ''; });
function download(data: unknown, name: string): void { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
button('download', () => download(draft, `${draft.id}.draft.json`));
button('compile', () => { try {
    download(compileDungeonDraft(draft), `${draft.id}.runtime.json`);
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
    const imported = parseDungeonFile(await file.text());
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
        preview = createDungeonPlaytest(draft, value('preview-class') as ClassId);
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
    return; if (e.key === 'Escape')
    stopPreview(); if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
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
function frame(now: number): void { const dt = Math.min(.05, (now - previous) / 1000); previous = now; if (preview && previewRenderer && !document.hidden) {
    const held = (...codes: string[]) => Number(codes.some(c => keys.has(c)));
    const dx = held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft'), dy = held('KeyS', 'ArrowDown') - held('KeyW', 'ArrowUp');
    const cast: AbilitySlot | undefined = queuedCast ?? (keys.has('KeyQ') ? 'q' : keys.has('KeyE') ? 'e' : keys.has('KeyR') ? 'r' : attacking || keys.has('Space') ? 'basic' : undefined);
    if (preview.step(dt, { dx, dy, aim, ...(cast ? { cast } : {}) })) queuedCast = undefined;
    const sim = preview.simulation, player = preview.player, encounters = [...sim.bosses.values()];
    previewRenderer.render({ time: sim.now, self: player, actors: [...sim.players.values(), ...sim.npcs.values()], projectiles: [...sim.projectiles.values()], pickups: [...sim.pickups.values()], traps: [...sim.traps.values()], events: sim.events,
        bossLocks: encounters.map(e => e.lockState(player)), bossWindups: encounters.flatMap(e => e.windup ? [e.windup] : []), goldDrops: encounters.flatMap(e => e.state.drops), selectedId: null, previewClass: player.classId, playing: true });
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

button('world-placement', () => {
    stopPreview();
    void chooseDungeonPlacement(draft).then(origin => {
        if (origin) change(() => { draft.origin = origin; });
    });
});

void setupDungeonLibrary(() => draft, incoming => { change(() => { draft = incoming; selected = null; }); fit(); status("Dungeon aperto dal catalogo. Modifica e premi Aggiorna bozza installata."); }, status);
