import { defaultWorldPainting, type MaskShape, type MaskPoint } from '../../../shared/world-painting';
import type { WorldDocument } from '../../../shared/world-schema';
import { maskContours, terrainMaskCommands } from '../../render/terrain-masks';

export function installPaintingMaskEditor(panel: HTMLElement, current: () => WorldDocument, change: (action: () => void) => void) {
  const dialog = document.createElement('dialog');
  dialog.id = 'painting-mask-dialog';
  dialog.style.cssText = 'width:min(620px,90vw);max-height:90vh;overflow:auto';
  dialog.innerHTML = `<h2>Disegna una maschera</h2><div class="fields"><label>Maschera<select id="mask-choice">${Array.from({length:14},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select></label>
    <label>Contorno<select id="mask-contour"></select></label><label class="check"><input id="mask-smooth" type="checkbox">Raccordi morbidi</label></div>
    <canvas id="mask-editor-canvas" width="480" height="480" style="display:block;width:min(100%,480px);margin:12px auto;touch-action:none;cursor:crosshair" aria-label="Trascina i punti della maschera; clicca per aggiungere un punto"></canvas>
    <p class="hint">Trascina i punti chiari. Clicca sul disegno per aggiungerne uno (massimo 8 per contorno); doppio clic su un punto per rimuoverlo. Gli estremi dorati restano fissi per raccordare i quadrati vicini. Le maschere 0 e 15 sono vuota e piena.</p>
    <div class="property-actions"><button id="mask-wave">Onda</button><button id="mask-angular">Spezzata</button><button id="mask-remove-point">Rimuovi punto selezionato</button></div>
    <div class="dialog-actions"><button id="mask-apply" class="primary">Applica maschera</button><button id="mask-reset">Ripristina questa maschera</button><button id="mask-close">Chiudi</button></div>
    <p id="mask-edit-status" role="status" class="hint">Applica per salvare le modifiche nella bozza.</p>`;
  panel.append(dialog);
  const canvas = dialog.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
  const choice = dialog.querySelector<HTMLSelectElement>('#mask-choice')!, contour = dialog.querySelector<HTMLSelectElement>('#mask-contour')!;
  const smooth = dialog.querySelector<HTMLInputElement>('#mask-smooth')!, status = dialog.querySelector('#mask-edit-status')!;
  let mask = 1, curveIndex = 0, selected = 0, dragging = false, draft: MaskShape = {curves:[],smooth:true};
  const clamp = (v: number) => Math.max(.03,Math.min(.97,v));
  const painting = () => current().painting ?? defaultWorldPainting();
  const draw = () => {
    const p=painting();ctx.clearRect(0,0,480,480);ctx.save();ctx.translate(24,24);
    ctx.fillStyle=p.materials.water.color;ctx.fillRect(0,0,432,432);
    ctx.fillStyle=p.materials.grass.color;ctx.fill(new Path2D(terrainMaskCommands(mask,432,p.curve,draft)),'evenodd');
    ctx.strokeStyle='#ffffff30';ctx.lineWidth=1;
    for(let i=0;i<=4;i++){ctx.beginPath();ctx.moveTo(i*108,0);ctx.lineTo(i*108,432);ctx.moveTo(0,i*108);ctx.lineTo(432,i*108);ctx.stroke();}
    const info=maskContours(mask,p.curve)[curveIndex], points=draft.curves[curveIndex];
    ctx.beginPath();[info.start,...points,info.end].forEach((p,i)=>i?ctx.lineTo(p.x*432,p.y*432):ctx.moveTo(p.x*432,p.y*432));
    ctx.strokeStyle='#182d34aa';ctx.setLineDash([5,5]);ctx.stroke();ctx.setLineDash([]);
    for(const p of [info.start,info.end]){ctx.beginPath();ctx.arc(p.x*432,p.y*432,6,0,Math.PI*2);ctx.fillStyle='#ffd78a';ctx.fill();}
    points.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x*432,p.y*432,i===selected?8:6,0,Math.PI*2);ctx.fillStyle=i===selected?'#ffffff':'#d4e7ee';ctx.fill();ctx.strokeStyle='#233b43';ctx.stroke();});
    ctx.restore();smooth.checked=draft.smooth;
  };
  const load = () => {
    const p=painting();mask=Number(choice.value);
    draft=structuredClone(p.maskShapes?.[mask] ?? {curves:maskContours(mask,p.curve).map(c=>[c.point]),smooth:true});
    curveIndex=0;selected=0;
    contour.replaceChildren(...draft.curves.map((_,i)=>new Option(`Contorno ${i+1}`,String(i))));
    contour.disabled=draft.curves.length===1;
    status.textContent='Applica per salvare le modifiche nella bozza.';draw();
  };
  choice.onchange=load;
  contour.onchange=()=>{curveIndex=Number(contour.value);selected=0;draw();};
  smooth.onchange=()=>{draft.smooth=smooth.checked;draw();};
  const position = (e: MouseEvent): MaskPoint => {
    const r=canvas.getBoundingClientRect();return {x:clamp(((e.clientX-r.left)*480/r.width-24)/432),y:clamp(((e.clientY-r.top)*480/r.height-24)/432)};
  };
  const nearest = (p: MaskPoint) => draft.curves[curveIndex].findIndex(q=>Math.hypot(q.x-p.x,q.y-p.y)<.045);
  canvas.onpointerdown=e=>{
    if(e.button!==0)return;
    const p=position(e), points=draft.curves[curveIndex];let index=nearest(p);
    if(index<0){
      if(points.length>=8)return;
      const info=maskContours(mask,painting().curve)[curveIndex], nodes=[info.start,...points,info.end];
      let best=Infinity, insertion=0;
      for(let i=0;i<nodes.length-1;i++){
        const a=nodes[i],b=nodes[i+1], dx=b.x-a.x,dy=b.y-a.y;
        const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
        const distance=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
        if(distance<best){best=distance;insertion=i;}
      }
      points.splice(insertion,0,p);index=insertion;
    }
    selected=index;dragging=true;canvas.setPointerCapture(e.pointerId);draw();
  };
  canvas.onpointermove=e=>{if(dragging){draft.curves[curveIndex][selected]=position(e);draw();}};
  canvas.onpointerup=canvas.onpointercancel=()=>{dragging=false;};
  const remove = () => {const points=draft.curves[curveIndex];if(points.length>1){points.splice(selected,1);selected=Math.max(0,selected-1);draw();}};
  canvas.ondblclick=e=>{const i=nearest(position(e));if(i>=0){selected=i;remove();}};
  dialog.querySelector('#mask-remove-point')!.addEventListener('click',remove);
  const preset = (angular: boolean) => {
    const {start,end}=maskContours(mask,painting().curve)[curveIndex],dx=end.x-start.x,dy=end.y-start.y;
    draft.curves[curveIndex]=[.2,.4,.6,.8].map((t,i)=>({x:clamp(start.x+dx*t-dy*(i%2?.17:-.17)),y:clamp(start.y+dy*t+dx*(i%2?.17:-.17))}));
    draft.smooth=!angular;selected=0;draw();
  };
  dialog.querySelector('#mask-wave')!.addEventListener('click',()=>preset(false));
  dialog.querySelector('#mask-angular')!.addEventListener('click',()=>preset(true));
  dialog.querySelector('#mask-apply')!.addEventListener('click',()=>{
    const saved=structuredClone(draft), selectedMask=mask;
    change(()=>{const p=current().painting??=defaultWorldPainting();(p.maskShapes??={})[selectedMask]=saved;});
    status.textContent='Maschera salvata nella bozza. Puoi modificarne un’altra o chiudere.';
  });
  dialog.querySelector('#mask-reset')!.addEventListener('click',()=>{
    change(()=>{if(current().painting?.maskShapes)delete current().painting!.maskShapes![mask];});load();
  });
  dialog.querySelector('#mask-close')!.addEventListener('click',()=>dialog.close());
  return {open: (index=1)=>{choice.value=String(Math.max(1,Math.min(14,index)));load();dialog.showModal();},refresh:()=>{if(dialog.open)load();}};
}
