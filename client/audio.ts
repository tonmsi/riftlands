import type { Actor, GameEvent, Vec2 } from '../shared/types';
import type { BossWindup } from '../shared/bosses';

export interface SoundCue extends Vec2 { kind: 'step' | 'swing' | 'magic' | 'hit'; heavy?: boolean; }

/** Tracks presentation movement and authoritative combat events, never input presses. */
export class SoundCues {
  private positions = new Map<string, { x: number; y: number; hp: number; deadUntil: number; distance: number; lastStep: number }>();
  private heard = new Map<string, number>();

  reset(): void { this.positions.clear(); this.heard.clear(); }

  sample(actors: Actor[], events: GameEvent[], windups: BossWindup[], time: number): SoundCue[] {
    const cues: SoundCue[] = [];
    const ids = new Set(actors.map(actor => actor.id));
    for (const id of this.positions.keys()) if (!ids.has(id)) this.positions.delete(id);
    for (const [id, until] of this.heard) if (until < time) this.heard.delete(id);
    for (const actor of actors) {
      const previous = this.positions.get(actor.id);
      const distance = previous ? Math.hypot(actor.x - previous.x, actor.y - previous.y) : 0;
      const walking = actor.hp > 0 && actor.spriteMoving !== false && actor.npcKind !== 'wisp';
      const continuous = previous && previous.hp > 0 && previous.deadUntil === actor.deadUntil && distance < 60;
      let travelled = walking && continuous ? previous.distance + distance : 0;
      let lastStep = previous?.lastStep ?? time;
      if (travelled >= (actor.npcKind === 'boss' ? 48 : 32) && time - lastStep >= 230) {
        cues.push({ kind: 'step', x: actor.x, y: actor.y, heavy: actor.npcKind === 'boss' });
        travelled = 0; lastStep = time;
      }
      const state = previous ?? { x: 0, y: 0, hp: 0, deadUntil: 0, distance: 0, lastStep: 0 };
      state.x = actor.x; state.y = actor.y; state.hp = actor.hp; state.deadUntil = actor.deadUntil;
      state.distance = travelled; state.lastStep = lastStep;
      if (!previous) this.positions.set(actor.id, state);
    }
    for (const event of events) {
      if (event.at > time || this.heard.has(event.id)) continue;
      this.heard.set(event.id, time + 5000);
      if (time - event.at > 350) continue;
      if (event.kind === 'hit') cues.push({ kind: 'hit', x: event.x, y: event.y });
      if (event.kind === 'cast') cues.push({ kind: event.abilityKind === 'melee' || event.abilityKind === 'dash' ? 'swing' : 'magic', x: event.x, y: event.y });
    }
    for (const windup of windups) {
      const id = `boss:${windup.bossId}:${windup.startedAt}`;
      if (this.heard.has(id) || time < windup.startedAt) continue;
      this.heard.set(id, windup.resolvesAt + 5000);
      if (time - windup.startedAt < 350) cues.push({ kind: windup.kind === 'charge' ? 'swing' : 'magic', x: windup.x, y: windup.y, heavy: true });
    }
    return cues;
  }
}

export function soundPosition(source: Vec2, listener: Vec2): { volume: number; pan: number } {
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  return { volume: Math.max(0, 1 - distance / 700) ** 2, pan: Math.max(-1, Math.min(1, (source.x - listener.x) / 450)) };
}

/** Small procedural effects: no downloads, audio assets or additional network messages. */
export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private voices = 0;
  private active = false;
  private readonly cues = new SoundCues();
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem('riftlands.audio.muted') === 'true'; } catch { /* Optional storage. */ }
  }

  unlock = (): void => {
    if (this.muted) return;
    try {
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        this.master = context.createGain();
        this.master.gain.value = this.active ? 0.45 : 0;
        this.master.connect(context.destination);
        this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional in browsers without Web Audio support. */ }
  };

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted || !this.active ? 0 : 0.45, this.context.currentTime, 0.015);
    try { localStorage.setItem('riftlands.audio.muted', String(muted)); } catch { /* Optional storage. */ }
    if (!muted) this.unlock();
  }

  reset(): void { this.cues.reset(); }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) this.reset();
    if (this.master && this.context) this.master.gain.setTargetAtTime(active && !this.muted ? 0.45 : 0, this.context.currentTime, 0.015);
  }

  update(self: Actor, actors: Actor[], events: GameEvent[], windups: BossWindup[], time: number): void {
    if (this.muted || this.context?.state !== 'running') { this.cues.reset(); return; }
    const nearby = actors.filter(actor => actor.id !== self.id && Math.hypot(actor.x - self.x, actor.y - self.y) < 700);
    nearby.push(self);
    const cues = this.cues.sample(nearby, events, windups, time);
    // Keep nearby sounds first and bound the mix during crowded fights.
    cues.sort((a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y));
    for (const cue of cues) this.play(cue, self);
  }

  private play(cue: SoundCue, listener: Vec2): void {
    const context = this.context!, master = this.master!;
    const { volume, pan } = soundPosition(cue, listener);
    if (volume < 0.01 || this.voices >= 24) return;
    const step = cue.kind === 'step', magic = cue.kind === 'magic', hit = cue.kind === 'hit';
    const duration = step ? 0.09 : magic ? 0.24 : 0.15;
    const now = context.currentTime;
    const gain = context.createGain(), stereo = context.createStereoPanner(), filter = context.createBiquadFilter();
    const source = magic ? context.createOscillator() : context.createBufferSource();
    if (source instanceof OscillatorNode) {
      source.type = 'sine';
      source.frequency.setValueAtTime(cue.heavy ? 140 : 620, now);
      source.frequency.exponentialRampToValueAtTime(cue.heavy ? 55 : 240, now + duration);
    } else source.buffer = this.noise!;
    filter.type = 'lowpass';
    filter.frequency.value = step ? (cue.heavy ? 180 : 480) : hit ? 1100 : 2300;
    stereo.pan.value = pan;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume * (step ? 0.18 : 0.32), now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(stereo).connect(master);
    this.voices++;
    source.onended = () => { this.voices--; source.disconnect(); filter.disconnect(); gain.disconnect(); stereo.disconnect(); };
    source.start(now); source.stop(now + duration + 0.01);
  }
}
