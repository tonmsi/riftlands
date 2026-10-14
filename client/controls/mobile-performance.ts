export const MOBILE_FRAME_RATE_KEY = 'riftlands.mobile.frame-rate';
export type MobileFrameRateMode = 'auto' | 30 | 60;
export function parseMobileFrameRate(raw: string | null): MobileFrameRateMode {
  return raw === '30' ? 30 : raw === '60' ? 60 : 'auto';
}

/** Prefer a stable cadence if a phone consistently misses 60 Hz deadlines. */
export class MobileFrameRate {
  fps: 30 | 60 = 60;
  private samples = 0;
  private late = 0;
  reset(): void { this.fps = 60; this.samples = this.late = 0; }
  observe(interval: number): void {
    if (this.fps === 30) return;
    this.samples++; if (interval > 24) this.late++;
    if (this.samples >= 60) {
      if (this.late >= 18) this.fps = 30;
      this.samples = this.late = 0;
    }
  }
}
