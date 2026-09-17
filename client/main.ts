import './style.css';
import { TICK_RATE } from '../shared/config';
import type { Actor, GameEvent, InputCommand, PublicAccount, Snapshot } from '../shared/types';
import { GameConnection } from './net';
import { predictMovement, reconcile } from './prediction';
import { LocalMovementView, LocalPresentationDelay } from './motion';
import { SnapshotBuffer } from './snapshots';
import { Renderer, drawMinimap } from './render';
import { GameUI } from './ui';
import { dungeonAt } from '../shared/dungeons';
import { CONTROLS_STORAGE_KEY, defaultControls, GameControls, parseControls } from './controls';

let playing = false;
let latest: Snapshot | null = null;
let predicted: Actor | null = null;
let pending: InputCommand[] = [];
let seq = 0;
let selectedId: string | null = null;
const controls = new GameControls(defaultControls());
try { controls.settings = parseControls(localStorage.getItem(CONTROLS_STORAGE_KEY)); } catch { /* Storage may be unavailable. */ }
const snapshotBuffer = new SnapshotBuffer();
let renderedActors: Actor[] = [];
const effects = new Map<string, GameEvent>();
const localMovement = new LocalMovementView();
const LOCAL_PRESENTATION_DELAY_MS = 30;
// Presentation-only delay. Inputs still go to the server as soon as they are generated.
const localPresentation = new LocalPresentationDelay(LOCAL_PRESENTATION_DELAY_MS);
let lastMinimap = 0;
let profileCache = '';
let joinGeneration = 0;
const releaseControls = (): void => controls.clear();

const ui = new GameUI(document.querySelector<HTMLDivElement>('#app')!, {
  joinCredentials: (mode, name, password, classId) => {
    const generation = ++joinGeneration;
    ui.setConnection('connecting', 'Preparazione grafica…');
    void renderer.spritesReady.then(() => {
      if (generation === joinGeneration) connection.joinWithCredentials(mode, name, password, classId);
    });
  },
  joinSaved: classId => {
    const generation = ++joinGeneration;
    ui.setConnection('connecting', 'Preparazione grafica…');
    void renderer.spritesReady.then(() => {
      if (generation === joinGeneration) connection.joinWithToken(classId);
    });
  },
  logout: () => {
    joinGeneration++;
    connection.logout();
    clearProfile();
    ui.setSavedAccount(null);
    ui.toast('Disconnessione completata.');
  },
  leave: () => {
    joinGeneration++;
    connection.leave(); playing = false; latest = null; predicted = null; selectedId = null; localPresentation.reset();
    releaseControls(); snapshotBuffer.clear(); renderedActors = []; effects.clear();
    ui.setPlaying(false); ui.setSelected(null);
  },
  social: (action, targetId) => { connection.send({ type: 'social', action, targetId }); },
  select: id => { selectedId = id; ui.setSelected(latest?.actors.find(actor => actor.id === id) ?? null); },
  cast: slot => { if (playing && connection.connected) controls.cast(slot); },
  controlsChanged: settings => {
    if (playing) return;
    releaseControls(); controls.settings = settings;
    try { localStorage.setItem(CONTROLS_STORAGE_KEY, JSON.stringify(settings)); ui.toast('Controlli salvati su questo dispositivo.', 'success'); }
    catch { ui.toast('Controlli applicati. Il browser non consente il salvataggio: al prossimo avvio saranno ripristinati.', 'error'); }
  }
});
ui.setControls(controls.settings);

