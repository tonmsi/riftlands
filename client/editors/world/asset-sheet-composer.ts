import type { WorldAsset } from '../../../shared/world-schema';
import type { AssetSpritesheet } from '../../../shared/asset-sprites';

interface Rect { x: number; y: number; width: number; height: number; }
interface Frame { crop: Rect; x: number; y: number; }
interface Host {
  asset(): WorldAsset | undefined;
  save(file: File, animation: AssetSpritesheet, footprint: {width:number;height:number}): Promise<void>;
  report(error: unknown): void;
}
/** Source selections become equal transparent frame boxes; offsets are baked only on save. */
export function installAssetSheetComposer(root: HTMLElement, host: Host) {
  const stage = root.querySelector<HTMLElement>('.asset-preview-stage')!, rail = root.querySelector<HTMLElement>('.asset-preview-controls')!;
  const panel = document.createElement('details'); panel.className = 'asset-sheet-controls'; panel.open = true; panel.hidden = true;
  panel.innerHTML = `<summary>Seleziona tile e componi</summary><div class="fields">
    <p>Imposta la griglia sul foglio, poi trascina sul foglio per selezionare il box di una singola immagine.</p>
    <div class="pair"><label>Colonne del foglio<input id="asset-sheet-columns" type="number" min="1" max="128"></label><label>Righe del foglio<input id="asset-sheet-rows" type="number" min="1" max="128"></label></div>
    <output id="asset-sheet-selection">Seleziona un box sul foglio.</output>
    <button id="asset-sheet-add" type="button">Aggiungi selezione come frame</button><button id="asset-sheet-split" type="button">Dividi tutto con questo box</button>
    <p>In basso trascina il contenuto del frame. Il box resta fermo e diventa la dimensione del fotogramma risultante. Le parti spostate fuori dal box vengono tagliate.</p>
    <div id="asset-sheet-frames" aria-label="Fotogrammi selezionati"></div>
    <div class="pair"><label>Spostamento X · px<input id="asset-sheet-x" type="number" value="0"></label><label>Spostamento Y · px<input id="asset-sheet-y" type="number" value="0"></label></div>
    <label class="check"><input id="asset-sheet-all" type="checkbox">Sposta tutti i fotogrammi insieme</label><label class="check"><input id="asset-sheet-snap" type="checkbox">Aggancia lo spostamento ai tile</label>
    <div class="property-actions"><button id="asset-sheet-center" type="button">Centra contenuto</button><button id="asset-sheet-remove" type="button">Rimuovi frame</button></div>
    <output id="asset-sheet-result"></output><button id="asset-sheet-save" type="button">Crea spritesheet e usa sull’asset</button><button id="asset-sheet-close" type="button">Torna all’anteprima</button>
    <p>Viene creato un nuovo PNG trasparente. Il file originale è conservato. L’ingombro dell’asset diventa quello del box selezionato, per esempio 3×3 tile. Pubblica poi con Applica al gioco.</p></div>`;
  rail.prepend(panel);
  const workspace = document.createElement('div'); workspace.className = 'asset-sheet-workspace'; workspace.hidden = true;
  workspace.innerHTML = `<strong>Foglio originale · trascina per selezionare i tile</strong><canvas id="asset-sheet-source" aria-label="Selezione tile del foglio"></canvas><strong>Fotogramma risultante · trascina per spostare il contenuto</strong><canvas id="asset-sheet-frame" aria-label="Sposta il contenuto del fotogramma"></canvas>`;
  stage.append(workspace);
  const el = <T extends HTMLElement=HTMLElement>(id:string) => root.querySelector<T>(`#${id}`)!;
  const input = (id:string) => el<HTMLInputElement>(`asset-sheet-${id}`);
  const sourceCanvas = el<HTMLCanvasElement>('asset-sheet-source'), frameCanvas = el<HTMLCanvasElement>('asset-sheet-frame');
  const openButton = document.createElement('button'); openButton.id = 'asset-sheet-open'; openButton.type = 'button'; openButton.textContent = 'Seleziona tile e componi…';
  root.querySelector('#asset-sprite-import')!.before(openButton);
  let image: HTMLImageElement | undefined, context = '', opened = false, busy = false, selection: Rect | undefined;
  let frames: Frame[] = [], current = 0, box: {width:number;height:number;tilesX:number;tilesY:number} | undefined;
  let sourceView = {x:0,y:0,scale:1}, frameView = {x:0,y:0,scale:1};
  let selecting: {pointer:number;x:number;y:number} | undefined, dragging: {pointer:number;x:number;y:number;offsetX:number;offsetY:number} | undefined;
  const columns = () => Math.max(1,Math.min(128,Math.trunc(Number(input('columns').value)||1)));
  const rows = () => Math.max(1,Math.min(128,Math.trunc(Number(input('rows').value)||1)));
  function canvasContext(canvas: HTMLCanvasElement, width:number, height:number) {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2,devicePixelRatio||1);
    const w = Math.max(1,Math.round(r.width*dpr)), h = Math.max(1,Math.round(r.height*dpr));
    if (canvas.width!==w || canvas.height!==h) { canvas.width=w;canvas.height=h; }
    const ctx = canvas.getContext('2d')!;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,r.width,r.height);
    const scale = Math.min((r.width-20)/width,(r.height-20)/height);
    return {ctx,x:(r.width-width*scale)/2,y:(r.height-height*scale)/2,scale:Math.max(.001,scale)};
  }
  function grid(ctx:CanvasRenderingContext2D,width:number,height:number,cols:number,rs:number,scale:number) {
    ctx.strokeStyle='#a9c6ad99';ctx.lineWidth=1/scale;ctx.beginPath();
    for(let x=0;x<=cols;x++){ctx.moveTo(x*width/cols,0);ctx.lineTo(x*width/cols,height);}
    for(let y=0;y<=rs;y++){ctx.moveTo(0,y*height/rs);ctx.lineTo(width,y*height/rs);}ctx.stroke();
  }
  function paintFrame(ctx:CanvasRenderingContext2D,frame:Frame,x:number,y:number) {
    if (!image || !box) return;
    ctx.save();ctx.beginPath();ctx.rect(x,y,box.width,box.height);ctx.clip();
    const c=frame.crop;ctx.drawImage(image,c.x,c.y,c.width,c.height,x+frame.x,y+frame.y,c.width,c.height);ctx.restore();
  }
  function draw() {
    if (!opened || !image) return;
    const s=canvasContext(sourceCanvas,image.naturalWidth,image.naturalHeight);sourceView=s;
    s.ctx.save();s.ctx.translate(s.x,s.y);s.ctx.scale(s.scale,s.scale);s.ctx.drawImage(image,0,0);grid(s.ctx,image.naturalWidth,image.naturalHeight,columns(),rows(),s.scale);
    if(selection){const r=pixels(selection);s.ctx.fillStyle='#ffd36b33';s.ctx.fillRect(r.x,r.y,r.width,r.height);s.ctx.strokeStyle='#ffe296';s.ctx.lineWidth=3/s.scale;s.ctx.strokeRect(r.x,r.y,r.width,r.height);}s.ctx.restore();
    const b=box??{width:128,height:128,tilesX:1,tilesY:1},f=canvasContext(frameCanvas,b.width,b.height);frameView=f;
    f.ctx.save();f.ctx.translate(f.x,f.y);f.ctx.scale(f.scale,f.scale);if(frames[current])paintFrame(f.ctx,frames[current],0,0);grid(f.ctx,b.width,b.height,b.tilesX,b.tilesY,f.scale);
    f.ctx.strokeStyle='#ffe296';f.ctx.lineWidth=2/f.scale;f.ctx.strokeRect(0,0,b.width,b.height);f.ctx.restore();
  }
  function pixels(r:Rect):Rect {
    const x=Math.round(r.x*image!.naturalWidth/columns()),y=Math.round(r.y*image!.naturalHeight/rows());
    return {x,y,width:Math.round((r.x+r.width)*image!.naturalWidth/columns())-x,height:Math.round((r.y+r.height)*image!.naturalHeight/rows())-y};
  }
  function sync() {
    el('asset-sheet-selection').textContent=selection?`Box: ${selection.width} × ${selection.height} tile · da colonna ${selection.x+1}, riga ${selection.y+1}`:'Seleziona un box sul foglio.';
    const buttons=frames.map((_,i)=>{const b=document.createElement('button');b.type='button';b.textContent=String(i+1);b.setAttribute('aria-pressed',String(i===current));b.onclick=()=>{current=i;sync();};return b;});el('asset-sheet-frames').replaceChildren(...buttons);
    input('x').value=String(frames[current]?.x??0);input('y').value=String(frames[current]?.y??0);
    el('asset-sheet-result').textContent=box?`${frames.length} frame · ${box.width} × ${box.height} px ciascuno · ingombro ${box.tilesX} × ${box.tilesY} tile`: 'Aggiungi una selezione per creare il primo fotogramma.';
    for(const id of ['save','remove','center'])el<HTMLButtonElement>(`asset-sheet-${id}`).disabled=busy||!frames.length;
    for(const id of ['add','split'])el<HTMLButtonElement>(`asset-sheet-${id}`).disabled=busy||!selection;
    draw();
  }
  function close() {opened=false;workspace.hidden=panel.hidden=true;stage.classList.remove('sheet-editing');rail.classList.remove('sheet-editing-controls');}
  function add(r:Rect) {
    if(r.width>32||r.height>32)throw new Error('Il box finale dell’asset può occupare al massimo 32×32 tile.');
    const crop=pixels(r);if(crop.width<1||crop.height<1)throw new Error('Le celle selezionate sono più piccole di un pixel.');
    if(crop.width>8192||crop.height>8192||crop.width*crop.height>16_000_000)throw new Error('Il box selezionato è troppo grande.');
    if(frames.length>=128)throw new Error('Massimo 128 fotogrammi.');
    if(box&&(box.tilesX!==r.width||box.tilesY!==r.height))throw new Error('Seleziona un box con lo stesso numero di tile del primo frame.');
    box??={width:crop.width,height:crop.height,tilesX:r.width,tilesY:r.height};
    frames.push({crop,x:Math.round((box.width-crop.width)/2),y:Math.round((box.height-crop.height)/2)});current=frames.length-1;
  }
  function offset(x:number,y:number) {
    const frame=frames[current];if(!frame||!box)return;
    if(input('snap').checked){x=Math.round(x/(box.width/box.tilesX))*box.width/box.tilesX;y=Math.round(y/(box.height/box.tilesY))*box.height/box.tilesY;}
    x=Math.round(Math.max(-box.width,Math.min(box.width,x)));y=Math.round(Math.max(-box.height,Math.min(box.height,y)));
    const dx=x-frame.x,dy=y-frame.y;for(const f of input('all').checked?frames:[frame]){f.x+=dx;f.y+=dy;}sync();
  }
  function tile(event:PointerEvent) {
    const r=sourceCanvas.getBoundingClientRect();return {x:Math.max(0,Math.min(columns()-1,Math.floor((event.clientX-r.left-sourceView.x)/sourceView.scale/image!.naturalWidth*columns()))),y:Math.max(0,Math.min(rows()-1,Math.floor((event.clientY-r.top-sourceView.y)/sourceView.scale/image!.naturalHeight*rows())))};
  }
  sourceCanvas.onpointerdown=e=>{if(e.button!==0||!image||busy)return;const p=tile(e);selecting={pointer:e.pointerId,...p};selection={...p,width:1,height:1};sourceCanvas.setPointerCapture(e.pointerId);e.preventDefault();sync();};
  sourceCanvas.onpointermove=e=>{if(!selecting||selecting.pointer!==e.pointerId)return;const p=tile(e);selection={x:Math.min(p.x,selecting.x),y:Math.min(p.y,selecting.y),width:Math.abs(p.x-selecting.x)+1,height:Math.abs(p.y-selecting.y)+1};sync();};
  sourceCanvas.onpointerup=sourceCanvas.onpointercancel=()=>{selecting=undefined;};sourceCanvas.onlostpointercapture=()=>{selecting=undefined;};
  frameCanvas.onpointerdown=e=>{const frame=frames[current];if(e.button!==0||!frame||busy)return;dragging={pointer:e.pointerId,x:e.clientX,y:e.clientY,offsetX:frame.x,offsetY:frame.y};frameCanvas.setPointerCapture(e.pointerId);e.preventDefault();};
  frameCanvas.onpointermove=e=>{if(dragging?.pointer===e.pointerId)offset(dragging.offsetX+(e.clientX-dragging.x)/frameView.scale,dragging.offsetY+(e.clientY-dragging.y)/frameView.scale);};
  frameCanvas.onpointerup=frameCanvas.onpointercancel=()=>{dragging=undefined;};frameCanvas.onlostpointercapture=()=>{dragging=undefined;};
  for(const id of ['columns','rows'])input(id).oninput=()=>{selection=undefined;frames=[];box=undefined;sync();};
  for(const id of ['x','y'])input(id).oninput=()=>offset(Number(input('x').value)||0,Number(input('y').value)||0);
  el('asset-sheet-add').onclick=()=>{try{if(selection)add(selection);sync();}catch(e){host.report(e);}};
  el('asset-sheet-split').onclick=()=>{try{
    if(!selection)return;const {width,height}=selection;
    if(columns()%width||rows()%height)throw new Error('Il box deve dividere esattamente la griglia del foglio. Puoi anche aggiungere i frame uno alla volta.');
    if(columns()/width*rows()/height>128)throw new Error('Il box produce più di 128 fotogrammi.');
    frames=[];box=undefined;for(let y=0;y<rows();y+=height)for(let x=0;x<columns();x+=width)add({x,y,width,height});current=0;sync();
  }catch(e){host.report(e);}};
  el('asset-sheet-remove').onclick=()=>{frames.splice(current,1);current=Math.max(0,Math.min(current,frames.length-1));if(!frames.length)box=undefined;sync();};
  el('asset-sheet-center').onclick=()=>{
    const f=frames[current];if(!f||!image||!box)return;
    const canvas=document.createElement('canvas');canvas.width=f.crop.width;canvas.height=f.crop.height;const ctx=canvas.getContext('2d')!;const c=f.crop;
    ctx.drawImage(image,c.x,c.y,c.width,c.height,0,0,c.width,c.height);const data=ctx.getImageData(0,0,c.width,c.height).data;
    let left=c.width,top=c.height,right=-1,bottom=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(data[(y*c.width+x)*4+3]>=16){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if(right>=left)offset((box.width-left-right-1)/2,(box.height-top-bottom-1)/2);
  };
  el('asset-sheet-close').onclick=close;
  openButton.onclick=()=>{void(async()=>{
    const a=host.asset();if(!a)return;const expected=`${a.id}:${a.image}`;
    const loaded=new Image();loaded.src=a.image;await loaded.decode();if(`${host.asset()?.id}:${host.asset()?.image}`!==expected)return;
    if(context!==expected){image=loaded;context=expected;frames=[];box=selection=undefined;current=0;input('columns').value=String(Math.min(128,a.columns));input('rows').value=String(Math.min(128,a.rows));}
    opened=true;workspace.hidden=panel.hidden=false;stage.classList.add('sheet-editing');rail.classList.add('sheet-editing-controls');sync();
  })().catch(host.report);};
  el('asset-sheet-save').onclick=()=>{void(async()=>{
    const a=host.asset();if(!a||!box||!frames.length||busy)return;busy=true;sync();
    try{
      const b={...box},count=frames.length,cols=Math.min(count,Math.max(1,Math.floor(columns()/b.tilesX))),rs=Math.ceil(count/cols);
      if(b.width*cols>8192||b.height*rs>8192||b.width*cols*b.height*rs>16_000_000)throw new Error('Il foglio risultante è troppo grande (massimo 8192 px per lato e 16 milioni di pixel).');
      const canvas=document.createElement('canvas');canvas.width=b.width*cols;canvas.height=b.height*rs;const ctx=canvas.getContext('2d')!;
      frames.forEach((f,i)=>paintFrame(ctx,f,(i%cols)*b.width,Math.floor(i/cols)*b.height));
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Impossibile creare il PNG.')),'image/png'));
      if(`${host.asset()?.id}:${host.asset()?.image}`!==context)throw new Error('Asset cambiato: riapri il compositore.');
      const animation:AssetSpritesheet={frameWidth:b.width,frameHeight:b.height,frames:count,frameMs:a.animation?.frameMs??130,loop:a.animation?.loop??true,randomStart:a.animation?.randomStart??false};
      await host.save(new File([blob],`${a.id}-spritesheet.png`,{type:'image/png'}),animation,{width:b.tilesX,height:b.tilesY});close();
    }finally{busy=false;sync();}
  })().catch(host.report);};
  new ResizeObserver(()=>draw()).observe(workspace);
  sync();
  return {refresh(){const a=host.asset();if(context&&`${a?.id}:${a?.image}`!==context){close();context='';image=undefined;frames=[];box=selection=undefined;}}};
}
