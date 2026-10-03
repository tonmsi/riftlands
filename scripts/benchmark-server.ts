import { performance } from 'node:perf_hooks';
import { WorldSimulation } from '../server/simulation';
import type { Account } from '../server/store';
import { SNAPSHOT_RATE, TICK_RATE } from '../shared/config';
import { SnapshotEncoder } from '../shared/snapshot-stream';

// CPU/JSON microbenchmark, not a socket, bandwidth, TLS or mobile device capacity test.
const requestedPlayers = Number(process.argv.find(arg => arg.startsWith('--players='))?.split('=')[1]);
const layout = process.argv.find(arg => arg.startsWith('--layout='))?.split('=')[1];
const counts = [1, 16, 64, 128].filter(count => !requestedPlayers || count === requestedPlayers);
if (!counts.length || (layout && !['crowded', 'spread'].includes(layout))) throw new Error('Invalid benchmark scenario.');
for (const spread of [false, true].filter(spread => !layout || layout === (spread ? 'spread' : 'crowded'))) for (const count of counts) {
  const sim = new WorldSimulation();
  const streams = new Map<string, SnapshotEncoder>();
  for (let i = 0; i < count; i++) {
    const account: Account = { id: `bench-${i}`, name: `Bench ${i}`, nameLower: `bench${i}`, salt: '', passwordHash: '', xp: 0, kills: 0, deaths: 0, friends: [], requests: [], lastSeen: 0 };
    const actor = sim.addPlayer(account, 'mage');
    streams.set(account.id, new SnapshotEncoder());
    if (spread) { actor.x = i * 1800; actor.y = 1800; }
  }
  const steps: number[] = [], broadcasts: number[] = [];
  let bytes = 0, fullBytes = 0, measuredSnapshots = 0;
  for (let tick = 0; tick < 360; tick++) {
    for (const id of sim.players.keys()) sim.enqueueInput(id, { seq: tick + 1, dx: process.argv.includes('--moving') ? .7 : 0, dy: 0, aim: 0 });
    const start = performance.now(); sim.step();
    if (tick >= 60) steps.push(performance.now() - start);
    if (tick % (TICK_RATE / SNAPSHOT_RATE) === 0) {
      const started = performance.now();
      for (const id of sim.players.keys()) {
        const snapshot = sim.snapshotFor(id)!;
        const prepared = streams.get(id)!.prepare(snapshot, { id: 'world', epoch: 1 });
        const size = Buffer.byteLength(JSON.stringify(prepared.packet));
        prepared.commit();
        if (tick >= 60) bytes += size;
      }
      if (tick >= 60) { broadcasts.push(performance.now() - started); measuredSnapshots++; }
      // Separate full-frame serialization from the timed production path.
      if (tick >= 60) for (const id of sim.players.keys()) fullBytes += Buffer.byteLength(JSON.stringify(sim.snapshotFor(id)));
    }
  }
  const p95 = (values: number[]) => +values.sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1].toFixed(2);
  console.log(JSON.stringify({ layout: spread ? 'spread' : 'crowded', moving: process.argv.includes('--moving'), players: count, npcs: sim.npcs.size, stepP95Ms: p95(steps), broadcastP95Ms: p95(broadcasts), snapshotKiBPerClient: +(bytes / measuredSnapshots / count / 1024).toFixed(1), outboundMiBPerSecond: +(bytes / measuredSnapshots * SNAPSHOT_RATE / 1048576).toFixed(2), fullOutboundMiBPerSecond: +(fullBytes / measuredSnapshots * SNAPSHOT_RATE / 1048576).toFixed(2), payloadReductionPercent: +((1 - bytes / fullBytes) * 100).toFixed(1) }));
}
