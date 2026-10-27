import { installNpcConversationEditor } from './npc-conversation-editor';
import { duplicateNpcVariant } from '../../../shared/npc-variants';
import { setNpcEditorCatalog } from '../npc-catalog';
import './boss-editor.css';
import { ACTOR_CATALOG, defaultPlayerVisual, parseActorCatalog, type ActorCatalog, type ActorVisual } from '../../../shared/actor-catalog';
import { CLASSES, PLAYER_RADIUS } from '../../../shared/config';
import type { ClassId } from '../../../shared/types';
import { ActorSpriteRenderer } from '../../render/actor-sprite-renderer';
import { animationFrame } from '../../render/actor-animation';
import { resolveAnimation } from '../../render/actor-animation';
import { NPC_DEFINITIONS, type NpcTemplateId } from '../../../shared/npcs';
import { bossSpriteSlots, characterSpriteSlots } from '../actor-sprite-slots';

const field = (id: string, label: string, step = '1') => `<label>${label}<input id="boss-${id}" type="number" step="${step}"></label>`;
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function installActorEditor(): void {
  const dialog = document.createElement('dialog'); dialog.id = 'boss-editor';
  dialog.innerHTML = `<header><div><h2>Boss · laboratorio visuale</h2><p>Anteprima con il renderer del gioco. Le modifiche al catalogo valgono per tutti i dungeon che lo ereditano.</p></div><button id="boss-close">Chiudi</button></header>
    <div class="boss-workspace"><aside><label>Boss<select id="boss-select"></select></label><div class="pair"><button id="boss-duplicate">Nuovo da questo</button><button id="boss-reload">Ricarica</button></div>
    <p id="boss-npc-identity" class="npc-only"></p><label class="npc-only">Gruppo<input id="boss-npc-group" maxlength="80" placeholder="Es. Abitanti, Mercanti, Guardie"></label><h3>Personaggio</h3><label>Nome<input id="boss-name" maxlength="80"></label><label>Skin<select id="boss-skin"></select></label>
    <div class="pair">${field('hp', 'Vita')}${field('speed', 'Velocità')}${field('level', 'Livello')}${field('radius', 'Raggio hitbox', '.5')}${field('respawnMs', 'Respawn · ms')}${field('gold', 'Ricompensa gold')}</div>
    <h3>Sprite</h3>${field('drawSize', 'Larghezza sprite · px')}<details><summary>Ancoraggio e posizione</summary><div class="pair">${field('anchorX', 'Anchor X · 0–1', '.01')}${field('anchorY', 'Anchor Y · 0–1', '.01')}${field('offsetX', 'Offset X · px')}${field('offsetY', 'Offset Y · px')}</div></details>
    <details open><summary>Ombra circolare</summary><label><input id="boss-shadow-enabled" type="checkbox">Mostra ombra</label><div id="boss-shadow-fields" class="pair">${field('shadowX', 'Posizione X')}${field('shadowY', 'Posizione Y')}${field('shadowWidth', 'Raggio orizzontale')}${field('shadowHeight', 'Raggio verticale')}${field('shadowOpacity', 'Opacità · 0–1', '.01')}</div></details>
    <h3>Attacchi</h3><label>Attacco<select id="boss-attack"></select></label><label id="boss-attack-name-label">Nome attacco · opzionale<input id="boss-attack-name" maxlength="80" placeholder="Senza nome: mostra il tipo"></label><p id="boss-attack-sharing">Gli attacchi dello stesso tipo condividono lo spritesheet.</p><div class="pair">${field('damage', 'Danno')}${field('range', 'Portata')}${field('attackRadius', 'Raggio effetto')}${field('windupMs', 'Preparazione · ms')}${field('cooldownMs', 'Intervallo · ms')}</div>
    </aside><section class="boss-preview"><canvas id="boss-canvas" width="780" height="660" aria-label="Anteprima boss con ombra, hitbox e anchor"></canvas><div class="boss-controls"><button id="boss-play">Pausa</button><label id="boss-preview-state-label">Anteprima<select id="boss-preview-state"><option value="selected">Spritesheet selezionato</option><option value="idle">Fermo</option><option value="moving">In movimento</option></select></label><label>Direzione<select id="boss-direction"><option value="0">Giù</option><option value="1">Su</option><option value="2">Destra</option><option value="3">Sinistra</option></select></label><label>Zoom<select id="boss-zoom"><option value="1">100%</option><option value="2" selected>200%</option><option value="3">300%</option></select></label><label><input id="boss-hitbox" type="checkbox" checked>Hitbox</label><label><input id="boss-anchor" type="checkbox" checked>Anchor</label></div><p>Rosso: collisione. Croce bianca: posizione nel mondo. Trascina sullo sprite per impostare l’anchor dell’animazione o della skin.</p><output id="boss-frame"></output></section>
    <aside><h3>Spritesheet</h3><div id="boss-slots" aria-label="Spritesheet del personaggio"></div><label id="boss-animation-label" hidden>Animazione<select id="boss-animation"></select></label><p id="boss-animation-rule"></p><label id="boss-asset-label" hidden>Immagine<select id="boss-asset"></select></label><button id="boss-import">Importa PNG / SVG</button><input id="boss-file" type="file" accept=".png,.svg,image/png,image/svg+xml" hidden>
    <h3 id="boss-sheet-title">Griglia spritesheet</h3><p id="boss-sheet-empty" hidden></p><fieldset id="boss-sheet-settings"><div class="pair">${field('columns', 'Colonne')}${field('rows', 'Righe')}${field('frameMs', 'Tempo frame · ms')}</div>
    <label><input id="boss-directional" type="checkbox">4 direzioni: giù, su, destra, sinistra</label><details><summary>Impostazioni avanzate</summary>${field('durationMs', 'Durata totale · ms')}<label><input id="boss-loop" type="checkbox">Ripeti animazione</label><label><input id="boss-animation-offset" type="checkbox">Anchor e offset propri dell’animazione</label>
    <div class="pair">${field('animationAnchorX', 'Anchor X', '.01')}${field('animationAnchorY', 'Anchor Y', '.01')}${field('animationOffsetX', 'Offset X')}${field('animationOffsetY', 'Offset Y')}</div>
    </details></fieldset></aside></div>
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
  let npcMode = false, playerMode = false;
  const bossMode = () => !npcMode && !playerMode;
  const playerDrafts = new Map<ClassId, { skin: string; visual: ActorVisual }>();
  const playerClass = () => val('select') as ClassId;
  const npcDrafts = new Map<NpcTemplateId, { skin: string; visual: ActorVisual }>();
  const variant = () => npcMode ? catalog.npcVariants?.find(v => `variant:${v.id}` === val('select')) : undefined;
  const npcKind = () => variant()?.base ?? val('select') as NpcTemplateId;
  const boss = () => {
    if (playerMode) return { ...catalog.bosses[0], name: CLASSES[playerClass()].name, radius: PLAYER_RADIUS, skin: catalog.playerSkins?.[playerClass()] ?? playerDrafts.get(playerClass())!.skin };
    if (!npcMode) return catalog.bosses.find(b => b.id === val('select'))!;
    const kind = npcKind(), spec = NPC_DEFINITIONS[kind];
    return { ...catalog.bosses[0], id: variant()?.id ?? kind, name: variant()?.name ?? spec.name, radius: spec.radius, skin: variant()?.skin ?? catalog.npcSkins?.[kind] ?? npcDrafts.get(kind)?.skin ?? '' };
  };
  const visual = (): ActorVisual => catalog.skins[boss().skin] ?? (playerMode ? playerDrafts.get(playerClass())!.visual : npcDrafts.get(npcKind())!.visual);
  const animation = () => resolveAnimation(visual(), { name: val('animation'), elapsed: 0 })!.animation;
  const slots = () => bossMode() ? bossSpriteSlots(Object.keys(visual().animations), boss().attacks) : characterSpriteSlots(Object.keys(visual().animations), playerMode ? { classId: playerClass() } : { npcKind: npcKind() });
  const animationKey = (name: string) => name === 'moving' && !visual().animations.moving && visual().animations.walk ? 'walk' : name;
  const slotNames = () => slots().map(slot => slot.id);
  const slotLabel = (id: string) => slots().find(slot => slot.id === id)?.label ?? id;
  const editableAnimation = () => {
    const name = animationKey(val('animation')), v = visual();
    if (!v.animations[name]) throw new Error('Seleziona uno spritesheet presente.');
    return v.animations[name];
  };
  function choices() { options('select', playerMode ? Object.values(CLASSES).map(c => [c.id, c.name]) : npcMode ? [...Object.entries(NPC_DEFINITIONS).map(([id, n]): [string, string] => [id, n.name]), ...(catalog.npcVariants ?? []).map((v): [string, string] => [`variant:${v.id}`, `${v.group ? v.group + ' · ' : ''}${v.name}`])] : catalog.bosses.map(b => [b.id, b.name])); }
  function ensureNpcVisual() {
    if (playerMode && !catalog.playerSkins?.[playerClass()] && !playerDrafts.has(playerClass())) {
      let skin = `player-${playerClass()}`, suffix = 2;
      while (catalog.skins[skin]) skin = `player-${playerClass()}-${suffix++}`;
      playerDrafts.set(playerClass(), { skin, visual: defaultPlayerVisual(catalog, playerClass()) });
    }
    if (!npcMode || variant() || catalog.npcSkins?.[npcKind()] || npcDrafts.has(npcKind())) return;
    let skin = `npc-${npcKind()}`, suffix = 2;
    while (catalog.skins[skin]) skin = `npc-${npcKind()}-${suffix++}`;
    npcDrafts.set(npcKind(), { skin, visual: structuredClone(ACTOR_CATALOG.skins['npc-old-fisher']) });
  }
  async function prepare() { try { await sprites.prepare(visual()); } catch (e) { report(e); } }
  function refreshAttack() {
    const a = boss().attacks[Number(val('attack'))];
    set('attack-name', a.name);
    for (const key of ['damage', 'range', 'windupMs', 'cooldownMs'] as const) set(key, a[key]); set('attackRadius', a.radius);
  }
  function renderSlots() {
    const selected = val('animation'), v = visual();
    el('slots').innerHTML = slotNames().map(name => {
      const asset = v.animations[animationKey(name)]?.asset ?? '';
      const paths = [...new Set([...assets, ...(asset ? [asset] : [])])];
      const label = escape(slotLabel(name));
      return `<div class="sprite-slot" data-slot="${escape(name)}"><button type="button" data-select-slot="${escape(name)}" title="${label}" aria-label="${label}" aria-pressed="${name === selected}">${label}</button><select data-slot-asset="${escape(name)}" aria-label="Immagine ${label}" title="${escape(asset.split('/').at(-1) ?? 'Nessuna immagine')}"><option value="">Nessuna immagine</option>${paths.map(path => `<option value="${escape(path)}" ${path === asset ? 'selected' : ''}>${escape(path.split('/').at(-1)!)}</option>`).join('')}</select></div>`;
    }).join('');
  }
  function assignSlot(name: string, asset: string) {
    const v = visual();
    if ((v.animations[animationKey(name)]?.asset ?? '') === asset) { set('animation', name); refreshAnimation(); return; }
    if (!asset) {
      if (['idle', 'moving'].includes(name) && !(name === 'idle' ? v.animations.moving ?? v.animations.walk : v.animations.idle)) {
        status('Assegna prima un’immagine a Idle o Movimento: ne serve almeno una.'); renderSlots(); return;
      }
      delete v.animations[name]; if (name === 'moving') delete v.animations.walk;
    } else if (v.animations[animationKey(name)]) {
      if (name === 'moving' && animationKey(name) === 'walk') { v.animations.moving = v.animations.walk; delete v.animations.walk; }
      v.animations[name].asset = asset;
    }
    else v.animations[name] = { asset, columns: name === 'moving' ? 4 : 1, rows: name === 'moving' ? 4 : 1,
      directional: name === 'moving', loop: ['idle', 'moving'].includes(name), frameMs: 130 };
    set('animation', name); changed(); refreshAnimation();
  }
  el('slots').onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-select-slot]');
    if (!button) return; set('animation', button.dataset.selectSlot!); refreshAnimation();
  };
  el('slots').onchange = event => {
    const select = event.target as HTMLSelectElement;
    if (select.dataset.slotAsset) assignSlot(select.dataset.slotAsset, select.value);
  };
  function refreshAnimation() {
    const v = visual(), assigned = v.animations[animationKey(val('animation'))], a = assigned ?? animation();
    renderSlots();

    el('animation-rule').textContent = v.animations.idle && (v.animations.moving ?? v.animations.walk)
      ? 'Da fermo: Idle. In cammino: Movimento.' : v.animations.idle
      ? 'Solo Idle: resta attivo anche quando il personaggio si muove.'
      : 'Idle vuoto: primo frame di Movimento, nella direzione in cui si è fermato.';
    el('sheet-title').textContent = slotLabel(val('animation'));
    el('sheet-title').title = el('sheet-title').textContent ?? '';
    el('sheet-empty').hidden = !!assigned;
    el('sheet-empty').textContent = val('animation') === 'idle' ? 'Nessuna immagine Idle: usa il primo frame di Movimento.'
      : val('animation') === 'moving' ? 'Nessuna immagine Movimento: usa Idle anche mentre si muove.' : 'Nessuna immagine: questa animazione non è configurata.';
    el<HTMLFieldSetElement>('sheet-settings').disabled = !assigned;
    el('sheet-settings').hidden = !assigned;
    el('import').textContent = 'Importa immagine per ' + slotLabel(val('animation'));
    el('import').title = el('import').textContent ?? '';
    options('asset', [...new Set([...assets, a.asset])].map(path => [path, path.split('/').at(-1)!])); set('asset', assigned?.asset ?? '');
    for (const key of ['columns', 'rows', 'frameMs', 'durationMs'] as const) set(key, a[key]);
    el<HTMLInputElement>('directional').checked = a.directional; el<HTMLInputElement>('loop').checked = a.loop;
    el<HTMLInputElement>('animation-offset').checked = !!assigned?.anchor || !!assigned?.offset;
    const anchor = a.anchor ?? v.anchor, offset = a.offset ?? v.offset;
    set('animationAnchorX', anchor.x); set('animationAnchorY', anchor.y); set('animationOffsetX', offset.x); set('animationOffsetY', offset.y);
    for (const id of ['animationAnchorX', 'animationAnchorY', 'animationOffsetX', 'animationOffsetY']) el<HTMLInputElement>(id).disabled = !check('animation-offset');
    set('preview-state', 'selected'); startedAt = performance.now(); elapsed = 0; void prepare();
  }
  const conversations = installNpcConversationEditor(dialog, {
    catalog: () => catalog, selection: () => ({ kind: npcKind(), variant: variant() }),
    changed: () => { dirty = true; status('Modifiche da salvare.'); },
    created: id => { choices(); set('select', `variant:${id}`); changed(); refresh(); }, report,
  });
  function refresh() {
    const previousAnimation = val('animation');
    ensureNpcVisual();
    const b = boss(), v = visual(); if (!b || !v) return;
    el<HTMLInputElement>('name').readOnly = playerMode || npcMode && !variant();
    el<HTMLInputElement>('npc-group').disabled = !variant(); set('npc-group', variant()?.group ?? '');
    el('npc-identity').textContent = npcMode ? variant() ? `ID: ${variant()!.id} · Comportamento: ${NPC_DEFINITIONS[npcKind()].name}` : `Modello originale: ${npcKind()} · Duplica per creare un NPC indipendente.` : '';
    set('name', b.name); options('skin', Object.keys(catalog.skins).filter(id => npcMode || ['idle', 'moving', 'walk'].some(name => catalog.skins[id].animations[name])).map(id => [id, id])); set('skin', b.skin);
    for (const key of ['hp', 'speed', 'level', 'radius', 'respawnMs'] as const) set(key, b[key]); set('gold', b.reward.gold);
    set('drawSize', v.drawSize); set('anchorX', v.anchor.x); set('anchorY', v.anchor.y); set('offsetX', v.offset.x); set('offsetY', v.offset.y);
    for (const [id, key] of [['shadowX', 'x'], ['shadowY', 'y'], ['shadowWidth', 'width'], ['shadowHeight', 'height'], ['shadowOpacity', 'opacity']] as const) set(id, v.shadow[key]);
    el<HTMLInputElement>('shadow-enabled').checked = v.shadow.opacity > 0;
    el('shadow-fields').hidden = !check('shadow-enabled');
    options('animation', slots().map(slot => [slot.id, slot.label]));
    if ([...el<HTMLSelectElement>('animation').options].some(o => o.value === previousAnimation)) set('animation', previousAnimation);
    else set('animation', v.animations.moving || v.animations.walk ? 'moving' : 'idle');
    options('attack', b.attacks.map((a, i) => [String(i), `${i + 1} · ${a.name ?? slotLabel(a.kind)}`]));
    refreshAnimation(); refreshAttack(); if (npcMode) conversations.refresh();
  }
  async function load() {
    el<HTMLButtonElement>('save').disabled = true;
    const response = await fetch('/__world/actors', { cache: 'no-store' });
    if (!response.ok) throw new Error('Apri il World Studio per modificare e salvare i boss.');
    const project = await response.json(); catalog = parseActorCatalog(project.catalog); token = project.token; revision = project.revision; assets = project.assets;
    const selection = val('select'); dirty = false; npcDrafts.clear(); playerDrafts.clear(); setNpcEditorCatalog(catalog); choices(); if ([...el<HTMLSelectElement>('select').options].some(o => o.value === selection)) set('select', selection); refresh(); el<HTMLButtonElement>('save').disabled = false; status('Catalogo caricato.');
  }
  function changed() {
    if (playerMode && !catalog.playerSkins?.[playerClass()]) {
      const draft = playerDrafts.get(playerClass())!;
      catalog.skins[draft.skin] = draft.visual;
      (catalog.playerSkins ??= {})[playerClass()] = draft.skin;
    }
    if (playerMode) (catalog.playerDrawSizes ??= {})[playerClass()] = visual().drawSize;
    if (npcMode && !variant() && !catalog.npcSkins?.[npcKind()]) {
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
  el('name').addEventListener('input', () => {
    if (npcMode) { if (variant()) variant()!.name = val('name'); } else boss().name = val('name'); changed();
  });
  el('npc-group').addEventListener('input', () => { if (variant()) { variant()!.group = val('npc-group').trim(); changed(); } });
  el('gold').addEventListener('input', () => { boss().reward.gold = num('gold'); changed(); });
  for (const id of ['drawSize', 'anchorX', 'anchorY', 'offsetX', 'offsetY', 'shadowX', 'shadowY', 'shadowWidth', 'shadowHeight', 'shadowOpacity']) el(id).addEventListener('input', () => {
    const v = visual(); v.drawSize = num('drawSize'); v.anchor = { x: num('anchorX'), y: num('anchorY') }; v.offset = { x: num('offsetX'), y: num('offsetY') };
    v.shadow = { x: num('shadowX'), y: num('shadowY'), width: num('shadowWidth'), height: num('shadowHeight'), opacity: check('shadow-enabled') ? num('shadowOpacity') : 0 }; changed();
  });
  el('shadow-enabled').onchange = () => {
    visual().shadow.opacity = check('shadow-enabled') ? num('shadowOpacity') || .28 : 0;
    set('shadowOpacity', visual().shadow.opacity); el('shadow-fields').hidden = !check('shadow-enabled'); changed();
  };
  for (const id of ['damage', 'range', 'attackRadius', 'windupMs', 'cooldownMs']) el(id).addEventListener('input', () => {
    const a = boss().attacks[Number(val('attack'))]; a.damage = num('damage'); a.range = num('range'); a.radius = num('attackRadius'); a.windupMs = num('windupMs'); a.cooldownMs = num('cooldownMs'); changed();
  });
  for (const id of ['asset', 'columns', 'rows', 'frameMs', 'durationMs', 'directional', 'loop', 'animation-offset', 'animationAnchorX', 'animationAnchorY', 'animationOffsetX', 'animationOffsetY']) el(id).addEventListener('change', () => {
    const a = editableAnimation(); a.asset = val('asset'); a.columns = num('columns'); a.rows = num('rows'); a.directional = check('directional'); a.loop = check('loop');
    if (id === 'directional' && a.directional) a.rows = 4;
    if (val('frameMs')) a.frameMs = num('frameMs'); else delete a.frameMs;
    if (val('durationMs')) a.durationMs = num('durationMs'); else delete a.durationMs;
    if (check('animation-offset')) { a.anchor = { x: num('animationAnchorX'), y: num('animationAnchorY') }; a.offset = { x: num('animationOffsetX'), y: num('animationOffsetY') }; }
    else { delete a.anchor; delete a.offset; }
    changed(); refreshAnimation();
  });
  el('attack-name').oninput = () => {
    const a = boss().attacks[Number(val('attack'))], name = val('attack-name').trim();
    if (name) a.name = name; else delete a.name;
    changed(); renderSlots(); el('sheet-title').textContent = slotLabel(val('animation')); el('sheet-title').title = el('sheet-title').textContent;
  };
  el('attack-name').onchange = () => { const selection = val('attack'); options('attack', boss().attacks.map((a, i) => [String(i), `${i + 1} · ${a.name ?? slotLabel(a.kind)}`])); set('attack', selection); refreshAnimation(); };
  el('select').addEventListener('change', refresh); el('animation').addEventListener('change', refreshAnimation); el('attack').addEventListener('change', refreshAttack);
  el('skin').addEventListener('change', () => { if (npcMode) { if (variant()) variant()!.skin = val('skin'); else catalog.npcSkins![npcKind()] = val('skin'); } else boss().skin = val('skin'); changed(); refresh(); });
  el('duplicate').onclick = () => {
    if (npcMode) {
      const id = prompt('ID del nuovo NPC (lettere minuscole, numeri e trattini):'); if (!id) return;
      try {
        const copy = duplicateNpcVariant(catalog, variant() ?? npcKind(), id, visual());
        choices(); set('select', `variant:${copy.id}`); changed(); refresh();
        status('Nuovo NPC creato. Personalizza nome, gruppo e sprite, poi salva il catalogo.');
      } catch (e) { report(e); }
      return;
    }
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
      const selection = val('select'); catalog = parseActorCatalog(result.catalog); revision = result.revision; dirty = false; setNpcEditorCatalog(catalog); choices(); set('select', selection); status('Catalogo salvato con backup. Puoi continuare a modificare qui. Riavvia il gioco per applicare le modifiche.');
      const channel = new BroadcastChannel('riftlands.studio'); channel.postMessage({ type: 'actors' }); channel.close();
    } finally { el<HTMLButtonElement>('save').disabled = false; }
  })().catch(report); };
  el('import').onclick = () => el<HTMLInputElement>('file').click();
  el('file').addEventListener('change', () => { void (async () => {
    const file = el<HTMLInputElement>('file').files?.[0]; if (!file) return;
    const targetName = val('animation'), targetVisual = visual();
    const reader = new FileReader(), base64 = await new Promise<string>((resolve, reject) => { reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    const response = await fetch('/__world/actor-images', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-World-Token': token }, body: JSON.stringify({ mime: file.type || (file.name.endsWith('.svg') ? 'image/svg+xml' : 'image/png'), base64, filename: file.name }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); assets.push(result.image);
    if (targetVisual !== visual()) throw new Error('Personaggio cambiato durante l’importazione. Seleziona l’immagine dalla lista.');
    assignSlot(targetName, result.image);
    el<HTMLInputElement>('file').value = '';
  })().catch(report); });
  let drag: { x: number; y: number; width: number; height: number } | undefined;
  function pointer(event: PointerEvent) {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect(), zoom = num('zoom');
    const x = (event.clientX - rect.left) * canvas.width / rect.width, y = (event.clientY - rect.top) * canvas.height / rect.height;
    const anchor = { x: Math.max(0, Math.min(1, ((x - 390) / zoom - drag.x) / drag.width)), y: Math.max(0, Math.min(1, ((y - 390) / zoom - drag.y) / drag.height)) };
    if (check('animation-offset') && visual().animations[animationKey(val('animation'))]) { editableAnimation().anchor = anchor; set('animationAnchorX', anchor.x.toFixed(3)); set('animationAnchorY', anchor.y.toFixed(3)); }
    else { visual().anchor = anchor; set('anchorX', anchor.x.toFixed(3)); set('anchorY', anchor.y.toFixed(3)); }
    changed();
  }
  canvas.addEventListener('pointerdown', event => { if (!visual().animations[val('animation')]) return; drag = sprites.bounds(visual(), animation()); canvas.setPointerCapture(event.pointerId); pointer(event); });
  canvas.addEventListener('pointermove', pointer); canvas.addEventListener('pointerup', () => { drag = undefined; }); canvas.addEventListener('pointercancel', () => { drag = undefined; });
  function draw(now: number) {
    if (!dialog.open) return;
    const requestedName = val('preview-state') === 'selected' ? val('animation') : val('preview-state');
    const previewName = !visual().animations[requestedName] && !['idle', 'moving'].includes(requestedName) ? 'idle' : requestedName;
    const b = boss(), v = b ? visual() : undefined, a = v ? resolveAnimation(v, { name: previewName, elapsed })?.animation : undefined;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#426849'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (v && a) {
      if (playing) elapsed = now - startedAt;
      ctx.save(); ctx.translate(390, 390); ctx.scale(num('zoom'), num('zoom'));
      ctx.strokeStyle = '#ffffff12'; ctx.lineWidth = .5;
      for (let i = -400; i <= 400; i += 24) { ctx.beginPath(); ctx.moveTo(i, -400); ctx.lineTo(i, 400); ctx.moveTo(-400, i); ctx.lineTo(400, i); ctx.stroke(); }
      if (v.shadow.width >= 0 && v.shadow.height >= 0) sprites.drawShadow(ctx, v);
      if (Number.isFinite(v.drawSize)) sprites.draw(ctx, v, { name: previewName, elapsed }, num('direction'));
      if (check('hitbox') && b.radius > 0) { ctx.strokeStyle = '#ffad98'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, b.radius, 0, Math.PI * 2); ctx.stroke(); }
      if (check('anchor')) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.moveTo(0, -6); ctx.lineTo(0, 6); ctx.stroke(); }
      ctx.restore(); const resolved = resolveAnimation(v, { name: previewName, elapsed })!; frame = animationFrame(resolved.animation, resolved.state, num('direction'));
      el('frame').textContent = `Frame ${frame + 1} / ${a.columns * a.rows} · ${v.drawSize} px · hitbox ${b.radius} px`;
    }
    raf = requestAnimationFrame(draw);
  }
  function close() { if (!dirty || confirm('Chiudere senza salvare le modifiche al catalogo?')) { dirty = false; dialog.close(); } }
  el('close').onclick = close; dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }); dialog.addEventListener('close', () => cancelAnimationFrame(raf));
  dialog.addEventListener('keydown', event => event.stopPropagation());
  function open(npcs: boolean, players = false) {
    npcMode = npcs; playerMode = players;
    dialog.classList.toggle('npc-mode', npcs);
    dialog.classList.toggle('player-mode', players);
    dialog.querySelector('h2')!.textContent = players ? 'Player · sprite e ombra' : npcs ? 'NPC · sprite e ombra' : 'Boss · sprite e ombra';
    dialog.querySelector('header p')!.textContent = players ? 'Sprite e ombra per classe. Idle e movimento seguono le stesse regole degli NPC. Il Cacciatore parte da un modello statico modificabile.' : npcs ? 'Personalizza ogni tipo di NPC, amici e mob. Le modifiche valgono per tutti gli NPC di quel tipo.' : 'Anteprima con il renderer del gioco. Le modifiche al catalogo valgono per tutti i dungeon che lo ereditano.';
    el('save').textContent = players ? 'Salva catalogo player' : npcs ? 'Salva catalogo NPC' : 'Salva catalogo boss';
    el('select').parentElement!.firstChild!.textContent = players ? 'Classe' : npcs ? 'NPC' : 'Boss';
    el('duplicate').hidden = players;
    el('duplicate').textContent = npcs ? 'Duplica come nuovo NPC' : 'Nuovo da questo';
    const hide = ['skin', 'hp', 'speed', 'level', 'radius', 'respawnMs', 'gold', 'attack', 'damage', 'range', 'attackRadius', 'windupMs', 'cooldownMs', 'attack-name'];
    for (const id of hide) (el(id).closest('label') ?? el(id)).classList.toggle('boss-only', npcs || players);
    el('attack-sharing').hidden = !bossMode();
    el('attack').parentElement!.previousElementSibling!.classList.toggle('boss-only', npcs || players);

    dialog.showModal(); choices(); if (npcs) set('select', 'old-fisher'); refresh();
    raf = requestAnimationFrame(draw); if (!dirty) void load().catch(report);
  }
  const bossOpener = document.getElementById('open-boss-editor')!;
  bossOpener.textContent = 'Boss · sprite e ombra';
  document.getElementById('open-npc-editor')!.after(bossOpener);
  bossOpener.onclick = () => open(false);
  document.getElementById('open-npc-editor')!.onclick = () => open(true);
  document.getElementById('open-npc-editor')!.textContent = 'NPC · sprite e ombra';
  const playerOpener = document.createElement('button'); playerOpener.id = 'open-player-editor'; playerOpener.className = 'wide'; playerOpener.textContent = 'Player · sprite e ombra';
  document.getElementById('open-npc-editor')!.before(playerOpener);
  playerOpener.onclick = () => open(false, true);
}
