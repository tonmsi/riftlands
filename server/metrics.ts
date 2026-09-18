/** Bounded operational samples; never retain per-account or credential data. */
export class NetworkMetrics {
  private steps: number[] = [];
  private snapshots: number[] = [];
  snapshotBytes = 0;
  snapshotsSent = 0;
  snapshotsSkipped = 0;
  catchupTicks = 0;
  constructor(private readonly startedAt = performance.now()) {}
  private record(samples: number[], value: number): void {
    samples.push(value);
    if (samples.length > 600) samples.shift();
  }
  step(ms: number): void { this.record(this.steps, ms); }
  snapshot(ms: number): void { this.record(this.snapshots, ms); }
  read(now = performance.now()) {
    const summarize = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { samples: sorted.length, p95Ms: +(sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0).toFixed(3), maxMs: +(sorted.at(-1) ?? 0).toFixed(3) };
    };
    return { step: summarize(this.steps), snapshot: summarize(this.snapshots), snapshotsSent: this.snapshotsSent,
      snapshotsSkipped: this.snapshotsSkipped, snapshotBytes: this.snapshotBytes,
      averageSnapshotBytesPerSecond: Math.round(this.snapshotBytes / Math.max(1, (now - this.startedAt) / 1000)), catchupTicks: this.catchupTicks };
  }
}
