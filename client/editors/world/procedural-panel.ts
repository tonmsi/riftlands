import { worldProceduralSettings, PROCEDURAL_KINDS, type ProceduralKind, type ProceduralSettings } from '../../../shared/procedural-generation';
import { CLIFF_VARIANTS } from '../../../shared/terrain-cliffs';
import { assetCatalogLabels, isAssetVariantGroup } from './world-asset-catalog';
import { parseWorldDocument, type WorldDocument } from '../../../shared/world-schema';

const names: Record<ProceduralKind,string> = { bush:'Cespugli', plant:'Piante', rock:'Rocce', cliff:'Bordi delle altezze' };
const escape = (s:string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** A separate workspace sharing the maker's draft, undo history and publication. */
export function installProceduralPanel(root: HTMLElement, current:()=>WorldDocument, change:(action:()=>void)=>void, inspectAsset?:(id:string)=>void, locateAsset?:(id:string)=>void) {
  const dialog=document.createElement('dialog');dialog.id='procedural-dialog';dialog.setAttribute('aria-labelledby','procedural-title');
  dialog.innerHTML='<div class="asset-dialog-header"><div><h2 id="procedural-title">Generazione procedurale</h2><p>Famiglie, ingombri e transizioni del mondo</p></div><button id="procedural-close">Torna alla mappa</button></div><nav id="procedural-tabs" aria-label="Parametri procedurali"></nav><div class="procedural-layout"><section id="procedural-form"></section><section><details id="procedural-painting-slot" open><summary>World Painting · bordi dei biomi</summary></details><details id="procedural-cliff-slot"><summary>Modifica asset dei bordi</summary></details><details id="procedural-asset-slot"><summary>Regole individuali dell’asset selezionato</summary><p id="procedural-active-asset" class="hint"></p></details></section></div>';
  root.append(dialog);
  dialog.querySelector('#procedural-title')!.textContent='Famiglie e biomi';
  const gen=root.querySelector('#gen-enabled')!.closest('.fields')!;
  const title=gen.previousElementSibling!,help=gen.nextElementSibling!;
  dialog.querySelector('#procedural-asset-slot')!.append(title,gen,help);
  const open=document.createElement('button');open.id='open-procedural';open.textContent='Famiglie e biomi';
  root.querySelector('.top-actions')!.prepend(open);
  const nav=document.createElement('button');nav.textContent='Famiglie';nav.onclick=()=>open.click();root.querySelector('.palette-navigation')!.append(nav);
  const brush=document.createElement('label');brush.className='check';brush.innerHTML='<input id="procedural-default-only" type="checkbox">Solo famiglia predefinita nella sezione dipinta';
  root.querySelector('#bush-js-option')!.after(brush);
  const hint=document.createElement('p');hint.className='hint';hint.textContent='Con la casella disattivata, temperatura e quota scelgono le sottofamiglie. La scelta si conserva sul terreno dipinto, anche dopo il salvataggio.';brush.after(hint);
  let kind:ProceduralKind='bush',familyId='default',ruleId='any',signature='';
  const folderOpen=new Map<string,boolean>();
  const settings=():ProceduralSettings=>worldProceduralSettings(current());
  const brushInfo=document.createElement('section');brushInfo.id='terrain-family-info';brushInfo.innerHTML='<strong id="terrain-family-name"></strong><div id="terrain-family-assets"></div><button id="terrain-family-configure" class="wide">Vedi asset e regole della famiglia</button>';
  brush.after(brushInfo);
  for(const child of [...root.querySelector('#bush-js-option')!.childNodes])if(child.nodeType===Node.TEXT_NODE)child.remove();
  root.querySelector('#bush-js-option')!.append('Forza JS · cespugli / piante');
  root.querySelector('#bush-js-hint')!.textContent='Gli asset della famiglia vengono usati anche dipingendo il terreno. Il JS si usa solo se lo forzi o mancano asset compatibili.';
  const openKind=(next:ProceduralKind)=>{kind=next;familyId='default';ruleId='any';if(!dialog.open)dialog.showModal();signature='';refresh();};
  root.querySelector('#terrain-family-configure')!.addEventListener('click',()=>{const terrain=(root.querySelector('#terrain') as HTMLSelectElement).value;openKind(terrain==='plant'?'plant':terrain==='rock'?'rock':'bush');});
  function refreshBrush(){
    const terrain=(root.querySelector('#terrain') as HTMLSelectElement).value,k=terrain==='plant'?'plant':terrain==='rock'?'rock':'bush',section=settings()[k];
    brushInfo.hidden=!['bush','plant','rock','grass'].includes(terrain);
    const only=(root.querySelector('#procedural-default-only') as HTMLInputElement).checked||!section.useFamilies;
    root.querySelector('#terrain-family-name')!.textContent=`${names[k]} · ${only?'Predefinita':'Biomi: temperatura + quota'}`;
    const ids=new Set(section.families.filter(f=>!only||f.id==='default').flatMap(f=>f.rules.flatMap(r=>r.assets))),assets=current().assets.filter(a=>ids.has(a.id));
    root.querySelector('#terrain-family-assets')!.innerHTML=section.useJs?'<span>JS forzato</span>':assets.length?assets.slice(0,8).map(a=>`<img src="${escape(a.image)}" alt="${escape(a.name)}" title="${escape(a.name)} · ${a.columns} × ${a.rows}">`).join(''):`<span>JS di riserva · nessun asset associato</span>`;
  }
  for(const id of ['terrain','procedural-default-only','bush-js'])root.querySelector(`#${id}`)!.addEventListener('change',refreshBrush);
  const mutate=(action:(s:ProceduralSettings)=>void)=>{const initial=structuredClone(settings());change(()=>{const s=current().procedural??=initial;action(s);});signature='';refresh();};
  const form=dialog.querySelector<HTMLElement>('#procedural-form')!;
  const input=(id:string)=>form.querySelector<HTMLInputElement>(`#${id}`)!;
  const num=(id:string)=>Number(input(id).value);
  const field=(id:string,label:string,value:number|string,step='1')=>`<label>${label}<input id="${id}" type="number" value="${value}" step="${step}"></label>`;
  function refresh() {
    refreshBrush();
    if(!dialog.open)return;
    const doc=current(),s=settings(),section=s[kind];
    const signatureNext=JSON.stringify([kind,familyId,ruleId,s,doc.assets.map(a=>[a.id,a.name,a.columns,a.rows,a.image,a.group,a.variantOf]),doc.assetFolders]);if(signatureNext===signature)return;signature=signatureNext;
    const family=section.families.find(f=>f.id===familyId)??section.families[0];familyId=family.id;
    const rule=family.rules.find(r=>r.id===ruleId)??family.rules[0];ruleId=rule?.id??'';
    dialog.querySelector('#procedural-tabs')!.replaceChildren(...PROCEDURAL_KINDS.map(k=>{const b=document.createElement('button');b.textContent=names[k];b.setAttribute('aria-pressed',String(k===kind));b.onclick=()=>{kind=k;familyId='default';ruleId='any';signature='';refresh();};return b;}));
    const folders=new Map<string,typeof doc.assets>();
    const groupLabels=assetCatalogLabels(doc.assets);
    for(const folder of doc.assetFolders??[])folders.set(folder,[]);
    for(const asset of doc.assets){const folder=groupLabels.get(asset.id)!;if(!folders.has(folder))folders.set(folder,[]);folders.get(folder)!.push(asset);}
    const folderEntries=[...folders].sort(([a],[b])=>a.localeCompare(b,'it'));
    const removedIds=new Set<string>();
    const assetSelector=folderEntries.map(([folder,assets],index)=>
      `<details class="proc-asset-folder" data-folder="${escape(folder)}" ${folderOpen.get(folder)===false?'':'open'}><summary>${escape(folder)} <span class="group-count">${assets.length}</span>${isAssetVariantGroup(assets,doc.assets)?'<small class="asset-group-kind" title="Gruppo virtuale: non crea cartelle sul disco">Gruppo varianti</small>':''}</summary><div class="proc-folder-actions"><button type="button" data-select-folder="${index}">Seleziona ${isAssetVariantGroup(assets,doc.assets)?'gruppo':'cartella'}</button><button type="button" data-clear-folder="${index}">Deseleziona ${isAssetVariantGroup(assets,doc.assets)?'gruppo':'cartella'}</button><button type="button" data-family-folder="${index}" ${assets.length?'':'disabled'}>Crea sottofamiglia da ${isAssetVariantGroup(assets,doc.assets)?'gruppo':'cartella'}</button></div><div class="proc-folder-items">${assets.map(a=>`<label class="procedural-asset" data-proc-asset="${escape(a.id)}"><input type="checkbox" name="proc-asset" value="${escape(a.id)}" ${rule?.assets.includes(a.id)?'checked':''}><img src="${escape(a.image)}" alt="" loading="lazy"><span>${escape(a.name)}<small>${a.columns} × ${a.rows}${a.animation?' · animato':''}</small></span></label>`).join('')}</div></details>`).join('');
    form.innerHTML=`<h3>${names[kind]}</h3><p class="hint">Queste regole valgono sia per la generazione sia per il pennello terreno. Gli asset compatibili hanno la precedenza; il JS è la riserva.</p>
      ${kind!=='cliff'?`<button id="proc-paint-family" class="primary wide">Dipingi ${names[kind]} · ${family.id==='default'?'famiglia predefinita':'biomi e sottofamiglie'}</button>`:''}
      <section id="proc-usage"><h3>Asset utilizzati · ${escape(family.name)}</h3><div id="proc-used-assets"></div><p id="proc-usage-status" role="status"></p></section>
      <label class="check"><input id="proc-js" type="checkbox" ${section.useJs?'checked':''}>Forza disegno JS predefinito</label>
      <label class="check"><input id="proc-families" type="checkbox" ${section.useFamilies?'checked':''}>Usa sottofamiglie in base a temperatura e quota</label>
      ${kind==='plant'||kind==='bush'?`<div class="pair">${field('proc-density','Densità generazione %',section.density*100)}${field('proc-spacing','Distanza minima · tile',section.spacing)}</div>`:''}
      <label>Famiglia<select id="proc-family">${section.families.map(f=>`<option value="${escape(f.id)}" ${f.id===familyId?'selected':''}>${escape(f.name)}</option>`).join('')}</select></label>
      <div class="property-actions"><button id="proc-add-family">＋ Sottofamiglia</button><button id="proc-delete-family" ${familyId==='default'?'disabled':''}>Rimuovi famiglia</button></div>
      <label>Nome famiglia<input id="proc-name" value="${escape(family.name)}" maxlength="160"></label>
      ${familyId!=='default'?`<div class="pair">${field('proc-temp-min','Temperatura minima · 0–1',family.temperature[0],'.01')}${field('proc-temp-max','Temperatura massima · 0–1',family.temperature[1],'.01')}${field('proc-height-min','Quota minima',family.elevation[0])}${field('proc-height-max','Quota massima',family.elevation[1])}${field('proc-temp-blend','Blend temperatura · 0–1',family.temperatureBlend,'.01')}${field('proc-height-blend','Blend quote · livelli',family.elevationBlend,'.25')}</div><p class="hint">Nel suo intervallo la sottofamiglia ha peso pieno; oltre i limiti sfuma per l’ampiezza del blend. Dove si sovrappongono, le famiglie vengono mescolate. La predefinita copre le aree rimanenti.</p>`:'<p class="hint">La famiglia predefinita viene usata anche quando disattivi le sottofamiglie nel pennello.</p>'}
      <label>Regola<select id="proc-rule">${family.rules.map(r=>`<option value="${escape(r.id)}" ${r.id===ruleId?'selected':''}>${escape(r.cliffVariant??`${r.width??'Tutte'} × ${r.height??'tutte'}`)}</option>`).join('')}</select></label><div class="property-actions"><button id="proc-add-rule">＋ Regola ingombro</button><button id="proc-delete-rule" ${!rule?'disabled':''}>Rimuovi regola</button></div>
      ${rule?`<div class="pair">${field('proc-width','Larghezza · vuoto = tutte',rule.width??'')}${field('proc-height','Altezza · vuoto = tutte',rule.height??'')}</div>${kind==='cliff'?`<label>Pezzo di bordo<select id="proc-cliff"><option value="">Tutti</option>${CLIFF_VARIANTS.map(v=>`<option ${rule.cliffVariant===v?'selected':''}>${v}</option>`).join('')}</select></label>`:''}<p class="hint">Le dimensioni indicano l’ingombro della griglia, non i pixel: vengono scelti solo gli asset con dimensioni compatibili. Le regole specifiche prevalgono su quelle generiche. Per le rocce sono disponibili ingombri fino a 6 × 6.</p><input id="proc-asset-search" type="search" placeholder="Cerca asset per nome o dimensioni…" aria-label="Cerca asset procedurali"><p class="hint">Qui trovi le stesse cartelle e gli stessi gruppi del catalogo. “Gruppo varianti” indica un raggruppamento virtuale, senza una cartella sul disco. Seleziona una cartella o un gruppo per usarne gli asset, oppure crea una sottofamiglia.</p><div class="procedural-assets">${assetSelector}</div>`:''}
      <button id="proc-save" class="primary wide">Salva parametri e aggiorna anteprima</button><button id="proc-catalog" class="wide">Gestisci catalogo e importa asset</button><p id="proc-feedback" role="status"></p><p class="hint">Le modifiche condividono Annulla/Ripeti, esportazione e Applica al gioco con il Maker. Torna alla mappa per vedere il risultato.</p>`;
    form.querySelector('#proc-catalog')!.addEventListener('click',()=>{form.querySelector<HTMLButtonElement>('#proc-save')!.click();if(!validToPaint)return;dialog.close();root.querySelector<HTMLButtonElement>('#asset-catalog-expand')!.click();});
    let validToPaint=true;
    const usedAssets=(pending=false)=>{
      const selectedIds=new Set([...form.querySelectorAll<HTMLInputElement>('[name="proc-asset"]:checked')].map(i=>i.value));
      const rules=family.rules.map(r=>r.id===ruleId?{...r,assets:[...selectedIds],width:input('proc-width').value===''?undefined:num('proc-width'),height:input('proc-height').value===''?undefined:num('proc-height')}:r);
      const ids=new Set(rules.flatMap(r=>r.assets).filter(id=>!removedIds.has(id)));
      form.querySelector('#proc-used-assets')!.innerHTML=doc.assets.filter(a=>ids.has(a.id)).map(a=>{
        const matches=rules.filter(r=>r.assets.includes(a.id)),valid=matches.some(r=>(r.width===undefined||r.width===a.columns)&&(r.height===undefined||r.height===a.rows)&&!(kind==='cliff'&&a.animation));
        return `<div class="proc-used-entry"><button type="button" class="proc-used-card" data-inspect-asset="${escape(a.id)}"><img src="${escape(a.image)}" alt=""><strong>${escape(a.name)}</strong><span>${a.columns} × ${a.rows} · ${!valid?'Ingombro incompatibile':input('proc-js').checked?'Associato · JS forzato':'In uso'}</span><small>${matches.map(r=>escape(r.cliffVariant??`${r.width??'Tutte'} × ${r.height??'tutte'}`)).join(' · ')}</small><span>Trova nella lista ↓</span></button><div class="proc-used-actions"><button type="button" data-edit-asset="${escape(a.id)}">Modifica asset ↗</button><button type="button" data-catalog-asset="${escape(a.id)}">Apri nel catalogo ↗</button><button type="button" data-remove-family-asset="${escape(a.id)}">Rimuovi dalla famiglia</button></div></div>`;
      }).join('')||'<div class="proc-fallback-card">Disegno JS di riserva<br><small>Nessun asset associato. Aggiungilo dal catalogo qui sotto.</small></div>';
      form.querySelector('#proc-usage-status')!.textContent=(pending?'Selezione modificata: premi Salva parametri per applicarla. ':'')+(input('proc-js').checked?'JS forzato: gli asset associati restano salvati, ma non vengono usati.':`${ids.size} asset associati. Clicca una miniatura per trovare la riga dell’asset. Rimuovi dalla famiglia cambia solo questa associazione; per cancellare l’asset apri il catalogo.`);
      for(const card of form.querySelectorAll<HTMLButtonElement>('[data-inspect-asset]'))card.onclick=()=>revealRow(card.dataset.inspectAsset!);
      for(const button of form.querySelectorAll<HTMLButtonElement>('[data-remove-family-asset]'))button.onclick=()=>{
        const id=button.dataset.removeFamilyAsset!;removedIds.add(id);
        const checkbox=[...form.querySelectorAll<HTMLInputElement>('[name="proc-asset"]')].find(i=>i.value===id);if(checkbox)checkbox.checked=false;
        usedAssets(true);
      };
      for(const button of form.querySelectorAll<HTMLButtonElement>('[data-edit-asset], [data-catalog-asset]'))button.onclick=()=>{
        const id=button.dataset.editAsset??button.dataset.catalogAsset!;
        form.querySelector<HTMLButtonElement>('#proc-save')!.click();if(!validToPaint)return;
        dialog.close();if(button.dataset.catalogAsset)locateAsset?.(id);else inspectAsset?.(id);
      };
    };
    function revealRow(id:string){
      input('proc-asset-search').value='';filterAssets();
      for(const item of form.querySelectorAll<HTMLElement>('[data-proc-asset]'))item.classList.toggle('proc-asset-highlight',item.dataset.procAsset===id);
      const row=[...form.querySelectorAll<HTMLElement>('[data-proc-asset]')].find(item=>item.dataset.procAsset===id);if(!row)return;
      const group=row.closest<HTMLDetailsElement>('details')!;group.open=true;folderOpen.set(group.dataset.folder!,true);
      row.scrollIntoView({block:'center'});row.querySelector<HTMLInputElement>('input')!.focus({preventScroll:true});
    }
    function filterAssets(){
      const query=input('proc-asset-search').value.trim().toLocaleLowerCase().replaceAll('×','x').replace(/\s+/g,'');
      for(const folder of form.querySelectorAll<HTMLDetailsElement>('.proc-asset-folder')){
        for(const item of folder.querySelectorAll<HTMLElement>('.procedural-asset'))item.hidden=!!query&&!(item.textContent!+folder.dataset.folder).toLocaleLowerCase().replaceAll('×','x').replace(/\s+/g,'').includes(query);
        folder.hidden=!!query&&![...folder.querySelectorAll<HTMLElement>('.procedural-asset')].some(item=>!item.hidden);
        folder.open=query?true:folderOpen.get(folder.dataset.folder!)!==false;
      }
    }
    form.onchange=e=>{
      const target=e.target as HTMLInputElement;if(target.id==='proc-asset-search')return;
      if(target.name==='proc-asset'&&target.checked)removedIds.delete(target.value);
      usedAssets(true);
    };
    usedAssets();
    form.querySelector('#proc-paint-family')?.addEventListener('click',()=>{
      form.querySelector<HTMLButtonElement>('#proc-save')!.click();if(!validToPaint)return;
      const select=root.querySelector<HTMLSelectElement>('#terrain')!;select.value=kind;select.dispatchEvent(new Event('change',{bubbles:true}));
      const only=root.querySelector<HTMLInputElement>('#procedural-default-only')!;only.checked=familyId==='default';only.dispatchEvent(new Event('change',{bubbles:true}));
      root.querySelector<HTMLButtonElement>('[data-tool="terrain"]')!.click();dialog.close();refreshBrush();
    });
    if(rule)input('proc-asset-search').oninput=filterAssets;
    for(const folder of form.querySelectorAll<HTMLDetailsElement>('.proc-asset-folder'))folder.ontoggle=()=>{if(!input('proc-asset-search').value)folderOpen.set(folder.dataset.folder!,folder.open);};
    for(const button of form.querySelectorAll<HTMLButtonElement>('[data-select-folder], [data-clear-folder]'))button.onclick=()=>{
      const index=Number(button.dataset.selectFolder??button.dataset.clearFolder),ids=new Set(folderEntries[index][1].map(a=>a.id)),checked=button.dataset.selectFolder!==undefined;
      for(const checkbox of form.querySelectorAll<HTMLInputElement>('[name="proc-asset"]'))if(ids.has(checkbox.value)){checkbox.checked=checked;if(checked)removedIds.delete(checkbox.value);}
      usedAssets(true);
    };
    for(const button of form.querySelectorAll<HTMLButtonElement>('[data-family-folder]'))button.onclick=()=>{
      const [folder,assets]=folderEntries[Number(button.dataset.familyFolder)];
      form.querySelector<HTMLButtonElement>('#proc-save')!.click();if(!validToPaint)return;
      mutate(s=>{
        familyId=`family-${crypto.randomUUID()}`;ruleId='any';s[kind].useFamilies=true;
        s[kind].families.push({id:familyId,name:folder,temperature:[0,.4],elevation:[0,4],temperatureBlend:.1,elevationBlend:1,rules:[{id:'any',assets:assets.map(a=>a.id)}]});
      });
    };
    form.querySelector<HTMLSelectElement>('#proc-family')!.onchange=e=>{familyId=(e.target as HTMLSelectElement).value;ruleId='';refresh();};
    form.querySelector<HTMLSelectElement>('#proc-rule')!.onchange=e=>{ruleId=(e.target as HTMLSelectElement).value;refresh();};
    form.querySelector('#proc-add-family')!.addEventListener('click',()=>mutate(s=>{familyId=`family-${crypto.randomUUID()}`;s[kind].families.push({...structuredClone(s[kind].families[0]),id:familyId,name:'Nuova sottofamiglia',temperature:[0,.4],elevation:[0,4]});}));
    form.querySelector('#proc-delete-family')!.addEventListener('click',()=>mutate(s=>{s[kind].families=s[kind].families.filter(f=>f.id!==familyId);familyId='default';}));
    form.querySelector('#proc-add-rule')!.addEventListener('click',()=>mutate(s=>{ruleId=`rule-${crypto.randomUUID()}`;s[kind].families.find(f=>f.id===familyId)!.rules.push({id:ruleId,width:2,height:2,assets:[]});}));
    form.querySelector('#proc-delete-rule')!.addEventListener('click',()=>mutate(s=>{const f=s[kind].families.find(f=>f.id===familyId)!;f.rules=f.rules.filter(r=>r.id!==ruleId);ruleId='';}));
    form.querySelector('#proc-save')!.addEventListener('click',()=>{
      validToPaint=false;
      const next=structuredClone(section),f=next.families.find(f=>f.id===familyId)!;
      next.useJs=input('proc-js').checked;next.useFamilies=input('proc-families').checked;f.name=input('proc-name').value.trim();
      if(kind==='plant'||kind==='bush'){next.density=num('proc-density')/100;next.spacing=num('proc-spacing');}
      if(f.id!=='default'){f.temperature=[num('proc-temp-min'),num('proc-temp-max')];f.elevation=[num('proc-height-min'),num('proc-height-max')];f.temperatureBlend=num('proc-temp-blend');f.elevationBlend=num('proc-height-blend');}
      if(rule){const r=f.rules.find(r=>r.id===ruleId)!;r.width=input('proc-width').value===''?undefined:num('proc-width');r.height=input('proc-height').value===''?undefined:num('proc-height');r.cliffVariant=kind==='cliff'?(input('proc-cliff').value||undefined) as typeof CLIFF_VARIANTS[number]|undefined:undefined;r.assets=[...form.querySelectorAll<HTMLInputElement>('[name="proc-asset"]:checked')].map(i=>i.value);}
      for(const r of f.rules)r.assets=r.assets.filter(id=>!removedIds.has(id));
      try {const proposed=structuredClone(settings());proposed[kind]=next;parseWorldDocument({...current(),procedural:proposed});mutate(s=>{s[kind]=next;});validToPaint=true;form.querySelector('#proc-feedback')!.textContent='Parametri salvati nella bozza.';}
      catch(error){form.querySelector('#proc-feedback')!.textContent=error instanceof Error?error.message:String(error);}
    });
    const active=root.querySelector<HTMLInputElement>('#asset-name');dialog.querySelector('#procedural-active-asset')!.textContent=active?.value??'';
  }
  open.onclick=()=>{dialog.showModal();signature='';refresh();};
  dialog.querySelector('#procedural-close')!.addEventListener('click',()=>dialog.close());
  root.addEventListener('world-refresh',refresh);
  return refresh;
}
