export const PERF_FEATURES = ['terrain','masks','paint','sea','sprites','assets','weather'] as const;
export type PerfFeature=typeof PERF_FEATURES[number];
type Values=Record<string,number|string|boolean|null>;
interface FrameSample {seq:number;atMs:number;intervalMs:number|null;targetFps:number;cpuMs:number;phases:Record<string,number>;state:Values;flags:Record<PerfFeature,boolean>;}
interface LogEvent {atMs:number;kind:string;data:Values;}
class Ring<T> {
  private items:T[]=[];private next=0;
  constructor(private readonly limit:number){}
  push(value:T):void {if(this.items.length<this.limit)this.items.push(value);else{this.items[this.next]=value;this.next=(this.next+1)%this.limit;}}
  values():T[]{return this.next?[...this.items.slice(this.next),...this.items.slice(0,this.next)]:this.items.slice();}
  clear():void {this.items=[];this.next=0;}
}
const allFeatures=()=>Object.fromEntries(PERF_FEATURES.map(key=>[key,true])) as Record<PerfFeature,boolean>;
const stats=(values:number[])=>{
  if(!values.length)return {samples:0,meanMs:null,p50Ms:null,p95Ms:null,p99Ms:null,maxMs:null};
  const sorted=values.slice().sort((a,b)=>a-b),p=(n:number)=>sorted[Math.max(0,Math.ceil(n*sorted.length)-1)];
  return {samples:values.length,meanMs:values.reduce((a,b)=>a+b,0)/values.length,p50Ms:p(.5),p95Ms:p(.95),p99Ms:p(.99),maxMs:sorted.at(-1)!};
};
/** Opt-in, bounded, in-memory telemetry. No console spam, pixel readbacks or
 * synchronous storage. Phase durations are JS/Canvas submission, not GPU time. */
