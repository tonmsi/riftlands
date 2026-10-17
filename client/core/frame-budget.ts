/** Shared by every device; CSS size and input coordinates stay unchanged. */
export const FPS_STORAGE_KEY='riftlands.fps-limit.v1';
export const FPS_LIMITS=[20,30,45,60,90,120,144,165,240] as const;
export function parseFpsLimit(value:unknown):number {
  const n=typeof value==='string'||typeof value==='number'?Number(value):NaN;
  return (FPS_LIMITS as readonly number[]).includes(n)?n:60;
}
export function readFpsLimit():number {try{return parseFpsLimit(localStorage.getItem(FPS_STORAGE_KEY));}catch{return 60;}}

export function renderDpr(deviceDpr: number, width: number, height: number): number {
  return Math.min(deviceDpr || 1, 1.5, Math.sqrt(3_000_000 / Math.max(1, width * height)));
}

/** Deadline-based pacing preserves the average rate on 90/120/144 Hz screens. */
export class FrameBudget {
  private next = 0;
  private rate = 0;

  reset(): void { this.next = 0; }

  ready(now: number, fps = 60): boolean {
    const interval = 1000 / fps;
    if (this.rate !== fps) { this.rate = fps; this.next = now; }
    if (now + 0.1 < this.next) return false;
    // Never catch up missed frames after a stall or a hidden tab.
    this.next = now - this.next >= interval ? now + interval : this.next + interval;
    return true;
  }
}