const renderer = new Renderer(ui.canvas);
const connection = new GameConnection({
  reset: () => { releaseControls(); seq = 0; pending = []; predicted = null; snapshotBuffer.clear(); renderedActors = []; localMovement.reset(); localPresentation.reset(); },
  status: (status, detail) => {
    ui.setConnection(status, detail);
    if (status === 'offline' || status === 'reconnecting') releaseControls();
    if (status === 'offline') { playing = false; ui.setPlaying(false); if (detail) ui.toast(detail, 'error'); }
  },
  authExpired: () => {
    clearProfile();
    ui.setSavedAccount(null);
    ui.toast('La sessione precedente è scaduta. Accedi con le tue credenziali.', 'error');
  },
  message: message => {
    if (message.type === 'welcome') {
      renderer.setSeed(message.seed);
      saveProfile(message.account);
      ui.setSavedAccount(message.account);
      ui.setSocial(message.social);
      ui.setPlaying(true);
      playing = true;
      releaseControls();
      effects.clear();
      latest = null;
    } else if (message.type === 'room') {
      renderer.setSeed(message.room.seed, message.room.mode);
      latest = null;
      selectedId = null;
      releaseControls();
      effects.clear();
      lastMinimap = 0;
      ui.setSelected(null);
    } else if (message.type === 'snapshot') {
      const old = predicted;
      latest = message;
      renderer.world.setBossLocks((message.bossLocks ?? []).filter(lock => lock.locked).map(lock => lock.bossId));
      const result = reconcile(message.self, message.ack, pending, renderer.world, message.time);
      pending = result.pending;
      predicted = result.actor;
      localMovement.correct(old, predicted);
      snapshotBuffer.push(message, performance.now());
      for (const event of message.events) {
        const localEvent = event.actorId === message.self.id || event.targetId === message.self.id;
        effects.set(event.id, localEvent ? { ...event, at: event.at + LOCAL_PRESENTATION_DELAY_MS } : event);
      }
      ui.setSnapshot(message, connection.ping);
      const { id, name, xp, kills, deaths } = message.self;
      if (renderer.world.mode === 'world') saveProfile({ id, name, xp, kills, deaths, gold: message.gold ?? 0 });
      if (selectedId) {
        const selected = message.actors.find(actor => actor.id === selectedId) ?? null;
        if (!selected) selectedId = null;
        ui.setSelected(selected);
      }
      const biome = renderer.world.getBiome(message.self.x, message.self.y);
      const dungeon = dungeonAt(message.self, 150);
      ui.setLocation(renderer.world.mode === 'world' ? message.sanctuary !== 'outside' ? 'Avamposto del Crocevia' : dungeon?.name ?? ({ meadow: 'Praterie di Soglia', forest: 'Selva dei Sussurri', marsh: 'Acquitrini Velati' })[biome] : renderer.world.mode === 'arena' ? 'Arena del Crocevia' : 'Battleground di prova');
    } else if (message.type === 'social') ui.setSocial(message.state);
    else if (message.type === 'notice') ui.toast(message.message, message.tone);
    else if (message.type === 'error') ui.toast(message.message, 'error');
  }
});

function saveProfile(profile: PublicAccount): void {
  const serialized = JSON.stringify(profile);
  if (serialized === profileCache) return;
  profileCache = serialized;
  try { localStorage.setItem('riftlands.profile', serialized); } catch { /* Ignore */ }
}

function clearProfile(): void {
  profileCache = '';
  try { localStorage.removeItem('riftlands.profile'); } catch { /* Ignore */ }
}

try {
  const stored = localStorage.getItem('riftlands.profile');
  if (stored && connection.hasToken()) {
    const profile = JSON.parse(stored) as PublicAccount;
    if (typeof profile.id === 'string' && typeof profile.name === 'string' && [profile.xp, profile.kills, profile.deaths].every(Number.isFinite)) {
      saveProfile(profile);
      ui.setSavedAccount(profile);
    }
  }
} catch { /* Ignore */ }

const isTyping = (): boolean => {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || (active instanceof HTMLElement && active.isContentEditable);
};

window.addEventListener('keydown', event => {
  if (!playing || !connection.connected || isTyping() || event.ctrlKey || event.metaKey || event.altKey) return;
  if (controls.press(event.code)) event.preventDefault();
});

