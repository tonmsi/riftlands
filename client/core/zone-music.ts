import type { ZoneMusic } from '../../shared/world-schema';

export const MUSIC_FADE_SECONDS = 5;
interface Voice {
  media: HTMLAudioElement; gain: GainNode; source: MediaElementAudioSourceNode;
  timer?: ReturnType<typeof setTimeout>; started: boolean;
  from: number; target: number; at: number;
}

/** Streaming, non-spatial music. Only boundary changes schedule browser-native fades. */
export class ZoneMusicPlayer {
  private voices = new Map<string, Voice>();
  private desired?: ZoneMusic;
  private muted = false;
  private volume = 1;
  private unmuteUntil = 0;
  private output: GainNode;
  constructor(private context: AudioContext) {
    this.output = context.createGain(); this.output.connect(context.destination);
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) return;
    this.muted = muted;
    const now = this.context.currentTime;
    const current = this.output.gain.value;
    this.output.gain.cancelScheduledValues(now); this.output.gain.setValueAtTime(current, now);
    if (muted) { this.unmuteUntil = 0; this.output.gain.setValueAtTime(0, now); }
    else {
      this.unmuteUntil = now + MUSIC_FADE_SECONDS;
      this.output.gain.linearRampToValueAtTime(this.volume, now + MUSIC_FADE_SECONDS);
      const track = this.desired; this.desired = undefined; this.select(track);
    }
  }

  setVolume(volume: number): void {
    if (volume === this.volume) return;
    this.volume = volume;
    const now = this.context.currentTime;
    const current = this.output.gain.value;
    this.output.gain.cancelScheduledValues(now); this.output.gain.setValueAtTime(current, now);
    if (!this.voices.size) this.output.gain.setValueAtTime(this.muted ? 0 : volume, now);
    else this.output.gain.linearRampToValueAtTime(this.muted ? 0 : volume, Math.max(now + .1, this.unmuteUntil));
  }

  select(track?: ZoneMusic): void {
    if (track?.src === this.desired?.src && track?.volume === this.desired?.volume) return;
    this.desired = track ? { ...track } : undefined;
    for (const [src, voice] of this.voices) {
      if (src === track?.src) continue;
      if (voice.timer && voice.target === 0) continue;
      if (!voice.started) { this.remove(src, voice); continue; }
      this.fade(voice, 0);
      voice.timer = setTimeout(() => this.remove(src, voice), MUSIC_FADE_SECONDS * 1000);
    }
    if (!track) return;
    let voice = this.voices.get(track.src);
    if (voice) { this.fade(voice, track.volume); return; }
    if (this.muted) return;
    // Bound playback/decoding even when rapidly crossing several music areas.
    if (this.voices.size >= 2) {
      const [src, old] = this.voices.entries().next().value!;
      this.remove(src, old);
    }
    const media = new Audio();
    media.preload = 'none'; media.loop = true;
    const gain = this.context.createGain(); gain.gain.value = 0;
    const source = this.context.createMediaElementSource(media);
    source.connect(gain).connect(this.output);
    voice = { media, gain, source, started: false, from: 0, target: 0, at: this.context.currentTime };
    this.voices.set(track.src, voice);
    media.src = track.src;
    const current = voice;
    void media.play().then(() => {
      if (this.voices.get(track.src) !== current) return;
      current.started = true;
      this.fade(current, this.desired?.src === track.src ? this.desired.volume : 0);
    }).catch(() => { this.remove(track.src, current); });
  }

  stop(): void {
    this.desired = undefined;
    for (const [src, voice] of this.voices) this.remove(src, voice);
  }

  private fade(voice: Voice, target: number): void {
    clearTimeout(voice.timer); voice.timer = undefined;
    const now = this.context.currentTime;
    const elapsed = Math.max(0, Math.min(1, (now - voice.at) / MUSIC_FADE_SECONDS));
    const value = voice.from + (voice.target - voice.from) * elapsed;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(value, now);
    voice.gain.gain.linearRampToValueAtTime(target, now + MUSIC_FADE_SECONDS);
    voice.from = value; voice.target = target; voice.at = now;
  }

  private remove(src: string, voice: Voice): void {
    if (this.voices.get(src) !== voice) return;
    clearTimeout(voice.timer); voice.media.pause();
    voice.media.removeAttribute('src'); voice.media.load();
    voice.source.disconnect(); voice.gain.disconnect(); this.voices.delete(src);
  }
}
