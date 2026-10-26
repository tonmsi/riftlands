import type { Vec2 } from '../../shared/types';
import type { WorldSoundPoint } from '../../shared/world-schema';
import { MusicPositions } from './music-position';

/** Listener and document coordinates are in tiles. Smooth at both radius boundaries. */
export function soundPointMix(point: WorldSoundPoint, listener: Vec2): { volume: number; pan: number } {
  const dx = point.x + .5 - listener.x, dy = point.y + .5 - listener.y;
  const t = Math.max(0, Math.min(1, (Math.hypot(dx, dy) - point.innerRadius) / (point.radius - point.innerRadius)));
  return { volume: (point.music?.volume ?? 0) * (1 - t * t * (3 - 2 * t)), pan: Math.max(-1, Math.min(1, dx / point.radius)) };
}

interface Voice { media: HTMLAudioElement; source: MediaElementAudioSourceNode; gain: GainNode; pan: StereoPannerNode; src: string; restart: boolean; }
export class SoundPointPlayer {
  private voices = new Map<string, Voice>();
  private positions = new MusicPositions();
  private output: GainNode;
  private volume = 1;
  private muted = false;
  private failed = new Map<string, string>();
  constructor(private context: AudioContext) {
    this.output = context.createGain(); this.output.connect(context.destination);
  }
  setVolume(volume: number): void { this.volume = volume; this.syncVolume(); }
  setMuted(muted: boolean): void { this.muted = muted; this.syncVolume(); if (muted) this.stop(); }
  private syncVolume(): void { this.output.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, .05); }
  update(points: readonly WorldSoundPoint[], listener: Vec2, mapId: string): void {
    if (this.muted || !this.volume) { this.stop(); return; }
    // Bound simultaneous streams, prefer the most audible sources deterministically.
    const audible = points.map(point => ({ point, mix: soundPointMix(point, listener) }))
      .filter(({ mix }) => mix.volume > 0).sort((a, b) => b.mix.volume - a.mix.volume || a.point.id.localeCompare(b.point.id)).slice(0, 4);
    const desired = new Set(audible.map(({ point }) => `${mapId}:${point.id}`));
    for (const id of this.failed.keys()) if (!desired.has(id)) this.failed.delete(id);
    for (const [id, voice] of this.voices) if (!desired.has(id)) this.remove(id, voice);
    for (const { point, mix } of audible) {
      const id = `${mapId}:${point.id}`, src = point.music!.src;
      if (point.restartOnEnter) this.positions.forget(id);
      if (this.failed.get(id) === src) continue;
      let voice = this.voices.get(id);
      if (voice && voice.src !== src) { this.remove(id, voice); voice = undefined; }
      if (!voice) {
        const media = new Audio(); media.preload = 'none'; media.loop = true; media.src = src;
        const source = this.context.createMediaElementSource(media), gain = this.context.createGain(), pan = this.context.createStereoPanner();
        gain.gain.value = 0;
        source.connect(gain).connect(pan).connect(this.output);
        voice = { media, source, gain, pan, src, restart: point.restartOnEnter === true }; this.voices.set(id, voice);
        if (!voice.restart) this.positions.restore(id, src, media);
        const current = voice;
        void media.play().catch(() => {
          if (this.voices.get(id) === current) { this.failed.set(id, src); this.remove(id, current); }
        });
      }
      voice.restart = point.restartOnEnter === true;
      voice.gain.gain.setTargetAtTime(mix.volume, this.context.currentTime, .1);
      voice.pan.pan.setTargetAtTime(mix.pan, this.context.currentTime, .1);
    }
  }
  stop(): void { for (const [id, voice] of this.voices) this.remove(id, voice); this.failed.clear(); }
  private remove(id: string, voice: Voice): void {
    if (this.voices.get(id) !== voice) return;
    if (!voice.restart) this.positions.remember(id, voice.src, voice.media);
    voice.media.onloadedmetadata = null;
    voice.media.pause(); voice.media.removeAttribute('src'); voice.media.load();
    voice.source.disconnect(); voice.gain.disconnect(); voice.pan.disconnect(); this.voices.delete(id);
  }
}
