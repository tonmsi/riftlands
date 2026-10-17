import { DEFAULT_WATER_COAST, defaultCoastMotion, defaultWorldPainting, type WaterCoast, type CoastMotion, type CoastBand } from '../../../shared/world-painting';
import type { WorldDocument } from '../../../shared/world-schema';

export function installWaterCoastControls(panel:HTMLElement,current:()=>WorldDocument,change:(action:()=>void)=>void):()=>void {
  const section=document.createElement('details');section.id='water-coast-controls';
  const ranges=[['smoothing','Continuità delle curve',0,1,.05],['noise','Ampiezza rumore · unità mondo',0,6,.25],
    ['noiseScale','Scala del rumore · celle',2,32,1],['feather','Sfumatura della riva · unità mondo',0,128,.5],
    ['shallows','Larghezza acqua bassa · unità mondo',0,512,1],['featherOpacity','Intensità sfumatura della riva',0,1,.05],
    ['shallowOpacity','Intensità acqua bassa',0,1,.05],['featherSteps','Livelli sfumatura della riva',1,32,1],
    ['shallowSteps','Livelli sfumatura acqua bassa',1,32,1]] as const;
  section.innerHTML=`<summary>Acqua · costa naturale</summary><div class="fields">
    <label class="check"><input id="coast-enabled" data-coast="enabled" type="checkbox">Attiva costa naturale e sfumature</label>
    <label class="check"><input id="coast-automatic" data-coast="automatic" type="checkbox">Curve automatiche · intorno 4×4</label>
    ${ranges.map(([key,label,min,max,step])=>`<label>${label} <output id="coast-${key}-value"></output><input id="coast-${key}" data-coast="${key}" type="range" min="${min}" max="${max}" step="${step}"></label>`).join('')}
    <label>Seed del rumore<input id="coast-seed" data-coast="seed" type="number" min="0" max="1000000" step="1"></label>
    <label>Colore acqua bassa<input id="coast-shallowColor" data-coast="shallowColor" type="color"></label>
    <button id="coast-reset">Ripristina solo la costa</button></div>
    <details id="coast-motion-controls" open><summary>Movimento e fasce di sfumatura</summary><div class="fields">
    <label class="check"><input id="coast-motion-enabled" data-motion="enabled" type="checkbox">Attiva movimento della riva</label>
    ${([['amplitude','Escursione · unità mondo',0,128,.5],['speed','Velocità del movimento',0,4,.05],['randomness','Randomizzazione del movimento',0,1,.05]] as const).map(([key,label,min,max,step])=>`<label>${label} <output id="coast-motion-${key}-value"></output><input id="coast-motion-${key}" data-motion="${key}" type="range" min="${min}" max="${max}" step="${step}"></label>`).join('')}
    <label>Seed del movimento<input id="coast-motion-seed" data-motion="seed" type="number" min="0" max="1000000" step="1"></label>
    <label>Numero di fasce<input id="coast-band-count" type="number" min="0" max="12" step="1"></label>
    </div><output id="coast-motion-budget"></output><div id="coast-bands"></div></details>
    <p class="hint">Anteprima animata in Painting da 12 px/cella. Ogni fascia segue la costa sul lato dell’acqua: puoi regolarne ampiezza, colore, opacità e livelli della sfumatura. La randomizzazione varia ritmi e fasi delle fasce; il seed rende il movimento riproducibile. Più fasce e livelli aumentano il lavoro di disegno. Le maschere manuali prevalgono sulle curve automatiche; terra e collisioni restano ferme.</p>`;
  panel.querySelector('#painting-masks')!.before(section);
  const refresh=()=>{
    const settings={...DEFAULT_WATER_COAST,featherSteps:4,shallowSteps:6,...current().painting?.waterCoast};
    for(const input of section.querySelectorAll<HTMLInputElement>('[data-coast]')){
      const key=input.dataset.coast as keyof WaterCoast;
      if(input.type==='checkbox')input.checked=settings[key] as boolean;else input.value=String(settings[key]);
      const output=section.querySelector('#coast-'+key+'-value');if(output)output.textContent=String(settings[key]);
    }
    const motion=settings.motion??defaultCoastMotion();
    const passes=motion.enabled&&settings.enabled?motion.bands.reduce((n,b)=>n+(b.width>0&&b.opacity>0?b.softness:0),0):0;
    section.querySelector('#coast-motion-budget')!.textContent=`${motion.bands.length} fasce · ${passes} passaggi di disegno per fotogramma`;
    for(const input of section.querySelectorAll<HTMLInputElement>('[data-motion]')){
      const key=input.dataset.motion as keyof CoastMotion;
      if(input.type==='checkbox')input.checked=motion[key] as boolean;else input.value=String(motion[key]);
      const output=section.querySelector('#coast-motion-'+key+'-value');if(output)output.textContent=String(motion[key]);
    }
    section.querySelector<HTMLInputElement>('#coast-band-count')!.value=String(motion.bands.length);
    const bands=section.querySelector('#coast-bands')!;
    if(bands.childElementCount!==motion.bands.length)bands.innerHTML=motion.bands.map((band,index)=>`<fieldset><legend>Fascia ${index+1}</legend><div class="fields">
      ${([['width','Ampiezza · unità mondo',0,512,1],['opacity','Opacità',0,1,.01],['softness','Livelli di sfumatura',1,16,1]] as const).map(([key,label,min,max,step])=>`<label>${label} <output>${band[key]}</output><input id="coast-band-${index}-${key}" data-band="${index}" data-band-key="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${band[key]}"></label>`).join('')}
      <label>Colore<input id="coast-band-${index}-color" data-band="${index}" data-band-key="color" type="color" value="${band.color}"></label></div></fieldset>`).join('');
    for(const input of bands.querySelectorAll<HTMLInputElement>('[data-band]')){
      const value=motion.bands[Number(input.dataset.band)][input.dataset.bandKey as keyof CoastBand];
      input.value=String(value);const output=input.closest('label')?.querySelector('output');if(output)output.textContent=String(value);
    }
  };
  section.addEventListener('change',event=>{
    const input=event.target as HTMLInputElement,key=input.dataset.coast;
    if(!input.checkValidity()){refresh();return;}
    if(input.dataset.motion||input.dataset.band!==undefined||input.id==='coast-band-count'){
      change(()=>{
        const p=current().painting??=defaultWorldPainting(),settings=p.waterCoast??={...DEFAULT_WATER_COAST};
        const motion=settings.motion??=defaultCoastMotion();
        if(input.id==='coast-band-count'){
          const count=Number(input.value);motion.bands.length=Math.min(count,motion.bands.length);
          while(motion.bands.length<count)motion.bands.push({width:Math.min(512,(motion.bands.at(-1)?.width??0)+12),color:'#d9eee3',opacity:.15,softness:3});
        }else if(input.dataset.motion)Object.assign(motion,{[input.dataset.motion]:input.type==='checkbox'?input.checked:Number(input.value)});
        else Object.assign(motion.bands[Number(input.dataset.band)],{[input.dataset.bandKey as keyof CoastBand]:input.type==='color'?input.value:Number(input.value)});
      });return;
    }
    if(!key)return;
    change(()=>{
      const p=current().painting??=defaultWorldPainting(),settings=p.waterCoast??={...DEFAULT_WATER_COAST};
      Object.assign(settings,{[key]:input.type==='checkbox'?input.checked:input.type==='color'?input.value:Number(input.value)});
    });
  });
  section.querySelector('#coast-reset')!.addEventListener('click',()=>change(()=>{(current().painting??=defaultWorldPainting()).waterCoast={...DEFAULT_WATER_COAST};}));
  return refresh;
}
