import './styles/surface-lab.css';
import { Renderer } from './render/render';
import { World } from '../shared/world';
import { newSurfaceDemoWorld } from '../shared/surface-demo';
import { newRockCliffDemoWorld } from '../shared/rock-cliff-demo';
import { newTerrainReferenceDemoWorld, REFERENCE_BRIDGE } from '../shared/terrain-reference-demo';
import { TILE_SIZE } from '../shared/config';
import { moveWalkingWithCollisions, resolveActorCollisions } from '../shared/physics';
import { serializeWorldDocument } from '../shared/world-tiles';
import { playerSpriteDirectionRow } from '../shared/sprite-direction';
import type { Actor, Vec2 } from '../shared/types';
import { parseWallSpriteKitCatalog, type WallSpriteKit } from '../shared/wall-sprite-kits';

const root = document.querySelector<HTMLElement>('#surface-lab')!;
root.innerHTML = `<header><div><span class="eyebrow">RIFTLANDS / TERRENO IBRIDO</span><h1>Alture e ponti.</h1><p>Erba e roccia, pavimento e mattoni, due percorsi nello stesso spazio.</p></div>
<nav><a href="/world-maker.html">World Maker ↗</a><a href="/dungeon-maker.html">Dungeon Maker ↗</a></nav></header>
<section class="lab-toolbar" aria-label="Prove"><button id="lab-route" class="active">Percorso completo</button><button id="lab-under">Passa sotto</button><button id="lab-above">Sul ponte</button><label>Vista<select id="lab-zoom"><option value="1">Ampia</option><option value="1.35">Vicina</option><option value="1.7">Dettaglio</option></select></label><button id="lab-download">Scarica mappa di esempio</button></section>
<section class="lab-stage"><canvas id="lab-canvas" tabindex="0" aria-label="Zona giocabile di prova"></canvas><div class="lab-guide"><strong id="lab-instructions">WASD o frecce: muoviti. Sali la scala a sinistra, attraversa il ponte e scendi dalla rampa a destra.</strong><span>La prova è locale. La tua mappa rimane invariata.</span></div></section>
<footer><output id="lab-support">Caricamento texture…</output><span>L’altro personaggio occupa il percorso sopra o sotto.</span></footer>`;
let example = newSurfaceDemoWorld(), world = new World(example.seed, 16, 'world',
  { ...example, interiorBounds: { width: 24, height: 18, name: 'Alture e ponti', id: 'surface-lab', pvp: false } }, []);
