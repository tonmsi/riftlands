import test from 'node:test';
import assert from 'node:assert/strict';
import {didRespawn} from '../client/core/respawn';
import type {Actor} from '../shared/types';

test('respawn detection ignores initial snapshots and repeated or unrelated states',()=>{
  const alive={id:'self',hp:100,deaths:0} as Actor,dead={...alive,hp:0,deaths:1};
  const respawned={...dead,hp:100,x:5000,y:4000};
  assert.ok(didRespawn(dead,respawned));assert.ok(didRespawn(alive,respawned));
  assert.equal(didRespawn(null,respawned),false);assert.equal(didRespawn(respawned,respawned),false);
  assert.equal(didRespawn(alive,dead),false);assert.equal(didRespawn(dead,{...respawned,id:'other'}),false);
  assert.equal(didRespawn(alive,{...alive,x:5000}),false);
});
