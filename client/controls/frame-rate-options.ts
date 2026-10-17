import { FPS_LIMITS,FPS_STORAGE_KEY,parseFpsLimit } from '../core/frame-budget';
import { performanceLog } from '../core/performance-log';
import './frame-rate-options.css';

export function installFrameRateOptions(root:HTMLElement,initial:number,change:(fps:number)=>void):void {
  for(const parent of root.querySelectorAll('.settings-panel,[data-hub-panel="settings"],#perf-fps-options')){
    if(parent.querySelector('[data-fps-limit]'))continue;
    const field=document.createElement('label');field.className='frame-rate-setting';
    field.innerHTML=`<span>Limite FPS in partita</span><select data-fps-limit aria-label="Limite FPS in partita">${FPS_LIMITS.map(n=>`<option value="${n}">${n} FPS${n===60?' · predefinito':''}</option>`).join('')}</select><small>Limite massimo, salvato su questo dispositivo. Nel menu: fino a 30 FPS. La frequenza dello schermo e il carico possono ridurre gli FPS effettivi.</small>`;
    const select=field.querySelector('select')!;select.value=String(initial);parent.append(field);
    select.onchange=()=>{const fps=parseFpsLimit(select.value);for(const other of root.querySelectorAll<HTMLSelectElement>('[data-fps-limit]'))other.value=String(fps);
      try{localStorage.setItem(FPS_STORAGE_KEY,String(fps));}catch{/* In-memory choice still applies. */}
      change(fps);performanceLog.event('fps-limit',{fps});select.blur();};
  }
}