export class PerformanceLog {
  active=false;
  flags=allFeatures();
  readonly frames=new Ring<FrameSample>(3600);
  private raf=new Ring<number>(7200);
  private work=new Ring<{atMs:number;name:string;durationMs:number}>(12000);
  private events=new Ring<LogEvent>(256);
  private longTasks=new Ring<{type:string;atMs:number;durationMs:number;blockingMs:number|null}>(128);
  private current?:FrameSample;
  private started=0;private stopped=0;private seq=0;private frameStart=0;
  private previousFrame?:number;private previousRaf?:number;
  private lastSnapshot?:number;
  private lastJankEvent=-Infinity;
  private metadata:Record<string,unknown>={};
  private stopTimer?:ReturnType<typeof setTimeout>;
  private observers:{observer:PerformanceObserver;type:string}[]=[];
  onChange?:(reason:'start'|'stop'|PerfFeature)=>void;
  constructor(private readonly clock=()=>performance.now()){}
  feature(key:PerfFeature):boolean {return !this.active||this.flags[key];}
  start(metadata:Record<string,unknown>={},durationMs=60_000):void {
    if(this.active)this.stop();
    this.frames.clear();this.raf.clear();this.work.clear();this.events.clear();this.longTasks.clear();
    this.started=this.clock();this.stopped=0;this.seq=0;this.previousFrame=this.previousRaf=this.lastSnapshot=undefined;
    this.lastJankEvent=-Infinity;
    this.metadata=metadata;this.flags=allFeatures();this.active=true;
    this.observe();this.event('capture-start',{durationMs});
    if(durationMs>0)this.stopTimer=setTimeout(()=>this.stop(),durationMs);
    this.onChange?.('start');
  }
  stop():void {
    if(!this.active)return;
    this.event('capture-stop',{});this.stopped=this.clock();
    for(const {observer,type} of this.observers){for(const e of observer.takeRecords())this.recordLong(type,e);observer.disconnect();}this.observers=[];
    this.active=false;this.current=undefined;
    if(this.stopTimer)clearTimeout(this.stopTimer);this.stopTimer=undefined;
    this.onChange?.('stop');
  }
  setFeature(key:PerfFeature,enabled:boolean):void {
    if(!this.active)return;
    this.flags[key]=enabled;this.event('feature',{feature:key,enabled});this.onChange?.(key);
  }
  visibility(hidden:boolean):void {
    if(!this.active)return;
    this.event('visibility',{hidden});this.previousFrame=this.previousRaf=undefined;
  }
  observeRaf(now:number):void {
    if(!this.active)return;
    if(this.previousRaf!==undefined&&now>this.previousRaf)this.raf.push(now-this.previousRaf);
    this.previousRaf=now;
  }
  beginFrame(now:number,targetFps:number):void {
    if(!this.active)return;
    this.frameStart=this.clock();
    this.current={seq:++this.seq,atMs:now-this.started,intervalMs:this.previousFrame===undefined?null:Math.max(0,now-this.previousFrame),
      targetFps,cpuMs:0,phases:{},state:{},flags:{...this.flags}};
    this.previousFrame=now;
  }
  endFrame():void {
    const sample=this.current;if(!sample)return;
    sample.cpuMs=this.clock()-this.frameStart;this.frames.push(sample);this.current=undefined;
    // Every gap remains in frames; throttle duplicate events so that stalls
    // cannot evict configuration changes and server samples from the event log.
    if(((sample.intervalMs??0)>50||sample.cpuMs>50)&&sample.atMs-this.lastJankEvent>=1000){
      this.lastJankEvent=sample.atMs;this.event('jank',{frameSeq:sample.seq,previousFrameSeq:sample.seq-1,gapBeforeMs:sample.intervalMs,cpuMs:sample.cpuMs});
    }
  }
  begin():number {return this.active?this.clock():-1;}
  end(name:string,start:number):void {
    if(!this.active||start<0)return;
    const durationMs=Math.max(0,this.clock()-start);
    if(this.current)this.current.phases[name]=(this.current.phases[name]??0)+durationMs;
    else this.work.push({atMs:this.clock()-this.started,name,durationMs});
  }
  measure<T>(name:string,action:()=>T):T {
    if(!this.active)return action();
    const start=this.begin();try{return action();}finally{this.end(name,start);}
  }
  state(values:Values):void {if(this.current)Object.assign(this.current.state,values);}
  event(kind:string,data:Values):void {if(this.active)this.events.push({atMs:this.clock()-this.started,kind,data});}
  snapshot():void {
    if(!this.active)return;
    const now=this.clock();if(this.lastSnapshot!==undefined)this.work.push({atMs:now-this.started,name:'snapshot-arrival-gap',durationMs:now-this.lastSnapshot});
    this.lastSnapshot=now;
  }
  snapshotAge():number|null {return this.lastSnapshot===undefined?null:this.clock()-this.lastSnapshot;}
  sampleBrowser():void {
    if(!this.active)return;
    const memory=(performance as Performance&{memory?:{usedJSHeapSize:number;totalJSHeapSize:number;jsHeapSizeLimit:number}}).memory;
    this.event('browser-sample',{heapUsedBytes:memory?.usedJSHeapSize??null,heapAllocatedBytes:memory?.totalJSHeapSize??null,heapLimitBytes:memory?.jsHeapSizeLimit??null});
  }
  summary(recentMs?:number){
    const now=(this.active?this.clock():this.stopped)-this.started;
    const frames=this.frames.values().filter(f=>recentMs===undefined||f.atMs>=now-recentMs);
    const intervals=frames.flatMap(f=>f.intervalMs===null?[]:[f.intervalMs]);
    const elapsed=intervals.reduce((a,b)=>a+b,0);
    const phaseNames=new Set(frames.flatMap(f=>Object.keys(f.phases)));
    const phases=Object.fromEntries([...phaseNames].map(name=>[name,{...stats(frames.map(f=>f.phases[name]??0)),whenActive:stats(frames.flatMap(f=>f.phases[name]>0?[f.phases[name]]:[]))}]));
    const last=frames.at(-1);
    return {frames:frames.length,fps:elapsed>0?intervals.length*1000/elapsed:null,frame:stats(intervals),cpu:stats(frames.map(f=>f.cpuMs)),
      gapsOver50ms:intervals.filter(v=>v>50).length,gapsOver100ms:intervals.filter(v=>v>100).length,
      overBudgetFrames:frames.filter(f=>f.intervalMs!==null&&f.intervalMs>1000/f.targetFps*1.5).length,
      frameCpuBusyPercent:elapsed>0?frames.reduce((n,f)=>n+f.cpuMs,0)/elapsed*100:null,
      phases,lastState:last?.state??{},lastTargetFps:last?.targetFps??null};
  }
  report(){
    const frames=this.frames.values(),work=this.work.values(),names=new Set(work.map(w=>w.name));
    const longEntries=this.longTasks.values();
    const segments:{key:string;frames:FrameSample[]}[]=[];
    for(const frame of frames){const key=JSON.stringify([frame.targetFps,frame.state.playing??null,frame.state.weather??null,frame.flags]);
      if(segments.at(-1)?.key===key)segments.at(-1)!.frames.push(frame);else segments.push({key,frames:[frame]});}
    return {schema:1,createdAt:new Date().toISOString(),durationMs:(this.active?this.clock():this.stopped)-this.started,active:this.active,
      limits:{frames:3600,asyncWork:12000,events:256,longEntries:128,rafIntervals:7200},metadata:this.metadata,
      interpretation:{fps:'Rendered frame cadence, measured before pacing/clamping; target is separate. Hidden-tab intervals excluded.',
        timing:'CPU/Canvas submission only. Nested phases overlap: do not add parent and child durations.',
        cpu:'frameCpuBusyPercent covers measured frame JS only, not asynchronous callbacks or device-wide CPU utilisation.',
        attribution:'A gap BEFORE frame N may be caused by frame N-1, asynchronous work, rendering/compositing or OS scheduling; it is not proof that phase N caused it.',
        unsupported:'GPU utilisation, temperature, battery throttling, resident VRAM and GC pauses cannot be measured reliably here. Null means unavailable.',
        retained:'Rolling bounded samples; exports and sorting happen on demand, outside measured frames. No account names, tokens, payloads or coordinates recorded.'},
      support:{longtask:typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask'),
        longAnimationFrame:typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')},
      summary:this.summary(),raf:stats(this.raf.values()),async:Object.fromEntries([...names].map(n=>[n,stats(work.filter(w=>w.name===n).map(w=>w.durationMs))])),
      segments:segments.map(({frames:s})=>{const intervals=s.slice(1).flatMap(f=>f.intervalMs===null?[]:[f.intervalMs]),elapsed=intervals.reduce((a,b)=>a+b,0);
        return {fromMs:s[0].atMs,toMs:s.at(-1)!.atMs,frames:s.length,flags:s[0].flags,weather:s[0].state.weather??null,targetFps:s[0].targetFps,
          fps:elapsed?intervals.length*1000/elapsed:null,interval:stats(intervals),cpu:stats(s.map(f=>f.cpuMs))};}),
      jankEvidence:frames.map((f,i)=>({f,i})).filter(({f})=>(f.intervalMs??0)>50||f.cpuMs>50)
        .sort((a,b)=>Math.max(b.f.intervalMs??0,b.f.cpuMs)-Math.max(a.f.intervalMs??0,a.f.cpuMs)).slice(0,20).map(({f,i})=>{
          const previous=frames[i-1],from=previous?.atMs??Math.max(0,f.atMs-(f.intervalMs??0));
          return {frame:f,previousFrame:previous??null,asyncDuringGap:work.filter(w=>w.atMs>=from&&w.atMs<=f.atMs),
            overlappingLongEntries:longEntries.filter(e=>e.atMs<f.atMs&&e.atMs+e.durationMs>from)};
        }),
      frames,asyncWork:work,events:this.events.values(),longEntries};
  }
  private observe():void {
    if(typeof PerformanceObserver==='undefined')return;
    for(const type of ['longtask','long-animation-frame']){
      if(!PerformanceObserver.supportedEntryTypes.includes(type))continue;
      try{
        const observer=new PerformanceObserver(list=>{
          if(!this.active)return;
          for(const e of list.getEntries())this.recordLong(type,e);
        });observer.observe({type,buffered:false});this.observers.push({observer,type});
      }catch{/* Unsupported observer types must not prevent capture. */}
    }
  }
  private recordLong(type:string,e:PerformanceEntry):void {
    if(e.startTime>=this.started)this.longTasks.push({type,atMs:e.startTime-this.started,durationMs:e.duration,
      blockingMs:'blockingDuration' in e?Number(e.blockingDuration):null});
  }
}
export const performanceLog=new PerformanceLog();
