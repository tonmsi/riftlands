/** Bounds password work across sockets and reconnects, with no unbounded work queue. */
export class AuthBudget {
  private active = 0;
  private entries = new Map<string, { tokens: number; at: number }>();

  acquire(ip: string, now: number): (() => void) | null {
    for (const [key, entry] of this.entries) if (now - entry.at > 60_000) this.entries.delete(key);
    let entry = this.entries.get(ip);
    if (!entry) {
      if (this.entries.size >= 4096) return null;
      entry = { tokens: 8, at: now };
      this.entries.set(ip, entry);
    }
    entry.tokens = Math.min(8, entry.tokens + Math.max(0, now - entry.at) / 7500);
    entry.at = now;
    if (this.active >= 4 || entry.tokens < 1) return null;
    entry.tokens--;
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}
