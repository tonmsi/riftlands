import './player-editor.css';
import { ACTOR_CATALOG, DEFAULT_PLAYER_DRAW_SIZE, parseActorCatalog, playerDrawSize, type ActorCatalog } from '../../../shared/actor-catalog';
import { CLASSES, PLAYER_RADIUS } from '../../../shared/config';
import type { Actor, ClassId } from '../../../shared/types';
import { ActorRenderer } from '../../render/actor-renderer';

export function installPlayerEditor(): void {
  const opener = document.createElement('button'); opener.id = 'open-player-editor'; opener.className = 'wide'; opener.textContent = 'Player · dimensioni sprite';
  document.getElementById('open-npc-editor')!.before(opener);
  const dialog = document.createElement('dialog'); dialog.id = 'player-editor';
  dialog.innerHTML = `<header><div><h2>Player · dimensioni sprite</h2><p>Una dimensione per classe, applicata a tutti i player di quella classe. Hitbox e statistiche restano indipendenti.</p></div><button id="player-close">Chiudi</button></header>
    <div class="player-workspace"><aside><label>Classe<select id="player-class">${Object.values(CLASSES).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></label>
    <label>Larghezza sprite · px<input id="player-size" type="number" min="8" max="1000" step="1"></label><button id="player-reset">Ripristina 48 px</button>
    <label>Direzione<select id="player-direction"><option value="0">Giù</option><option value="1">Su</option><option value="2">Destra</option><option value="3">Sinistra</option></select></label>
    <label><input id="player-moving" type="checkbox" checked>Camminata</label><button id="player-reload">Ricarica catalogo</button></aside>
    <section><canvas id="player-canvas" width="640" height="360" aria-label="Confronto tra player e Nereo con lo stesso zoom"></canvas><p>Player a sinistra, Nereo a destra: stesso zoom. I cerchi rossi mostrano le hitbox. L’anteprima si adatta automaticamente alle dimensioni.</p><output id="player-preview-size"></output></section></div>
    <footer><span id="player-status" role="status"></span><button id="player-save">Salva dimensioni player</button></footer>`;
  document.body.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(`#player-${id}`)!;
  const status = (message: string) => { el('status').textContent = message; };
  const report = (error: unknown) => status(error instanceof Error ? error.message : String(error));
  const classId = () => el<HTMLSelectElement>('class').value as ClassId;
  const canvas = el<HTMLCanvasElement>('canvas'), ctx = canvas.getContext('2d')!;
  let renderer: ActorRenderer | undefined, catalog: ActorCatalog = structuredClone(ACTOR_CATALOG), revision = '', token = '', dirty = false, ready = false, raf = 0;
  function refresh() { el<HTMLInputElement>('size').value = String(playerDrawSize(catalog, classId())); renderer?.setPlayerDrawSizes(catalog.playerDrawSizes ?? {}); el<HTMLButtonElement>('save').disabled = !ready; }
  async function load() {
    ready = false; el<HTMLButtonElement>('save').disabled = true;
    const response = await fetch('/__world/actors', { cache: 'no-store' });
    if (!response.ok) throw new Error('Apri il World Studio per salvare le dimensioni dei player.');
    const project = await response.json(); catalog = parseActorCatalog(project.catalog); revision = project.revision; token = project.token;
    renderer = new ActorRenderer(ctx, matchMedia('(pointer: coarse)')); await renderer.spritesReady;
    ready = true; dirty = false; refresh(); el<HTMLButtonElement>('save').disabled = false; status('Catalogo caricato.');
  }
  function editSize() {
    if (!ready) return;
    const size = Number(el<HTMLInputElement>('size').value);
    if (!Number.isFinite(size) || size < 8 || size > 1000) { status('Larghezza sprite: da 8 a 1000 px.'); el<HTMLButtonElement>('save').disabled = true; return; }
    (catalog.playerDrawSizes ??= {})[classId()] = size; dirty = true; el<HTMLButtonElement>('save').disabled = false;
    renderer?.setPlayerDrawSizes(catalog.playerDrawSizes); status('Modifiche da salvare.');
  }
  el('class').onchange = refresh; el('size').oninput = editSize;
  el('reset').onclick = () => { el<HTMLInputElement>('size').value = String(DEFAULT_PLAYER_DRAW_SIZE); editSize(); };
  el('reload').onclick = () => { if (!dirty || confirm('Scartare le modifiche alle dimensioni player?')) void load().catch(report); };
  el('save').onclick = () => { void (async () => {
    parseActorCatalog(catalog); el<HTMLButtonElement>('save').disabled = true;
    try {
      const response = await fetch('/__world/actors', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-World-Token': token }, body: JSON.stringify({ catalog, revision }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      catalog = parseActorCatalog(result.catalog); revision = result.revision; dirty = false;
      status('Dimensioni salvate con backup. Riavvia il gioco e ricarica la pagina per applicarle.');
      const channel = new BroadcastChannel('riftlands.studio'); channel.postMessage({ type: 'actors' }); channel.close();
    } finally { el<HTMLButtonElement>('save').disabled = !ready; }
  })().catch(report); };
  const player: Actor = { id: 'preview-player', kind: 'player', name: '', classId: 'mage', x: -72, y: 0, radius: PLAYER_RADIUS,
    hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, speed: 0, level: 1, xp: 0, kills: 0, deaths: 0,
    teamId: null, hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0, effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 } };
  const npc: Actor = { ...player, id: 'preview-npc', kind: 'npc', npcKind: 'old-fisher', classId: 'warrior', x: 72, radius: 18 };
  function draw(time: number) {
    if (!dialog.open) return;
    ctx.fillStyle = '#426849'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (ready && renderer) {
      player.classId = classId(); player.spriteRow = npc.spriteRow = Number(el<HTMLSelectElement>('direction').value);
      player.spriteMoving = npc.spriteMoving = el<HTMLInputElement>('moving').checked;
      const size = playerDrawSize(catalog, player.classId);
      const npcSize = catalog.skins[catalog.npcSkins?.['old-fisher'] ?? 'npc-old-fisher']?.drawSize ?? 48;
      const scale = Math.min(2, 210 / Math.max(size, npcSize));
      player.x = -(size + 36) / 2; npc.x = (npcSize + 36) / 2;
      ctx.save(); ctx.translate(320, 170); ctx.scale(scale, scale);
      renderer.drawActor(player, time, false, false, false, new Set()); renderer.drawActor(npc, time, false, false, false, new Set());
      ctx.strokeStyle = '#ffad98'; ctx.lineWidth = 1 / scale;
      for (const actor of [player, npc]) { ctx.beginPath(); ctx.arc(actor.x, 0, actor.radius, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore(); el('preview-size').textContent = `${CLASSES[player.classId].name}: ${size} px · hitbox ${PLAYER_RADIUS} px. Nereo: ${npcSize} px.`;
    }
    raf = requestAnimationFrame(draw);
  }
  function close() { if (!dirty || confirm('Chiudere senza salvare le dimensioni player?')) dialog.close(); }
  el('close').onclick = close; dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => cancelAnimationFrame(raf)); dialog.addEventListener('keydown', event => event.stopPropagation());
  opener.onclick = () => { dialog.showModal(); ready = false; status('Caricamento…'); raf = requestAnimationFrame(draw); void load().catch(report); };
}
