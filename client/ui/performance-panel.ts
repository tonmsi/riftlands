import { performanceLog as log, PERF_FEATURES, type PerfFeature } from '../core/performance-log';
import './performance-panel.css';
const labels:Record<PerfFeature,string>={terrain:'Terreno completo',masks:'Maschere (off: celle quadrate)',paint:'Macchie pittoriche',sea:'Fasce del mare animate',sprites:'Sprite dei personaggi',assets:'Asset della mappa',weather:'Pioggia e neve'};
const ms=(n:number|null|undefined)=>n==null?'—':n.toFixed(1);

export function installPerformancePanel(root:HTMLElement,metadata:()=>Record<string,unknown>,invalidate:()=>void,release:()=>void):void {
  const panel=document.createElement('aside');panel.id='performance-panel';panel.hidden=true;panel.setAttribute('aria-label','Diagnostica prestazioni');
  panel.innerHTML=`<header><strong id="perf-fps">FPS —</strong><button id="perf-expand" type="button" aria-expanded="true">Dettagli</button><button id="perf-close" type="button" aria-label="Chiudi diagnostica">×</button></header>
    <div class="perf-details"><p>Registra sul telefono mentre cammini nella zona che scatta. Il conteggio riguarda i frame disegnati; il target è separato.</p>
    <div class="perf-actions"><button id="perf-start" type="button">Registra 60 secondi</button><button id="perf-stop" type="button">Ferma</button><button id="perf-export" type="button">Scarica report JSON</button></div>
    <div id="perf-fps-options"></div><output id="perf-live" aria-live="off"></output><p id="perf-result"></p>
    <details><summary>Confronto A/B · solo durante la registrazione</summary><p>Disattiva una voce per volta e ripeti lo stesso percorso. Sono prove visive locali: il mondo salvato e le collisioni restano invariati. Alla fine si ripristina tutto.</p>
    ${PERF_FEATURES.map(key=>`<label><input type="checkbox" data-perf-feature="${key}" checked>${labels[key]}</label>`).join('')}</details>
    <p>Esporta dopo il freeze o al termine della prova. I log restano in memoria e non vengono inviati. GPU, temperatura e carico totale del dispositivo non sono disponibili dal browser.</p></div>`;
  root.append(panel);
  const input=(id:string)=>panel.querySelector<HTMLButtonElement>('#'+id)!;
  const open=()=>{release();panel.hidden=false;panel.dataset.compact='false';input('perf-expand').setAttribute('aria-expanded','true');refresh();};
  for(const parent of root.querySelectorAll('.settings-actions,[data-hub-panel="settings"]')){
    const button=document.createElement('button');button.type='button';button.className='glass hud-menu-button';button.textContent='FPS / Diagnostica';button.dataset.performanceOpen='';button.onclick=open;parent.append(button);
  }
  // A tiny launcher also permits inspecting an actual match with settings closed.
  const launcher=document.createElement('button');launcher.type='button';launcher.id='perf-launcher';launcher.textContent='FPS';launcher.setAttribute('aria-label','Apri diagnostica FPS');launcher.onclick=open;root.append(launcher);
  let hasReport=false,healthTicks=0;
  let healthRequest:AbortController|undefined;
  const sampleServer=async()=>{
    if(!log.active||healthRequest)return;
    const controller=new AbortController();healthRequest=controller;const start=performance.now(),timeout=setTimeout(()=>controller.abort(),2000);
    try{
      const response=await fetch('/health',{cache:'no-store',signal:controller.signal}),data=await response.json();
      const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
      if(!controller.signal.aborted)log.event('server-sample',{available:true,httpStatus:response.status,roundTripMs:performance.now()-start,
        tickCostMs:n(data.tickCostMs),tickRate:n(data.tickRate),snapshotRate:n(data.snapshotRate),activeChunks:n(data.activeChunks),
        stepP95Ms:n(data.metrics?.step?.p95Ms),stepMaxMs:n(data.metrics?.step?.maxMs),snapshotP95Ms:n(data.metrics?.snapshot?.p95Ms),
        snapshotMaxMs:n(data.metrics?.snapshot?.maxMs),snapshotsSkipped:n(data.metrics?.snapshotsSkipped),catchupTicks:n(data.metrics?.catchupTicks)});
    }catch{if(healthRequest===controller)log.event('server-sample',{available:false});}
    finally{clearTimeout(timeout);if(healthRequest===controller)healthRequest=undefined;}
  };
  const refresh=()=>{
    const summary=log.summary(2000),state=summary.lastState;
    input('perf-start').disabled=log.active;input('perf-stop').disabled=!log.active;input('perf-export').disabled=!hasReport;
    for(const checkbox of panel.querySelectorAll<HTMLInputElement>('[data-perf-feature]')){checkbox.checked=log.flags[checkbox.dataset.perfFeature as PerfFeature];checkbox.disabled=!log.active;}
    panel.querySelector('#perf-fps')!.textContent=`${log.active?'● ':hasReport?'Ultima prova · ':''}FPS ${summary.fps===null?'—':summary.fps.toFixed(0)} · target ${summary.lastTargetFps??'—'}`;
    launcher.textContent=log.active?`${summary.fps===null?'…':summary.fps.toFixed(0)} FPS`:'FPS';
    panel.querySelector('#perf-live')!.textContent=`Intervallo frame P95 ${ms(summary.frame.p95Ms)} ms · max ${ms(summary.frame.maxMs)} ms\nCPU frame P95 ${ms(summary.cpu.p95Ms)} ms\nBlocchi >50 ms: ${summary.gapsOver50ms} · >100 ms: ${summary.gapsOver100ms}\nMeteo: ${state.weather??'—'} · cache: ${state.terrainCache??'—'} · ping: ${state.pingMs??'—'} ms\nSnapshot ricevuto da ${ms(typeof state.snapshotAgeMs==='number'?state.snapshotAgeMs:null)} ms`;
    const top=Object.entries(summary.phases).filter(([name])=>!['render','terrain','scene'].includes(name)).sort((a,b)=>(b[1].meanMs??0)-(a[1].meanMs??0)).slice(0,4);
    if(top.length)panel.querySelector('#perf-live')!.textContent+='\nCPU medio: '+top.map(([name,s])=>`${name} ${ms(s.meanMs)} ms`).join(' · ');
  };
  log.onChange=reason=>{
    if(reason==='start'){healthTicks=0;void sampleServer();}else if(reason==='stop'){healthRequest?.abort();healthRequest=undefined;}
    if(['masks','paint','sea'].includes(reason)||(reason==='stop'&&(!log.flags.masks||!log.flags.paint||!log.flags.sea)))invalidate();
    hasReport=true;refresh();if(!log.active){const s=log.summary();panel.querySelector('#perf-result')!.textContent=`Registrazione terminata: ${s.fps?.toFixed(1)??'—'} FPS medi · ${s.gapsOver50ms} intervalli oltre 50 ms. Scarica il report.`;}
  };
  input('perf-start').onclick=()=>{
    panel.querySelector('#perf-result')!.textContent='Registrazione in corso · 60 secondi. Puoi riaprire i dettagli durante la prova.';
    log.start(metadata());panel.dataset.compact='true';input('perf-expand').setAttribute('aria-expanded','false');
  };
  input('perf-stop').onclick=()=>log.stop();
  input('perf-expand').onclick=()=>{panel.dataset.compact=String(panel.dataset.compact!=='true');input('perf-expand').setAttribute('aria-expanded',String(panel.dataset.compact!=='true'));};
  input('perf-close').onclick=()=>{log.stop();panel.hidden=true;};
  panel.addEventListener('change',event=>{const checkbox=event.target as HTMLInputElement,key=checkbox.dataset.perfFeature as PerfFeature|undefined;
    if(key){log.setFeature(key,checkbox.checked);checkbox.blur();release();}});
  input('perf-export').onclick=()=>{
    log.stop();const report={...log.report(),finalMetadata:metadata()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download=`riftlands-performance-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60_000);
  };
  setInterval(()=>{if(log.active){log.sampleBrowser();if(++healthTicks%5===0)void sampleServer();if(!panel.hidden)refresh();}},1000);
  document.addEventListener('visibilitychange',()=>log.visibility(document.hidden));
  window.addEventListener('pagehide',()=>log.stop());
  window.addEventListener('error',()=>log.event('client-error',{}));
  window.addEventListener('unhandledrejection',()=>log.event('unhandled-rejection',{}));
  const canvas=root.querySelector('canvas');for(const name of ['contextlost','contextrestored'])canvas?.addEventListener(name,()=>log.event(name,{}));
  if(new URLSearchParams(location.search).get('diagnostics')==='1'){open();input('perf-start').click();}
}
