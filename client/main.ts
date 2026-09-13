import './style.css';
import { TICK_RATE } from '../shared/config';
import type { AbilitySlot, Actor, GameEvent, InputCommand, PublicAccount, Snapshot, Vec2 } from '../shared/types';
import { GameConnection } from './net';
import { predictMovement, reconcile } from './prediction';
import { LocalMovementView, LocalPresentationDelay } from './motion';
import { SnapshotBuffer } from './snapshots';
import { Renderer, drawMinimap } from './render';
import { GameUI } from './ui';

let playing = false;
let latest: Snapshot | null = null;
let predicted: Actor | null = null;
let pending: InputCommand[] = [];
let seq = 0;
let selectedId: string | null = null;
let pendingCast: AbilitySlot | undefined;
let primaryHeld = false;
let pointer: Vec2 | null = null;
const keys = new Set<string>();
const snapshotBuffer = new SnapshotBuffer();
let renderedActors: Actor[] = [];
const effects = new Map<string, GameEvent>();
const localMovement = new LocalMovementView();
const LOCAL_PRESENTATION_DELAY_MS = 30;
// Presentation-only delay. Inputs still go to the server as soon as they are generated.
const localPresentation = new LocalPresentationDelay(LOCAL_PRESENTATION_DELAY_MS);
let lastMinimap = 0;
let profileCache = '';
const releaseControls = (): void => { keys.clear(); primaryHeld = false; pendingCast = undefined; };

const ui = new GameUI(document.querySelector<HTMLDivElement>('#app')!, {
  joinCredentials: (mode, name, password, classId) => connection.joinWithCredentials(mode, name, password, classId),
  joinSaved: classId => connection.joinWithToken(classId),
  logout: () => {
    connection.logout();
    clearProfile();
    ui.setSavedAccount(null);
    ui.toast('Disconnessione completata.');
  },
  leave: () => {
    connection.leave(); playing = false; latest = null; predicted = null; selectedId = null; localPresentation.reset();
    keys.clear(); primaryHeld = false; pendingCast = undefined; snapshotBuffer.clear(); renderedActors = []; effects.clear();
    ui.setPlaying(false); ui.setSelected(null);
  },
  social: (action, targetId) => { connection.send({ type: 'social', action, targetId }); },
  select: id => { selectedId = id; ui.setSelected(latest?.actors.find(actor => actor.id === id) ?? null); },
  cast: slot => { if (playing && connection.connected) pendingCast = slot; }
});

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
      pointer = null;
      effects.clear();
      latest = null;
    } else if (message.type === 'snapshot') {
      const old = predicted;
      latest = message;
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
      saveProfile({ id, name, xp, kills, deaths });
      if (selectedId) {
        const selected = message.actors.find(actor => actor.id === selectedId) ?? null;
        if (!selected) selectedId = null;
        ui.setSelected(selected);
      }
      const biome = renderer.world.getBiome(message.self.x, message.self.y);
      ui.setLocation(({ meadow: 'Praterie di Soglia', forest: 'Selva dei Sussurri', marsh: 'Acquitrini Velati' })[biome]);
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
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable);
};

window.addEventListener('keydown', event => {
  if (!playing || !connection.connected || isTyping() || event.ctrlKey || event.metaKey || event.altKey) return;
  const code = event.code;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE', 'KeyR'].includes(code)) event.preventDefault();
  keys.add(code);
  if (!event.repeat && ['KeyQ', 'KeyE', 'KeyR'].includes(code)) pendingCast = code.slice(3).toLowerCase() as AbilitySlot;
});

window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', releaseControls);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseControls(); });
ui.canvas.addEventListener('pointermove', event => { pointer = { x: event.clientX, y: event.clientY }; });
ui.canvas.addEventListener('pointerdown', event => {
  if (!playing || !connection.connected || ![0, 2].includes(event.button)) return;
  pointer = { x: event.clientX, y: event.clientY };
  ui.canvas.setPointerCapture(event.pointerId);
  if (event.button === 2) { primaryHeld = true; return; }
  const position = renderer.screenToWorld(event.clientX, event.clientY);
  const target = renderedActors.find(actor => actor.id !== predicted?.id && Math.hypot(actor.x - position.x, actor.y - position.y) < actor.radius + 14);
  if (target) { selectedId = target.id; ui.setSelected(target); }
  else if (selectedId) { selectedId = null; ui.setSelected(null); }
});

window.addEventListener('pointerup', () => { primaryHeld = false; });
window.addEventListener('pointercancel', releaseControls);
ui.canvas.addEventListener('contextmenu', event => event.preventDefault());

function inputTick(): void {
  if (!playing || !connection.connected || !predicted || document.hidden) return;
  localMovement.advance(predicted, predicted);
  if (pending.length > 120) { releaseControls(); return; }
  const right = keys.has('KeyD') || keys.has('ArrowRight'), left = keys.has('KeyA') || keys.has('ArrowLeft');
  const down = keys.has('KeyS') || keys.has('ArrowDown'), up = keys.has('KeyW') || keys.has('ArrowUp');
  let dx = isTyping() ? 0 : Number(right) - Number(left), dy = isTyping() ? 0 : Number(down) - Number(up);
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > 1) { dx /= magnitude; dy /= magnitude; }
  const worldPointer = pointer ? renderer.screenToWorld(pointer.x, pointer.y) : null;
  let aim = predicted.aim;
  if (worldPointer) aim = Math.atan2(worldPointer.y - predicted.y, worldPointer.x - predicted.x);
  else if (magnitude) aim = Math.atan2(dy, dx);
  const cast = isTyping() ? undefined : pendingCast ?? ((primaryHeld || keys.has('Space')) ? 'basic' : undefined);
  const input: InputCommand = { seq: ++seq, dx, dy, aim, ...(cast ? { cast } : {}) };
  if (connection.send({ type: 'input', input })) {
    pending.push(input);
    const next = predictMovement(predicted, input, renderer.world, connection.serverTime());
    localMovement.advance(predicted, next);
    predicted = next;
    pendingCast = undefined;
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
for (const [label, code, className] of [['↑', 'KeyW', 'up'], ['←', 'KeyA', 'left'], ['↓', 'KeyS', 'down'], ['→', 'KeyD', 'right']]) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.className = className;
  button.setAttribute('aria-label', `Muoviti ${({ KeyW: 'su', KeyA: 'a sinistra', KeyS: 'giù', KeyD: 'a destra' })[code as 'KeyW']}`);
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(code); });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => keys.delete(code));
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
    moveDirection: playing && !isTyping() ? {
      x: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
      y: Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')),
    } : null,
  });
  if (self && playing && now - lastMinimap > 250) {
    drawMinimap(ui.minimap, renderer.world, self, actors, latest?.pickups ?? []); lastMinimap = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('pagehide', () => connection.leave());