window.addEventListener('keyup', event => controls.release(event.code));
window.addEventListener('blur', releaseControls);
document.addEventListener('focusin', () => { if (isTyping()) releaseControls(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseControls(); });
ui.canvas.addEventListener('pointermove', event => { if (playing && event.pointerType === 'mouse') controls.setPointer({ x: event.clientX, y: event.clientY }); });
ui.canvas.addEventListener('pointerdown', event => {
  if (!playing || !connection.connected || ![0, 1, 2].includes(event.button)) return;
  ui.canvas.focus({ preventScroll: true });
  if (event.pointerType === 'mouse') {
    controls.setPointer({ x: event.clientX, y: event.clientY });
    ui.canvas.setPointerCapture(event.pointerId);
    if (event.button !== 0) { event.preventDefault(); controls.press(`Mouse${event.button}`); return; }
  }
  const position = renderer.screenToWorld(event.clientX, event.clientY);
  const target = renderedActors.find(actor => actor.id !== predicted?.id && Math.hypot(actor.x - position.x, actor.y - position.y) < actor.radius + 14);
  if (target) { selectedId = target.id; ui.setSelected(target); }
  else if (selectedId) { selectedId = null; ui.setSelected(null); }
});

window.addEventListener('pointerup', event => { if (event.pointerType === 'mouse') controls.release(`Mouse${event.button}`); });
window.addEventListener('pointercancel', releaseControls);
ui.canvas.addEventListener('lostpointercapture', event => { if (event.pointerType === 'mouse') { controls.release('Mouse1'); controls.release('Mouse2'); } });
ui.canvas.addEventListener('contextmenu', event => event.preventDefault());
ui.canvas.addEventListener('auxclick', event => event.preventDefault());

function inputTick(): void {
  if (!playing || !connection.connected || !predicted || document.hidden) return;
  localMovement.advance(predicted, predicted);
  if (pending.length > 120) { releaseControls(); return; }
  const { dx, dy, aim, cast } = isTyping() || predicted.hp <= 0
    ? (releaseControls(), { dx: 0, dy: 0, aim: predicted.aim, cast: undefined })
    : controls.sample(predicted, predicted.aim, (x, y) => renderer.screenToWorld(x, y));
  const input: InputCommand = { seq: ++seq, dx, dy, aim, ...(cast ? { cast } : {}) };
  if (connection.send({ type: 'input', input })) {
    pending.push(input);
    const next = predictMovement(predicted, input, renderer.world, connection.serverTime());
    localMovement.advance(predicted, next);
    predicted = next;
    controls.consumeCast();
  } else seq--;
}

let inputTime = performance.now(), inputAccumulator = 0;
function advanceInputs(now: number): void {
  const elapsed = Math.min(100, now - inputTime); inputTime = now;
  if (!playing || !connection.connected || document.hidden) { inputAccumulator = 0; return; }
  inputAccumulator += elapsed;
  while (inputAccumulator >= 1000 / TICK_RATE) { inputAccumulator -= 1000 / TICK_RATE; inputTick(); }
}
setInterval(() => advanceInputs(performance.now()), 8);

const touchControls = document.createElement('div'); touchControls.className = 'touch-controls';
for (const [label, action] of [['↑', 'up'], ['←', 'left'], ['↓', 'down'], ['→', 'right']] as const) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.className = action;
  button.setAttribute('aria-label', `Muoviti ${({ up: 'su', left: 'a sinistra', down: 'giù', right: 'a destra' })[action]}`);
  button.addEventListener('pointerdown', event => { if (!playing || !connection.connected) return; event.preventDefault(); button.setPointerCapture(event.pointerId); controls.setTouchDirection(action, true); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => controls.setTouchDirection(action, false));
  touchControls.append(button);
}
document.querySelector('.rift-app')?.append(touchControls);

let lastFrame = performance.now();
function frame(now: number): void {
  const delta = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
  advanceInputs(performance.now());
  const time = connection.serverTime();
  const remoteFrame = snapshotBuffer.sample(performance.now());
  const actors = remoteFrame?.actors ?? [];
  renderedActors = actors;
  const immediateSelf = predicted ? localMovement.sample(predicted, inputAccumulator / (1000 / TICK_RATE), delta) : latest?.self ?? null;
  const self = immediateSelf ? localPresentation.sample(immediateSelf, performance.now()) : null;
  for (const [id, effect] of effects) if (time > effect.at + effect.duration + 250) effects.delete(id);
  const projectiles = remoteFrame?.projectiles ?? [];
  renderer.render({
    arenaGate: latest?.arenaGate,
    goldDrops: latest?.goldDrops,
    bossWindups: latest?.bossWindups,
    bossLocks: latest?.bossLocks,
    time,
    self,
    actors,
    projectiles,
    pickups: latest?.pickups ?? [],
    traps: latest?.traps ?? [],
    events: [...effects.values()],
    selectedId,
    previewClass: ui.selectedClass,
    playing,
    moveDirection: playing && !isTyping() && predicted ? (() => {
      const input = controls.sample(predicted, predicted.aim, (x, y) => renderer.screenToWorld(x, y));
      return { x: input.dx, y: input.dy };
    })() : null,
  });
  if (self && playing && now - lastMinimap > 250) {
    drawMinimap(ui.minimap, renderer.world, self, actors, latest?.pickups ?? []); lastMinimap = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('pagehide', () => connection.leave());
