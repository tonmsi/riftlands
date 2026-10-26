/** Keep playback progress while streams are unloaded outside listening range. */
export class MusicPositions {
  private entries = new Map<string, { src: string; time: number }>();
  forget(id: string): void { this.entries.delete(id); }
  remember(id: string, src: string, media: HTMLAudioElement): void {
    if (!Number.isFinite(media.currentTime) || media.currentTime <= 0) return;
    this.entries.delete(id); this.entries.set(id, { src, time: media.currentTime });
    if (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!);
  }
  restore(id: string, src: string, media: HTMLAudioElement): void {
    const saved = this.entries.get(id); if (!saved || saved.src !== src) return;
    const seek = () => {
      media.onloadedmetadata = null;
      if (Number.isFinite(media.duration) && media.duration > 0) {
        try { media.currentTime = saved.time % media.duration; } catch { /* Unsupported seeks start normally. */ }
      }
    };
    if (media.readyState >= 1) seek(); else media.onloadedmetadata = seek;
  }
}