const canvas = document.querySelector<HTMLCanvasElement>('#lab-canvas')!, renderer = new Renderer(canvas);
const sceneLabel = document.createElement('label'); sceneLabel.innerHTML = 'Esempio <select id="lab-scene"><option value="surfaces">Alture e ponti</option><option value="rock">Pareti rocciose e gradoni</option><option value="reference">Terrazze, scale e ponte</option></select>';
document.querySelector('.lab-toolbar')!.prepend(sceneLabel);
const kitLabel = document.createElement('label');
kitLabel.innerHTML = 'Kit parete <select id="lab-wall-skin"><option value="">Predefinito</option></select>';
sceneLabel.after(kitLabel);
const kitSelect = kitLabel.querySelector<HTMLSelectElement>('select')!;
let wallKits: WallSpriteKit[] = [];
let rockScene = false, referenceScene = false;
document.querySelector<HTMLSelectElement>('#lab-zoom')!.add(new Option('Intera scena', '.72'));
renderer.world = world; renderer.weather = 'clear'; renderer.setCameraSettings({ zoom: 1, viewLimit: 'standard' });
function actor(id: string, name: string, x: number, y: number, surfaceId = 'ground'): Actor {
  const point = { x: (x + .5) * TILE_SIZE, y: (y + .5) * TILE_SIZE, surfaceId };
  return { id, name, ...point, ...world.surfaceState(point), kind: 'player', classId: id === 'self' ? 'warrior' : 'paladin',
    radius: 15, hp: 100, maxHp: 100, resource: 100, maxResource: 100, aim: 0, speed: 190, level: 1, xp: 0,
    kills: 0, deaths: 0, teamId: 'demo', hidden: false, revealedUntil: 0, deadUntil: 0, spawnProtectedUntil: 0,
    effects: [], cooldowns: { basic: 0, q: 0, e: 0, r: 0 }, spriteRow: 0, spriteMoving: false };
}
let self = actor('self', 'Tu', 3, 7), other = actor('other', 'Sul ponte', 10, 7, 'bridge-demo');
const keys = new Set<string>(); let pointer: Vec2 | undefined, previous = performance.now(), frameId = 0;
const instructions = document.querySelector<HTMLElement>('#lab-instructions')!, support = document.querySelector<HTMLOutputElement>('#lab-support')!;
function reset(mode: 'route' | 'under' | 'above'): void {
  keys.clear();
  if (referenceScene) {
    self = mode === 'above' ? actor('self', 'Tu', 17, 11, REFERENCE_BRIDGE)
      : mode === 'under' ? actor('self', 'Tu', 17, 15) : actor('self', 'Tu', example.spawn.x, example.spawn.y);
    other = mode === 'above' ? actor('other', 'Sotto il ponte', 17, 11) : actor('other', 'Sul ponte', 17, 11, REFERENCE_BRIDGE);
    instructions.textContent = mode === 'under' ? 'Muoviti verso l’alto lungo il sentiero: passerai sotto il ponte e la sua biforcazione.'
      : mode === 'above' ? 'Esplora il ponte: svolta, biforcazione e accessi alle terrazze. Il sentiero inferiore resta distinto.'
      : 'WASD o frecce: sali la scala a sinistra, esplora le terrazze e attraversa il ponte. Vista Vicina segue il personaggio.';
    for (const button of root.querySelectorAll<HTMLButtonElement>('.lab-toolbar button')) button.classList.toggle('active', button.id === `lab-${mode}`);
    canvas.focus(); return;
  }
  if (rockScene) {
    self = actor('self', 'Tu', example.spawn.x, example.spawn.y); other = actor('other', 'Ingresso', 2, 6);
    instructions.textContent = 'WASD o frecce: muoviti. Sali i gradoni laterali a destra; esplora anello, rientranze e terrazze. La camera ti segue.';
    for (const button of root.querySelectorAll<HTMLButtonElement>('.lab-toolbar button')) button.classList.toggle('active', button.id === 'lab-route');
    canvas.focus(); return;
  }
  if (mode === 'above') { self = actor('self', 'Tu', 10, 7, 'bridge-demo'); other = actor('other', 'Sotto il ponte', 10, 7); }
  else { self = actor('self', 'Tu', mode === 'under' ? 10 : 3, mode === 'under' ? 11 : 7); other = actor('other', 'Sul ponte', 10, 7, 'bridge-demo'); }
  instructions.textContent = mode === 'under' ? 'Muoviti verso l’alto: passerai sotto il ponte mentre l’altro personaggio rimane sopra.'
    : mode === 'above' ? 'Cammini sul ponte. L’altro personaggio rimane a terra e le ringhiere delimitano il tuo percorso.'
    : 'WASD o frecce: muoviti. Sali la scala a sinistra, attraversa il ponte e scendi dalla rampa a destra.';
  for (const button of root.querySelectorAll<HTMLButtonElement>('.lab-toolbar button')) button.classList.toggle('active', button.id === `lab-${mode}`);
  canvas.focus();
}
for (const mode of ['route', 'under', 'above'] as const) document.querySelector(`#lab-${mode}`)!.addEventListener('click', () => reset(mode));
function loadScene(): void {
  const scene = document.querySelector<HTMLSelectElement>('#lab-scene')!.value;
  rockScene = scene === 'rock';
  referenceScene = scene === 'reference';
  example = referenceScene ? newTerrainReferenceDemoWorld() : rockScene ? newRockCliffDemoWorld() : newSurfaceDemoWorld();
  const kit = wallKits.find(kit => kit.id === kitSelect.value);
  if (kit) for (const cell of example.surfaceCells ?? []) if (cell.wallMaterial === 'rock' && cell.kind !== 'bridge') {
    cell.wallSkin = kit.id; cell.wallMaterial = kit.material;
  }
  world = new World(example.seed, 16, 'world', { ...example, interiorBounds: example.interiorBounds ?? { width: 24, height: 18, name: 'Alture e ponti', id: 'surface-lab', pvp: false } }, []);
  renderer.world = world;
  if (referenceScene) {
    document.querySelector<HTMLSelectElement>('#lab-zoom')!.value = '.72'; renderer.setCameraSettings({ zoom: .72, viewLimit: 'standard' });
  }
  for (const id of ['lab-under', 'lab-above']) document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled = rockScene;
  document.querySelector('footer span')!.textContent = referenceScene ? 'Scale corte, lunghe e larghe · pareti · ponte a L/T · vegetazione e casa.' : rockScene ? 'Scala, parete e personaggio condividono la stessa quota.' : 'L’altro personaggio occupa il percorso sopra o sotto.';
  reset('route');
}
document.querySelector('#lab-scene')!.addEventListener('change', loadScene);
kitSelect.addEventListener('change', loadScene);
document.querySelector<HTMLSelectElement>('#lab-zoom')!.addEventListener('change', event => renderer.setCameraSettings({ zoom: Number((event.target as HTMLSelectElement).value), viewLimit: 'standard' }));
document.querySelector('#lab-download')!.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([serializeWorldDocument(example)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = referenceScene ? 'riftlands-terrazze-scale-ponte.json' : rockScene ? 'riftlands-pareti-rocciose.json' : 'riftlands-alture-ponti.json'; link.click(); URL.revokeObjectURL(url);
});
window.addEventListener('keydown', event => { if (event.target instanceof HTMLSelectElement) return; if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(event.code)) { event.preventDefault(); keys.add(event.code); } });
window.addEventListener('keyup', event => keys.delete(event.code)); window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('pointermove', event => { pointer = renderer.screenToWorld(event.clientX, event.clientY); });
function draw(now: number): void {
  const dt = Math.min(.05, (now - previous) / 1000); previous = now;
  const dx = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
  const dy = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
  Object.assign(self, moveWalkingWithCollisions(self, dx, dy, self.speed * dt, world));
  resolveActorCollisions([self, other], world); self.spriteMoving = !!(dx || dy);
  if (pointer) self.aim = Math.atan2(pointer.y - self.y, pointer.x - self.x);
  self.spriteRow = playerSpriteDirectionRow(dx, dy, self.spriteRow ?? 0, true);
  renderer.weather = 'clear';
  const overview = document.querySelector<HTMLSelectElement>('#lab-zoom')!.value === '.72';
  renderer.render({ time: now, self, actors: rockScene ? [self] : [self, other], projectiles: [], pickups: [], traps: [], events: [],
    selectedId: null, previewClass: 'warrior', playing: true, cameraTarget: referenceScene ? overview ? { x: 18 * TILE_SIZE, y: 13 * TILE_SIZE } : undefined : rockScene ? undefined : { x: 11 * TILE_SIZE, y: 8 * TILE_SIZE }, moveDirection: { x: dx, y: dy } });
  const current = world.surfaceFor(self);
  support.value = `Quota ${self.elevation ?? 0} · ${current?.kind === 'bridge' ? 'Ponte' : current?.kind === 'stairs' ? 'Scala' : 'Terreno'} · ${current?.material ?? 'erba'} · (${Math.floor(self.x / TILE_SIZE)}, ${Math.floor(self.y / TILE_SIZE)})`;
  canvas.dataset.surfaceId = self.surfaceId ?? 'ground'; canvas.dataset.elevation = String(self.elevation ?? 0);
  frameId = requestAnimationFrame(draw);
}
const query = new URLSearchParams(location.search);
if (query.get('scene') === 'reference') {
  document.querySelector<HTMLSelectElement>('#lab-scene')!.value = 'reference'; document.querySelector('#lab-scene')!.dispatchEvent(new Event('change'));
}
const kitsReady = fetch('/terrain-walls/catalog.json').then(async response => {
  if (!response.ok) return;
  const catalog = parseWallSpriteKitCatalog(await response.json()); wallKits = catalog.kits;
  for (const kit of wallKits) kitSelect.add(new Option(kit.name, kit.id));
  kitSelect.title = catalog.issues.join('\n');
  if (wallKits.some(kit => kit.id === query.get('wallSkin'))) { kitSelect.value = query.get('wallSkin')!; loadScene(); }
}).catch(() => { kitSelect.title = 'Kit PNG non disponibili: usa il disegno predefinito.'; });
await Promise.all([renderer.spritesReady, kitsReady]); frameId = requestAnimationFrame(draw);
window.addEventListener('pagehide', () => { cancelAnimationFrame(frameId); renderer.destroy(); });
