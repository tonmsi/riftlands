import test from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceLog } from '../client/core/performance-log';

test('performance logging measures actual cadence, unclamped stalls and inclusive phase costs',()=>{
  let now=1000;const log=new PerformanceLog(()=>now);log.start({},0);
  for(const dt of [0,1000/30,1000/30,500]){
    now+=dt;log.observeRaf(now);log.beginFrame(now,60);
    const start=log.begin();now+=2;log.end('terrain',start);log.endFrame();
  }
  const report=log.report();assert.equal(report.summary.lastTargetFps,60);
  assert.ok(report.summary.fps!<10);assert.ok(report.summary.frame.maxMs!>=500);
  assert.equal(report.summary.phases.terrain.meanMs,2);assert.equal(report.summary.gapsOver100ms,1);
  const spike=report.events.find(e=>e.kind==='jank')!;assert.equal(spike.data.frameSeq,4);assert.equal(spike.data.previousFrameSeq,3);
  log.stop();
});

test('hidden intervals are excluded, asynchronous work stays separate and A/B segments preserve flags',()=>{
  let now=0;const log=new PerformanceLog(()=>now);log.start({},0);
  log.beginFrame(now,30);log.endFrame();now=34;log.beginFrame(now,30);log.endFrame();
  log.visibility(true);now=10000;log.visibility(false);log.beginFrame(now,30);log.endFrame();
  log.measure('snapshot-callback',()=>{now+=12;});log.snapshot();now+=50;log.snapshot();
  log.setFeature('sea',false);log.beginFrame(now,60);log.state({weather:'rain'});log.endFrame();
  const report=log.report();assert.equal(report.summary.gapsOver100ms,0);
  assert.equal(report.async['snapshot-callback'].meanMs,12);assert.equal(report.async['snapshot-arrival-gap'].meanMs,50);
  assert.equal(report.segments.length,2);assert.equal(report.segments[1].flags.sea,false);assert.equal(report.segments[1].weather,'rain');
  assert.equal(log.feature('sea'),false);log.stop();assert.equal(log.feature('sea'),true);
});

test('capture buffers remain bounded, stop freezes the report and disabled timing avoids clock reads',()=>{
  let now=0,reads=0;const log=new PerformanceLog(()=>{reads++;return now;});
  assert.equal(log.begin(),-1);assert.equal(log.measure('disabled',()=>7),7);assert.equal(reads,0);
  log.start({},0);
  for(let i=0;i<3700;i++){now=i*17;log.beginFrame(now,60);log.state({actors:2});log.endFrame();log.event('test',{i});}
  log.stop();const report=log.report();assert.equal(report.frames.length,3600);assert.equal(report.frames[0].seq,101);assert.equal(report.events.length,256);
  now+=10000;assert.equal(log.report().durationMs,report.durationMs);
  log.start({},0);assert.equal(log.report().frames.length,0);assert.ok(log.feature('sea'));log.stop();
});

test('capture stops automatically without leaving feature overrides enabled',async()=>{
  const log=new PerformanceLog();log.start({},10);log.setFeature('weather',false);
  await new Promise(r=>setTimeout(r,30));assert.equal(log.active,false);assert.equal(log.feature('weather'),true);
});
