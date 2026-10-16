import { defaultWorldPainting, resolveTransition, transitionPairKey, TRANSITION_MATERIALS, TRANSITION_PRIORITY,
  type TransitionMaterial, type TransitionRule } from '../../../shared/world-painting';
import type { WorldDocument } from '../../../shared/world-schema';

export const transitionNames:Record<TransitionMaterial,string>={water:'Acqua',grass:'Erba',mud:'Fango',ice:'Ghiaccio',path:'Strada',snow:'Neve',stone:'Pietra'};
export function installTransitionScope(panel:HTMLElement,current:()=>WorldDocument,change:(action:()=>void)=>void){
  const section=document.createElement('div');section.className='fields';
  section.innerHTML=`<label>Regola dei passaggi<select id="transition-scope"><option value="general">Generale</option><option value="material">Materiale</option><option value="pair">Coppia di materiali</option></select></label>
    <label id="transition-a-label">Materiale<select id="transition-a">${TRANSITION_MATERIALS.map(s=>`<option value="${s}">${transitionNames[s]}</option>`).join('')}</select></label>
    <label id="transition-b-label">Altro materiale<select id="transition-b">${TRANSITION_MATERIALS.map(s=>`<option value="${s}">${transitionNames[s]}</option>`).join('')}</select></label>
    <label id="transition-owner-label">Terreno che definisce la maschera<select id="transition-owner"></select></label>
    <label id="transition-priority-label">Priorità in caso di conflitto<input id="transition-priority" type="number" min="0" max="1000" step="1"></label>
    <p id="transition-source" class="hint" role="status"></p><button id="transition-reset">Rimuovi eccezione · eredita</button>
    <p class="hint">Coppia → materiale con priorità maggiore → generale. Agli incontri di tre o più terreni prevale una sola regola del quadrato, con la stessa precedenza. Colori e macchie restano quelli di ciascun materiale.</p>`;
  panel.querySelector('#painting-curve')!.closest('label')!.before(section);
  const select=(id:string)=>section.querySelector<HTMLSelectElement>('#'+id)!;
  const kind=select('transition-scope'),a=select('transition-a'),b=select('transition-b'),owner=select('transition-owner');
  b.value='grass';
  const painting=()=>current().painting??defaultWorldPainting();
  const style=()=>{
    const p=painting(),first=a.value as TransitionMaterial,second=b.value as TransitionMaterial;
    if(kind.value==='general')return {curve:p.curve,maskShapes:p.maskShapes,owner:'grass' as TransitionMaterial,source:'general',key:'general'};
    if(kind.value==='material'){
      const r=p.materialRules?.[first];
      return {curve:r?.curve??p.curve,maskShapes:{...p.maskShapes,...r?.maskShapes},owner:first,source:r?'material':'general',key:first};
    }
    const r=resolveTransition(p,[first,second]);
    return {...r,owner:r.owner??(TRANSITION_MATERIALS.indexOf(first)>TRANSITION_MATERIALS.indexOf(second)?first:second)};
  };
  const target=(create=false):TransitionRule|undefined=>{
    if(create)current().painting??=defaultWorldPainting();
    const p=current().painting;if(!p)return undefined;
    const first=a.value as TransitionMaterial,second=b.value as TransitionMaterial;
    if(kind.value==='general')return p;
    if(kind.value==='material')return create?(p.materialRules??={})[first]??= {}:p.materialRules?.[first];
    const key=transitionPairKey(first,second);
    return create?(p.pairRules??={})[key]??={owner:style().owner}:p.pairRules?.[key];
  };
  const colors=()=>{
    const p=painting(),s=style(),background=kind.value==='general'?'water':kind.value==='material'
      ?(s.owner==='water'?'grass':'water'):(s.owner===a.value?b.value:a.value);
    return {foreground:p.materials[s.owner].color,background:p.materials[background as TransitionMaterial].color};
  };
  const label=()=>kind.value==='general'?'Regola generale':kind.value==='material'
    ?`Materiale · ${transitionNames[a.value as TransitionMaterial]}`
    :`Coppia · ${transitionNames[a.value as TransitionMaterial]} ↔ ${transitionNames[b.value as TransitionMaterial]}`;
  let redraw=()=>{};
  for(const control of [kind,a,b])control.onchange=()=>{
    if(a.value===b.value)b.value=TRANSITION_MATERIALS.find(s=>s!==a.value)!;
    redraw();
  };
  owner.onchange=()=>{const value=owner.value as TransitionMaterial;change(()=>{target(true)!.owner=value;});};
  const priority=section.querySelector<HTMLInputElement>('#transition-priority')!;
  priority.onchange=()=>{
    const value=Number(priority.value);
    if(!Number.isInteger(value)||value<0||value>1000){redraw();return;}
    change(()=>{target(true)!.priority=value;});
  };
  section.querySelector('#transition-reset')!.addEventListener('click',()=>change(()=>{
    const p=current().painting;if(!p)return;
    if(kind.value==='material')delete p.materialRules?.[a.value as TransitionMaterial];
    if(kind.value==='pair')delete p.pairRules?.[transitionPairKey(a.value as TransitionMaterial,b.value as TransitionMaterial)];
  }));
  return {style,target,colors,label,refresh:()=>{
    const s=style();
    for(const [id,visible] of [['transition-a-label',kind.value!=='general'],['transition-b-label',kind.value==='pair'],['transition-owner-label',kind.value==='pair'],['transition-priority-label',kind.value!=='general']] as const)
      (section.querySelector('#'+id) as HTMLElement).hidden=!visible;
    owner.replaceChildren(...[a.value,b.value].map(v=>new Option(transitionNames[v as TransitionMaterial],v)));owner.value=s.owner;
    priority.value=String(target()?.priority??TRANSITION_PRIORITY[s.owner]);
    const source=s.source==='pair'?`coppia ${s.key.split(':').map(k=>transitionNames[k as TransitionMaterial]).join(' ↔ ')}`
      :s.source==='material'?`materiale ${transitionNames[s.owner]}`:'regola generale';
    section.querySelector('#transition-source')!.textContent=`${label()}. Origine: ${source}. Il colore pieno rappresenta ${transitionNames[s.owner]}.`;
    (section.querySelector('#transition-reset') as HTMLButtonElement).disabled=kind.value==='general'||!target();
  },onSelection:(callback:()=>void)=>{redraw=callback;}};
}
export type TransitionScope=ReturnType<typeof installTransitionScope>;
