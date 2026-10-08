import './boss-editor.css';
import { ACTOR_CATALOG, parseActorCatalog, type ActorCatalog, type ActorVisual } from '../../../shared/actor-catalog';
import { ActorSpriteRenderer } from '../../render/actor-sprite-renderer';
import { animationFrame } from '../../render/actor-animation';
import { resolveAnimation } from '../../render/actor-animation';
import { NPC_DEFINITIONS, type NpcTemplateId } from '../../../shared/npcs';

const field = (id: string, label: string, step = '1') => `<label>${label}<input id="boss-${id}" type="number" step="${step}"></label>`;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function installActorEditor(): void {
  const dialog = document.createElement('dialog'); dialog.id = 'boss-editor';
  dialog.innerHTML = `<header><div><h2>Boss · laboratorio visuale</h2><p>Anteprima con il renderer del gioco. Le modifiche al catalogo valgono per tutti i dungeon che lo ereditano.</p></div><button id="boss-close">Chiudi</button></header>
    <div class="boss-workspace"><aside><label>Boss<select id="boss-select"></select></label><div class="pair"><button id="boss-duplicate">Nuovo da questo</button><button id="boss-reload">Ricarica</button></div>
    <h3>Personaggio</h3><label>Nome<input id="boss-name" maxlength="80"></label><label>Skin<select id="boss-skin"></select></label>
    <div class="pair">${field('hp', 'Vita')}${field('speed', 'Velocità')}${field('level', 'Livello')}${field('radius', 'Raggio hitbox', '.5')}${field('respawnMs', 'Respawn · ms')}${field('gold', 'Ricompensa gold')}</div>
    <h3>Sprite e ancoraggio</h3><div class="pair">${field('drawSize', 'Larghezza sprite · px')}${field('anchorX', 'Anchor X · 0–1', '.01')}${field('anchorY', 'Anchor Y · 0–1', '.01')}${field('offsetX', 'Offset X · px')}${field('offsetY', 'Offset Y · px')}</div>
    <h3>Ombra</h3><div class="pair">${field('shadowX', 'Posizione X')}${field('shadowY', 'Posizione Y')}${field('shadowWidth', 'Raggio orizzontale')}${field('shadowHeight', 'Raggio verticale')}${field('shadowOpacity', 'Opacità · 0–1', '.01')}</div>
    <h3>Attacchi</h3><label>Attacco<select id="boss-attack"></select></label><div class="pair">${field('damage', 'Danno')}${field('range', 'Portata')}${field('attackRadius', 'Raggio effetto')}${field('windupMs', 'Preparazione · ms')}${field('cooldownMs', 'Intervallo · ms')}</div>
    </aside><section class="boss-preview"><canvas id="boss-canvas" width="780" height="660" aria-label="Anteprima boss con ombra, hitbox e anchor"></canvas><div class="boss-controls"><button id="boss-play">Pausa</button><label>Direzione<select id="boss-direction"><option value="0">Giù</option><option value="1">Su</option><option value="2">Destra</option><option value="3">Sinistra</option></select></label><label>Zoom<select id="boss-zoom"><option value="1">100%</option><option value="2" selected>200%</option><option value="3">300%</option></select></label><label><input id="boss-hitbox" type="checkbox" checked>Hitbox</label><label><input id="boss-anchor" type="checkbox" checked>Anchor</label></div><p>Rosso: collisione. Croce bianca: posizione nel mondo. Trascina sullo sprite per impostare l’anchor dell’animazione o della skin.</p><output id="boss-frame"></output></section>
    <aside><h3>Animazioni</h3><label>Animazione<select id="boss-animation"></select></label><label>Spritesheet<select id="boss-asset"></select></label><button id="boss-import">Importa spritesheet PNG / SVG</button><input id="boss-file" type="file" accept=".png,.svg,image/png,image/svg+xml" hidden>
    <div class="pair">${field('columns', 'Colonne')}${field('rows', 'Righe')}${field('frameMs', 'Tempo frame · ms')}${field('durationMs', 'Durata totale · ms')}</div>
    <label><input id="boss-directional" type="checkbox">4 direzioni, una per riga</label><label><input id="boss-loop" type="checkbox">Ripeti animazione</label><label><input id="boss-animation-offset" type="checkbox">Anchor e offset propri dell’animazione</label>
    <div class="pair">${field('animationAnchorX', 'Anchor X', '.01')}${field('animationAnchorY', 'Anchor Y', '.01')}${field('animationOffsetX', 'Offset X')}${field('animationOffsetY', 'Offset Y')}</div>
    <label>Nuova animazione<select id="boss-new-animation"><option>idle</option><option>walk</option><option>prep</option><option>melee</option><option>charge</option><option>slam</option><option>nova</option><option>death</option></select></label><button id="boss-add-animation">Aggiungi animazione</button>
    <p>Durante gli attacchi e il risveglio il gioco sincronizza la durata con la simulazione. La hitbox è indipendente dalla dimensione dello sprite.</p></aside></div>
    <footer><span id="boss-status" role="status"></span><button id="boss-save" class="primary">Salva catalogo boss</button></footer>`;
  document.body.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => dialog.querySelector<T>(`#boss-${id}`)!;
  const val = (id: string) => (el(id) as HTMLInputElement).value;
  const num = (id: string) => Number(val(id));
  const check = (id: string) => el<HTMLInputElement>(id).checked;
  const set = (id: string, v: unknown) => { (el(id) as HTMLInputElement).value = String(v ?? ''); };
  for (const [id, min, max] of [['columns', 1, 32], ['rows', 1, 32], ['frameMs', 10, 10000], ['durationMs', 50, 60000]] as const) {
    el<HTMLInputElement>(id).min = String(min); el<HTMLInputElement>(id).max = String(max);
  }
  const status = (s: string) => { el('status').textContent = s; };
  const report = (e: unknown) => status(e instanceof Error ? e.message : String(e));
  const options = (id: string, values: [string, string][]) => { el(id).innerHTML = values.map(([value, label]) => `<option value="${escape(value)}">${escape(label)}</option>`).join(''); };
  const canvas = el<HTMLCanvasElement>('canvas'), ctx = canvas.getContext('2d')!, sprites = new ActorSpriteRenderer();
  let catalog: ActorCatalog = structuredClone(ACTOR_CATALOG), assets: string[] = [], token = '', revision = '', dirty = false;
  let playing = true, startedAt = performance.now(), frame = 0, elapsed = 0, raf = 0;
  let npcMode = false;
  const npcDrafts = new Map<NpcTemplateId, { skin: string; visual: ActorVisual }>();
  const npcKind = () => val('select') as NpcTemplateId;
  const boss = () => {
    if (!npcMode) return catalog.bosses.find(b => b.id === val('select'))!;
    const kind = npcKind(), spec = NPC_DEFINITIONS[kind];
    return { ...catalog.bosses[0], id: kind, name: spec.name, radius: spec.radius, skin: catalog.npcSkins?.[kind] ?? npcDrafts.get(kind)?.skin ?? '' };
  };
  const visual = (): ActorVisual => catalog.skins[boss().skin] ?? npcDrafts.get(npcKind())!.visual;
  const animation = () => resolveAnimation(visual(), { name: val('animation'), elapsed: 0 })!.animation;
  const editableAnimation = () => {
    const name = val('animation'), v = visual();
    if (!v.animations[name]) { v.animations[name] = structuredClone(animation()!); v.animations[name].loop = name !== 'idle'; }
    return v.animations[name];
  };
  function choices() { options('select', npcMode ? Object.entries(NPC_DEFINITIONS).map(([id, n]) => [id, n.name]) : catalog.bosses.map(b => [b.id, b.name])); }
  function ensureNpcVisual() {
    if (!npcMode || catalog.npcSkins?.[npcKind()] || npcDrafts.has(npcKind())) return;
    let skin = `npc-${npcKind()}`, suffix = 2;
    while (catalog.skins[skin]) skin = `npc-${npcKind()}-${suffix++}`;
    npcDrafts.set(npcKind(), { skin, visual: structuredClone(ACTOR_CATALOG.skins['npc-old-fisher']) });
  }
  async function prepare() { try { await sprites.prepare(visual()); } catch (e) { report(e); } }
  function refreshAttack() {
    const a = boss().attacks[Number(val('attack'))];
    for (const key of ['damage', 'range', 'windupMs', 'cooldownMs'] as const) set(key, a[key]); set('attackRadius', a.radius);
  }
  function refreshAnimation() {
    const a = animation(), v = visual(); if (!a) return;
    options('asset', [...new Set([...assets, a.asset])].map(path => [path, path.split('/').at(-1)!])); set('asset', a.asset);
    for (const key of ['columns', 'rows', 'frameMs', 'durationMs'] as const) set(key, a[key]);
    el<HTMLInputElement>('directional').checked = a.directional; el<HTMLInputElement>('loop').checked = a.loop;
    el<HTMLInputElement>('animation-offset').checked = !!a.anchor || !!a.offset;
    const anchor = a.anchor ?? v.anchor, offset = a.offset ?? v.offset;
    set('animationAnchorX', anchor.x); set('animationAnchorY', anchor.y); set('animationOffsetX', offset.x); set('animationOffsetY', offset.y);
    for (const id of ['animationAnchorX', 'animationAnchorY', 'animationOffsetX', 'animationOffsetY']) el<HTMLInputElement>(id).disabled = !check('animation-offset');
    startedAt = performance.now(); elapsed = 0; void prepare();
  }
  function refresh() {
    ensureNpcVisual();
    const b = boss(), v = visual(); if (!b || !v) return;
    set('name', b.name); options('skin', Object.keys(catalog.skins).filter(id => npcMode || catalog.skins[id].animations.idle).map(id => [id, id])); set('skin', b.skin);
    for (const key of ['hp', 'speed', 'level', 'radius', 'respawnMs'] as const) set(key, b[key]); set('gold', b.reward.gold);
    set('drawSize', v.drawSize); set('anchorX', v.anchor.x); set('anchorY', v.anchor.y); set('offsetX', v.offset.x); set('offsetY', v.offset.y);
    for (const [id, key] of [['shadowX', 'x'], ['shadowY', 'y'], ['shadowWidth', 'width'], ['shadowHeight', 'height'], ['shadowOpacity', 'opacity']] as const) set(id, v.shadow[key]);
    options('animation', npcMode ? [['moving', 'moving · movimento'], ['idle', v.animations.idle ? 'idle · fermo' : 'idle · primo frame di moving (fallback)']] : Object.keys(v.animations).map(id => [id, id])); options('attack', b.attacks.map((a, i) => [String(i), `${i + 1} · ${a.kind}`]));
    refreshAnimation(); refreshAttack();
  }
  async function load() {
    const response = await fetch('/__world/actors', { cache: 'no-store' });
    if (!response.ok) throw new Error('Apri il World Studio per modificare e salvare i boss.');
    const project = await response.json(); catalog = parseActorCatalog(project.catalog); token = project.token; revision = project.revision; assets = project.assets;
    dirty = false; npcDrafts.clear(); choices(); if (npcMode) set('select', 'old-fisher'); refresh(); status('Catalogo caricato.');
  }
  function changed() {
    if (npcMode && !catalog.npcSkins?.[npcKind()]) {
      const draft = npcDrafts.get(npcKind())!;
      catalog.skins[draft.skin] = draft.visual;
      (catalog.npcSkins ??= {})[npcKind()] = draft.skin;
    }
    dirty = true; status('Modifiche da salvare.');
  }
  for (const id of ['hp', 'speed', 'level', 'radius', 'respawnMs']) el(id).addEventListener('input', () => {
    const b = boss(); (b as unknown as Record<string, unknown>)[id] = num(id);
    if (b.behavior.unstuck) b.behavior.unstuck.probeDistance = Math.max(b.behavior.unstuck.probeDistance, b.radius + 16); changed();
  });
  el('name').addEventListener('input', () => { boss().name = val('name'); changed(); });
  el('gold').addEventListener('input', () => { boss().reward.gold = num('gold'); changed(); });
  for (const id of ['drawSize', 'anchorX', 'anchorY', 'offsetX', 'offsetY', 'shadowX', 'shadowY', 'shadowWidth', 'shadowHeight', 'shadowOpacity']) el(id).addEventListener('input', () => {
    const v = visual(); v.drawSize = num('drawSize'); v.anchor = { x: num('anchorX'), y: num('anchorY') }; v.offset = { x: num('offsetX'), y: num('offsetY') };
    v.shadow = { x: num('shadowX'), y: num('shadowY'), width: num('shadowWidth'), height: num('shadowHeight'), opacity: num('shadowOpacity') }; changed();
  });
  for (const id of ['damage', 'range', 'attackRadius', 'windupMs', 'cooldownMs']) el(id).addEventListener('input', () => {
    const a = boss().attacks[Number(val('attack'))]; a.damage = num('damage'); a.range = num('range'); a.radius = num('attackRadius'); a.windupMs = num('windupMs'); a.cooldownMs = num('cooldownMs'); changed();
  });
  for (const id of ['asset', 'columns', 'rows', 'frameMs', 'durationMs', 'directional', 'loop', 'animation-offset', 'animationAnchorX', 'animationAnchorY', 'animationOffsetX', 'animationOffsetY']) el(id).addEventListener('change', () => {
    const a = editableAnimation(); a.asset = val('asset'); a.columns = num('columns'); a.rows = num('rows'); a.directional = check('directional'); a.loop = check('loop');
    if (val('frameMs')) a.frameMs = num('frameMs'); else delete a.frameMs;
    if (val('durationMs')) a.durationMs = num('durationMs'); else delete a.durationMs;
    if (check('animation-offset')) { a.anchor = { x: num('animationAnchorX'), y: num('animationAnchorY') }; a.offset = { x: num('animationOffsetX'), y: num('animationOffsetY') }; }
    else { delete a.anchor; delete a.offset; }
    changed(); refreshAnimation();
  });
  el('select').addEventListener('change', refresh); el('animation').addEventListener('change', refreshAnimation); el('attack').addEventListener('change', refreshAttack);
  el('skin').addEventListener('change', () => { if (npcMode) catalog.npcSkins![npcKind()] = val('skin'); else boss().skin = val('skin'); changed(); refresh(); });
  el('add-animation').onclick = () => { const name = val('new-animation'); if (!visual().animations[name]) visual().animations[name] = structuredClone(animation()); changed(); refresh(); set('animation', name); refreshAnimation(); };
  el('duplicate').onclick = () => {
    const id = prompt('ID del nuovo boss (lettere minuscole, numeri e trattini):'); if (!id) return;
    if (!/^[a-z0-9-]{1,64}$/.test(id) || catalog.bosses.some(b => b.id === id) || catalog.skins[id]) { status('ID già usato o non valido.'); return; }
    const b = structuredClone(boss()); catalog.skins[id] = structuredClone(visual()); b.id = id; b.skin = id; b.name = id; catalog.bosses.push(b);
    options('select', catalog.bosses.map(b => [b.id, b.name])); set('select', id); changed(); refresh();
  };
  el('play').onclick = () => { playing = !playing; startedAt = performance.now() - elapsed; el('play').textContent = playing ? 'Pausa' : 'Riprendi'; };
  el('reload').onclick = () => { if (!dirty || confirm('Scartare le modifiche al catalogo?')) void load().catch(report); };
  el('save').onclick = () => { void (async () => {
    parseActorCatalog(catalog); await sprites.prepare(visual());
    el<HTMLButtonElement>('save').disabled = true;
    try {
      const response = await fetch('/__world/actors', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-World-Token': token }, body: JSON.stringify({ catalog, revision }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      catalog = parseActorCatalog(result.catalog); revision = result.revision; dirty = false; status('Catalogo salvato con backup. Riavvia il server e ricarica il gioco.');
      const channel = new BroadcastChannel('riftlands.studio'); channel.postMessage({ type: 'actors' }); channel.close();
    } finally { el<HTMLButtonElement>('save').disabled = false; }
  })().catch(report); };
  el('import').onclick = () => el<HTMLInputElement>('file').click();
  el('file').addEventListener('change', () => { void (async () => {
    const file = el<HTMLInputElement>('file').files?.[0]; if (!file) return;
    const reader = new FileReader(), base64 = await new Promise<string>((resolve, reject) => { reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    const response = await fetch('/__world/actor-images', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-World-Token': token }, body: JSON.stringify({ mime: file.type || (file.name.endsWith('.svg') ? 'image/svg+xml' : 'image/png'), base64, filename: file.name }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); assets.push(result.image); editableAnimation().asset = result.image; changed(); refreshAnimation();
  })().catch(report); });
  let drag: { x: number; y: number; width: number; height: number } | undefined;
  function pointer(event: PointerEvent) {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect(), zoom = num('zoom');
    const x = (event.clientX - rect.left) * canvas.width / rect.width, y = (event.clientY - rect.top) * canvas.height / rect.height;
    const anchor = { x: Math.max(0, Math.min(1, ((x - 390) / zoom - drag.x) / drag.width)), y: Math.max(0, Math.min(1, ((y - 390) / zoom - drag.y) / drag.height)) };
    if (check('animation-offset')) { editableAnimation().anchor = anchor; set('animationAnchorX', anchor.x.toFixed(3)); set('animationAnchorY', anchor.y.toFixed(3)); }
    else { visual().anchor = anchor; set('anchorX', anchor.x.toFixed(3)); set('anchorY', anchor.y.toFixed(3)); }
    changed();
  }
  canvas.addEventListener('pointerdown', event => { drag = sprites.bounds(visual(), animation()); canvas.setPointerCapture(event.pointerId); pointer(event); });
  canvas.addEventListener('pointermove', pointer); canvas.addEventListener('pointerup', () => { drag = undefined; }); canvas.addEventListener('pointercancel', () => { drag = undefined; });
  function draw(now: number) {
    if (!dialog.open) return;
    const b = boss(), v = b ? visual() : undefined, a = v ? animation() : undefined;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#426849'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (v && a) {
      if (playing) elapsed = now - startedAt;
      ctx.save(); ctx.translate(390, 390); ctx.scale(num('zoom'), num('zoom'));
      ctx.strokeStyle = '#ffffff12'; ctx.lineWidth = .5;
      for (let i = -400; i <= 400; i += 24) { ctx.beginPath(); ctx.moveTo(i, -400); ctx.lineTo(i, 400); ctx.moveTo(-400, i); ctx.lineTo(400, i); ctx.stroke(); }
      if (v.shadow.width >= 0 && v.shadow.height >= 0) sprites.drawShadow(ctx, v);
      if (Number.isFinite(v.drawSize)) sprites.draw(ctx, v, { name: val('animation'), elapsed }, num('direction'));
      if (check('hitbox') && b.radius > 0) { ctx.strokeStyle = '#ffad98'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, b.radius, 0, Math.PI * 2); ctx.stroke(); }
      if (check('anchor')) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.moveTo(0, -6); ctx.lineTo(0, 6); ctx.stroke(); }
      ctx.restore(); const resolved = resolveAnimation(v, { name: val('animation'), elapsed })!; frame = animationFrame(resolved.animation, resolved.state, num('direction'));
      el('frame').textContent = `Frame ${frame + 1} / ${a.columns * a.rows} · ${v.drawSize} px · hitbox ${b.radius} px`;
    }
    raf = requestAnimationFrame(draw);
  }
  function close() { if (!dirty || confirm('Chiudere senza salvare le modifiche al catalogo?')) dialog.close(); }
  el('close').onclick = close; dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); dialog.addEventListener('close', () => cancelAnimationFrame(raf));
  dialog.addEventListener('keydown', event => event.stopPropagation());
  function open(npcs: boolean) {
    npcMode = npcs;
    dialog.classList.toggle('npc-mode', npcs);
    dialog.querySelector('h2')!.textContent = npcs ? 'NPC · laboratorio visuale' : 'Boss · laboratorio visuale';
    dialog.querySelector('header p')!.textContent = npcs ? 'Personalizza ogni tipo di NPC, amici e mob. Le modifiche valgono per tutti gli NPC di quel tipo.' : 'Anteprima con il renderer del gioco. Le modifiche al catalogo valgono per tutti i dungeon che lo ereditano.';
    el('save').textContent = npcs ? 'Salva catalogo NPC' : 'Salva catalogo boss';
    el('select').parentElement!.firstChild!.textContent = npcs ? 'NPC' : 'Boss';
    el<HTMLInputElement>('name').readOnly = npcs;
    const hide = ['duplicate', 'skin', 'hp', 'speed', 'level', 'radius', 'respawnMs', 'gold', 'attack', 'damage', 'range', 'attackRadius', 'windupMs', 'cooldownMs'];
    for (const id of hide) (el(id).closest('label') ?? el(id)).classList.toggle('boss-only', npcs);
    el('attack').parentElement!.previousElementSibling!.classList.toggle('boss-only', npcs);
    el('new-animation').closest('aside')!.querySelector('p')!.classList.toggle('boss-only', npcs);
    options('new-animation', (npcs ? ['idle', 'moving'] : ['idle', 'walk', 'prep', 'melee', 'charge', 'slam', 'nova', 'death']).map(id => [id, id]));
    dialog.showModal(); choices(); if (npcs) set('select', 'old-fisher'); refresh();
    raf = requestAnimationFrame(draw); if (!dirty) void load().catch(report);
  }
  document.getElementById('open-boss-editor')!.onclick = () => open(false);
  document.getElementById('open-npc-editor')!.onclick = () => open(true);
  const fallback = document.createElement('button'); fallback.id = 'boss-idle-fallback'; fallback.textContent = 'Idle: usa primo frame di moving'; fallback.className = 'npc-only';
  el('add-animation').after(fallback);
  const help = document.createElement('p'); help.className = 'npc-only'; help.textContent = 'moving: camminata. idle: fermo. Senza idle il gioco mostra il primo frame di moving della direzione attuale. Per animare anche le pause, aggiungi idle e attiva Ripeti animazione. Ordine delle righe: giù, su, destra, sinistra. Le animazioni non cambiano il comportamento del personaggio.'; fallback.after(help);
  fallback.onclick = () => { delete visual().animations.idle; changed(); refresh(); set('animation', 'idle'); refreshAnimation(); };
}
