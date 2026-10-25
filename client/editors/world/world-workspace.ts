import type { WorldDocument } from '../../../shared/world-schema';
import { npcDisplayName } from '../../../shared/npc-variants';
import { npcEditorCatalog } from '../npc-catalog';
import type { Vec2 } from '../../../shared/types';

type Kind = 'placement' | 'npc' | 'zone' | 'sound' | 'dungeon' | 'warp' | 'surfaces' | 'solids' | 'stairs';
interface Host {
  state(): { project: WorldDocument; document: WorldDocument; mapId: string };
  openMap(id: string): void;
  inspect(kind: Kind, id: string, p: Vec2, elevation: number): void;
}
/** A single workspace: compact tool boxes, resizable docks and an object explorer. */
export function installWorldWorkspace(root: HTMLElement, host: Host): void {
  const palette = root.querySelector<HTMLElement>('.world-palette')!, inspector = root.querySelector<HTMLElement>('.inspector')!;
  root.classList.add('editor-workspace');
  const widths = { left: 250, right: 330 };
  try { Object.assign(widths, JSON.parse(localStorage.getItem('riftlands.workspace-widths') ?? '{}')); } catch { /* Optional preference. */ }
  const resize = (side: 'left' | 'right', width: number) => {
    widths[side] = Math.max(200, Math.min(Math.min(600, innerWidth * .42), width));
    root.style.setProperty(side === 'left' ? '--palette-width' : '--inspector-width', `${widths[side]}px`);
  };
  const saveWidths = () => { try { localStorage.setItem('riftlands.workspace-widths', JSON.stringify(widths)); } catch { /* Optional preference. */ } };
  for (const side of ['left','right'] as const) {
    resize(side,widths[side]);
    const handle = document.createElement('div'); handle.className = `dock-resizer dock-resizer-${side}`; handle.tabIndex = 0;
    handle.setAttribute('role','separator'); handle.setAttribute('aria-orientation','vertical'); handle.setAttribute('aria-label',side === 'left' ? 'Larghezza strumenti' : 'Larghezza scheda');
    let drag: { x: number; width: number } | undefined;
    handle.onpointerdown = e => { drag = { x:e.clientX, width:widths[side] }; handle.setPointerCapture(e.pointerId); e.preventDefault(); };
    handle.onpointermove = e => { if (drag) resize(side, drag.width + (e.clientX-drag.x)*(side === 'left' ? 1 : -1)); };
    const finish = () => { drag=undefined; saveWidths(); }; handle.onpointerup=finish; handle.onpointercancel=finish;
    handle.onkeydown = e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { resize(side,widths[side]+(e.key==='ArrowRight'?20:-20)*(side==='left'?1:-1));saveWidths();e.preventDefault(); } };
    if (side === 'left') palette.after(handle); else inspector.before(handle);
  }
  const heading = document.createElement('div'); heading.className='dock-heading';
  heading.innerHTML='<strong>Scheda selezione</strong><button id="inspector-enlarge" title="Ingrandisci o riduci la scheda" aria-label="Ingrandisci o riduci la scheda">⤢</button><button id="inspector-close" title="Chiudi scheda" aria-label="Chiudi scheda">×</button>';
  inspector.prepend(heading);
  const scope=document.createElement('p');scope.id='asset-scope';scope.className='scope-label';root.querySelector('#asset-inspector > h2')!.after(scope);
  const imageUsage=document.createElement('p');imageUsage.id='asset-image-usage';imageUsage.className='scope-label asset-image-usage';scope.after(imageUsage);
  root.querySelector('#asset-update')!.textContent='Salva scheda asset';
  root.querySelector('#asset-update')!.setAttribute('title','Conferma aspetto, immagine, trasparenza e generazione con una sola operazione');
  heading.querySelector('#inspector-enlarge')!.addEventListener('click',()=>inspector.classList.toggle('dock-expanded'));
  heading.querySelector('#inspector-close')!.addEventListener('click',()=>{ inspector.classList.remove('dock-expanded');inspector.classList.add('collapsed');root.classList.add('inspector-hidden'); });
  try { if (localStorage.getItem('riftlands.inspector-expanded') === 'true') inspector.classList.add('dock-expanded'); } catch { /* Optional layout preference. */ }
  new MutationObserver(() => { try { localStorage.setItem('riftlands.inspector-expanded', String(inspector.classList.contains('dock-expanded'))); } catch { /* Optional layout preference. */ } }).observe(inspector, { attributes:true, attributeFilter:['class'] });
  const reset=document.createElement('button');reset.id='workspace-reset';reset.textContent='Ripristina layout';
  reset.onclick=()=>{ resize('left',250);resize('right',330);saveWidths();inspector.classList.remove('collapsed','dock-expanded');root.classList.remove('inspector-hidden');root.dispatchEvent(new Event('workspace-reset-layout')); };
  root.querySelector('.top-actions')!.prepend(reset);
  const conflict=document.createElement('div');conflict.id='draft-conflict';conflict.hidden=true;conflict.className='workspace-alert';
  conflict.innerHTML='<span>Bozza modificata in un’altra scheda. Questa versione è conservata in memoria.</span><button id="draft-export">Esporta questa versione</button><button id="draft-recover">Ricarica progetto applicato</button>';
  conflict.querySelector('#draft-export')!.addEventListener('click',()=>root.querySelector<HTMLButtonElement>('#export-world')!.click());
  conflict.querySelector('#draft-recover')!.addEventListener('click',()=>location.reload());
  root.querySelector('.workspace')!.prepend(conflict);

  const explorer=document.createElement('details'); explorer.id='world-explorer';explorer.className='world-panel';
  explorer.innerHTML='<summary>Esplora oggetti</summary><input id="explorer-search" placeholder="Cerca NPC, asset, zona…" aria-label="Cerca nel mondo"><div id="explorer-items"></div>';
  palette.querySelector('.palette-navigation')!.after(explorer);
  const nav=document.createElement('button');nav.textContent='Esplora';nav.onclick=()=>{explorer.open=true;explorer.scrollIntoView({block:'start'});};
  palette.querySelector('.palette-navigation')!.append(nav);
  const search=explorer.querySelector<HTMLInputElement>('#explorer-search')!, body=explorer.querySelector('#explorer-items')!;
  let signature='', limit=100;
  function refreshExplorer() {
    const {project,document:doc,mapId}=host.state(), filter=search.value.trim().toLocaleLowerCase();
    const assets=new Map(project.assets.map(a=>[a.id,a]));
    const groups: { title:string; items:{kind:Kind;id:string;name:string;p:Vec2;elevation:number}[] }[]=[
      {title:'Asset',items:doc.placements.map(p=>({kind:'placement',id:p.id,name:assets.get(p.assetId)?.name??p.assetId,p,elevation:p.baseElevation??0}))},
      {title:'NPC e personaggi',items:doc.npcs.map(p=>({kind:'npc',id:p.id,name:npcDisplayName(p.npcKind,p.settings,npcEditorCatalog()),p,elevation:p.elevation??0}))},
      {title:'Zone e biomi',items:doc.zones.map(z=>({kind:'zone',id:z.id,name:z.name,p:z.shape,elevation:0}))},
      {title:'Punti sonori',items:(doc.soundPoints??[]).map(p=>({kind:'sound',id:p.id,name:p.name,p,elevation:0}))},
      {title:'Passaggi',items:(project.warps??[]).filter(w=>w.from===mapId).map(w=>({kind:'warp',id:w.id,name:w.name,p:w.entry,elevation:w.entryElevation??0}))},
      {title:'Dungeon',items:doc.dungeons.filter(d=>d.enabled!==false).map(d=>({kind:'dungeon',id:d.dungeonId,name:d.dungeonId,p:d,elevation:0}))},
      ...(['surfaces','stairs','solids'] as const).map(kind=>({title:kind==='surfaces'?'Terreni e ponti':kind==='stairs'?'Scale':'Ostacoli',items:(doc.geometry?.[kind]??[]).filter(s=>!s.id.endsWith('-mass')).map(s=>({kind,id:s.id,name:'elevation'in s?`${s.ground?'Terreno':'Ponte'} · quota ${s.elevation}`:'from'in s?`Scala ${s.from} → ${s.to}`:`Ostacolo ${s.base} → ${s.top}`,p:s,elevation:'elevation'in s?s.elevation:'from'in s?s.from:s.base}))})),
    ];
    const next=JSON.stringify([mapId,filter,limit,(project.interiors??[]).map(m=>[m.id,m.name]),groups]); if(next===signature)return;signature=next;
    body.replaceChildren();
    const maps=document.createElement('div');maps.className='map-tabs';
    for(const [id,name] of [['world','Mondo'],...(project.interiors??[]).map(m=>[m.id,m.name])]) {
      const button=document.createElement('button');button.textContent=name;button.setAttribute('aria-pressed',String(id===mapId));button.onclick=()=>host.openMap(id);maps.append(button);
    }body.append(maps);
    for(const group of groups){
      const items=group.items.filter(i=>`${i.name} ${i.id}`.toLocaleLowerCase().includes(filter));if(!items.length)continue;
      const box=document.createElement('details');box.open=!!filter || items.length<8;const title=document.createElement('summary');title.textContent=`${group.title} · ${items.length}`;box.append(title);
      for(const item of items.slice(0,limit)){const button=document.createElement('button');button.className='explorer-item';button.textContent=`${item.name} · ${item.p.x}, ${item.p.y}`;button.onclick=()=>host.inspect(item.kind,item.id,item.p,item.elevation);box.append(button);}body.append(box);
      if(items.length>limit){const more=document.createElement('button');more.textContent='Mostra altri';more.onclick=()=>{limit+=100;refreshExplorer();};box.append(more);}
    }
  }
  search.oninput=()=>{limit=100;refreshExplorer();};explorer.ontoggle=()=>{if(explorer.open)refreshExplorer();};
  root.addEventListener('world-refresh',()=>{if(explorer.open)refreshExplorer();});

  // Put the ordinary terrain workflow in one compact, always visible box.
  const terrain=root.querySelector('#terrain')!.closest('label')!;
  const box=document.createElement('div');box.id='terrain-quick-controls';box.className='quick-box';
  box.append(terrain);
  const quota=root.querySelector('#terrain-elevation')!.closest('label')!;quota.firstChild!.textContent='Livello terreno';
  const stepper=document.createElement('div');stepper.className='level-stepper';
  for(const [label,delta] of [['−',-1],['＋',1]] as const){const button=document.createElement('button');button.textContent=label;button.setAttribute('aria-label',delta>0?'Alza livello terreno':'Abbassa livello terreno');button.onclick=()=>{const field=quota.querySelector('input')!,active=root.querySelector<HTMLInputElement>('#elevation-active')!;field.value=String(Math.max(-128,Math.min(127,Number(field.value===''?active.value:field.value)+delta)));field.dispatchEvent(new Event('change',{bubbles:true}));root.querySelector<HTMLButtonElement>('[data-tool="terrain"]')!.click();};stepper.append(button);}
  stepper.insertBefore(quota,stepper.lastChild);box.append(stepper);
  const auto=root.querySelector('#terrain-elevation-auto')!;auto.textContent='Mantieni livello';box.append(auto);
  const info=document.createElement('small');info.textContent='Un livello per volta. Ponti e oggetti possono collegare quote diverse.';box.append(info);
  root.querySelector('#build-controls > summary')!.after(box);
  // Keep specialists available without a wall of parameters in the common flow.
  root.querySelector<HTMLDetailsElement>('#elevation-advanced')!.open=false;
  for(const selector of ['#asset-inspector .hint','#elevation-controls > .hint']) for(const hint of root.querySelectorAll<HTMLElement>(selector))hint.classList.add('secondary-help');
}
