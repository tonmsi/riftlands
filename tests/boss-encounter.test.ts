import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineFixture } from './fixtures/dungeon-engine';
import { AccountStore } from '../server/store';
import { WorldSimulation } from '../server/simulation';
import { insideDungeonRegion } from '../shared/dungeons';

test('boss pursues across the combat region without resetting health or returning to spawn, even outside initial aggro', t => {
    const f = engineFixture(); t.after(f.cleanup);
    Object.assign(f.player,{x:f.boss.x+80,y:f.boss.y}); f.sim.step();
    Object.assign(f.player,f.bundle.definition.spawnPoints.party[0]);
    const region = f.encounter.dungeon.encounter.regions;
    region.bossAggro = { kind: 'circle', center: { ...f.boss }, radius: 20 };
    f.boss.hp = 123;
    f.player.x += 150; f.player.hp = f.player.maxHp = 10000;
    const initial = Math.hypot(f.player.x-f.boss.x, f.player.y-f.boss.y);
    for(let i=0;i<20;i++) f.sim.step(.1);
    assert.equal(f.encounter.targetId, f.player.id);
    assert.equal(f.encounter.ownerId, f.player.id);
    assert.equal(f.boss.hp, 123);
    assert.ok(Math.hypot(f.player.x-f.boss.x,f.player.y-f.boss.y) < initial);
    assert.ok(insideDungeonRegion(region.bossLeash, f.boss, -f.boss.radius));
    f.player.hp = 0; f.player.deadUntil = f.sim.now+5000; f.sim.step();
    assert.equal(f.encounter.ownerId, undefined);
    assert.equal(f.boss.hp, f.boss.maxHp);
    assert.deepEqual({ x:f.boss.x, y:f.boss.y },f.encounter.dungeon.spawnPoints.boss);
});

test('all boss movement including recovery is clamped to the encounter leash', t => {
    const f = engineFixture(); t.after(f.cleanup);
    const probe = f.encounter as unknown as { moveBody(position: {x:number;y:number}): void };
    for(const direction of [{x:1,y:0},{x:0,y:1},{x:-1,y:0},{x:0,y:-1}]) {
        Object.assign(f.boss, f.bundle.definition.spawnPoints.boss);
        probe.moveBody({x:f.boss.x+direction.x*10000,y:f.boss.y+direction.y*10000});
        assert.ok(insideDungeonRegion(f.bundle.definition.encounter.regions.bossLeash,f.boss,-f.boss.radius));
    }
});

test('defeat produces private loot once; saved corpse, respawn and collected gold survive restart', t => {
    const dir = mkdtempSync(join(tmpdir(),'riftlands-boss-')); t.after(()=>rmSync(dir,{recursive:true,force:true}));
    const store = new AccountStore(join(dir,'accounts.json')), f = engineFixture(store); t.after(f.cleanup);
    f.boss.hp = 0;
    const rewards = f.encounter.killed(f.player.id,f.sim.now,f.sim.world);
    assert.equal(rewards.length,1);
    assert.equal(f.encounter.state.drops.length,1);
    assert.equal(f.encounter.killed(f.player.id,f.sim.now,f.sim.world).length,0);
    const restoredStore = new AccountStore(store.path), restored = new WorldSimulation(734291,f.sim.now+1000,restoredStore);
    const encounter = restored.bosses.get(f.boss.id)!;
    assert.equal(encounter.boss.hp,0);
    assert.equal(encounter.state.respawnAt,f.encounter.state.respawnAt);
    const account = restoredStore.accounts.get(f.account.id)!;
    const player = restored.addPlayer(account,'warrior'); Object.assign(player,encounter.state.corpse);
    encounter.collect(player,account,true,restored.now);
    assert.equal(account.gold,f.encounter.definition.reward.gold);
    encounter.collect(player,account,true,restored.now);
    assert.equal(account.gold,f.encounter.definition.reward.gold);
    assert.equal(new AccountStore(store.path).accounts.get(account.id)!.gold,account.gold);
    assert.equal(new AccountStore(store.path).bossStates[f.boss.id].drops.length,0);
});

test('both reusable boss behaviors remain usable without historical maps and heavy attacks remain telegraphed', t => {
    for(const template of [0,1]) {
        const f = engineFixture(undefined,template);
        try {
            const seen = new Set<string>();
            for(let i=0;i<350 && seen.size<3;i++) {
                Object.assign(f.player,{x:f.boss.x+64,y:f.boss.y,hp:10000,maxHp:10000});
                f.sim.step(.1);
                if(f.encounter.windup) { const windup=f.encounter.windup; seen.add(windup.kind); assert.ok(windup.resolvesAt>=f.sim.now); }
            }
            assert.deepEqual([...seen].sort(),['charge','nova','slam']);
        } finally { f.cleanup(); }
    }
});
