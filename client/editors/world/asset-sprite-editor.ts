import type { WorldAsset } from '../../../shared/world-schema';
import { assetSpriteFrame, spritesheetLayout, validAssetSpritesheet, type AssetSpritesheet } from '../../../shared/asset-sprites';
import { installAssetSheetComposer } from './asset-sheet-composer';

interface Host {
  asset(): WorldAsset | undefined; schedule(): void;
  apply(animation: AssetSpritesheet | undefined): void;
  import(file: File, animation?: AssetSpritesheet, footprint?: {width:number;height:number}): Promise<void>; report(e: unknown): void;
}
/** One image workspace: large stage, independent property rail, dedicated sprite controls. */
export function installAssetSpriteEditor(root: HTMLElement, host: Host) {
  const preview = root.querySelector<HTMLElement>('#asset-preview')!;
  const original = [...preview.children];
  const stage = document.createElement('div'); stage.className = 'asset-preview-stage';
  const controls = document.createElement('aside'); controls.className = 'asset-preview-controls';
  stage.append(...original.slice(0,3));
  const details = (title: string, nodes: Element[]) => {
    const d = document.createElement('details'); d.open = true; const s = document.createElement('summary'); s.textContent = title;
    d.append(s,...nodes); controls.append(d); return d;
  };
  const sprite = details('Animazione / Spritesheet', []); sprite.id = 'asset-sprite-panel';
  sprite.innerHTML += `<div class="fields"><p id="asset-sprite-source" class="hint"></p><button id="asset-sprite-import" type="button">Importa spritesheet PNG</button><input id="asset-sprite-file" type="file" accept=".png,image/png" hidden>
    <label class="check"><input id="asset-sprite-enabled" type="checkbox">Usa immagine come spritesheet</label>
    <div class="pair"><label>Colonne<input id="asset-sprite-columns" type="number" min="1" max="128" value="1"></label><label>Righe<input id="asset-sprite-rows" type="number" min="1" max="128" value="1"></label></div>
    <p class="hint">4 colonne × 1 riga: quattro frame affiancati. 1 colonna × 4 righe: quattro frame in verticale. Il ritaglio in pixel viene calcolato dal PNG.</p>
    <div class="pair"><label>Larghezza fotogramma · px<input id="asset-sprite-width" type="number" min="1" max="8192"></label><label>Altezza fotogramma · px<input id="asset-sprite-height" type="number" min="1" max="8192"></label></div>
    <div class="pair"><label>Fotogrammi utilizzati<input id="asset-sprite-count" type="number" min="1" max="128"></label><label>Tempo per fotogramma · ms<input id="asset-sprite-ms" type="number" min="16" max="60000" step="10"></label></div>
    <label class="check"><input id="asset-sprite-loop" type="checkbox">Ripeti animazione</label><label class="check"><input id="asset-sprite-random" type="checkbox">Partenza casuale per ogni copia</label>
    <p id="asset-sprite-info" class="hint"></p><button id="asset-sprite-update" type="button">Applica animazione</button>
    <div class="property-actions"><button id="asset-sprite-play" type="button">Pausa</button><button id="asset-sprite-restart" type="button">Ricomincia</button></div>
    <label>Fotogramma anteprima<input id="asset-sprite-frame" type="range" min="0" max="0" value="0" step="1"></label><output id="asset-sprite-frame-label">Frame 1 / 1</output>
    <p class="hint">Ordine: da sinistra a destra, poi la riga successiva. Ogni frame mantiene le sue proporzioni nell’ingombro in tile, centrato e allineato alla base. Collisioni e suddivisione restano quelle dell’asset. I fotogrammi devono avere uguali dimensioni e allineamento. Fino a 128 frame. Queste animazioni restano attive anche disabilitando le animazioni ambientali JS.</p></div>`;
  details('Ombra', original.slice(3,4));
  const dimensions = root.querySelector('#asset-width')!.closest('.pair')!, ratio = root.querySelector('#keep-ratio')!.closest('label')!;
  root.querySelector('#asset-cell-subdivision')!.closest('.fields')!.before(dimensions,ratio);
  const imageControls = details('Immagine nella griglia',original.slice(4,5));
  const save = document.createElement('button'); save.type = 'button'; save.id = 'asset-preview-save'; save.textContent = 'Salva scheda asset';
  save.onclick = () => (root.querySelector('#asset-update') as HTMLButtonElement).click(); imageControls.append(save);
  details('Celle e visibilità',original.slice(5));
  preview.replaceChildren(stage,controls);
  const dialog = root.querySelector<HTMLDialogElement>('#asset-preview-dialog')!;
  root.querySelector('#asset-preview-title')!.textContent = 'Editor immagine e animazione';
  const swap = document.createElement('button'); swap.type = 'button'; swap.id = 'asset-preview-swap'; swap.textContent = 'Controlli a sinistra';
  swap.onclick = () => { dialog.classList.toggle('controls-left'); swap.textContent = dialog.classList.contains('controls-left') ? 'Controlli a destra' : 'Controlli a sinistra'; };
  root.querySelector('#asset-preview-close')!.before(swap);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const value = (id: string) => el<HTMLInputElement>(id).value;
  const check = (id: string) => el<HTMLInputElement>(id).checked;
  let source = '', size: {width:number;height:number} | undefined, context = '', playing = true, frame = 0, startedAt = performance.now(), countEdited = false;
  const configIds = ['asset-sprite-enabled','asset-sprite-columns','asset-sprite-rows','asset-sprite-width','asset-sprite-height','asset-sprite-count','asset-sprite-ms','asset-sprite-loop','asset-sprite-random'];
  const composer = installAssetSheetComposer(root, {
    asset:host.asset,report:host.report,
    save:(file,animation,footprint)=>host.import(file,animation,footprint),
  });
  function gridFromPixels() {
    if (!size) return;
    const w = Number(value('asset-sprite-width')), h = Number(value('asset-sprite-height'));
    if (w > 0 && h > 0 && size.width % w === 0 && size.height % h === 0) {
      el<HTMLInputElement>('asset-sprite-columns').value = String(size.width / w);
      el<HTMLInputElement>('asset-sprite-rows').value = String(size.height / h);
    }
  }
  function pixelsFromGrid() {
    if (!size) return;
    const columns = Number(value('asset-sprite-columns')), rows = Number(value('asset-sprite-rows'));
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) return;
    el<HTMLInputElement>('asset-sprite-width').value = String(size.width / columns);
    el<HTMLInputElement>('asset-sprite-height').value = String(size.height / rows);
    el<HTMLInputElement>('asset-sprite-count').value = String(Math.min(128, columns * rows));
    for (const id of ['asset-sprite-width','asset-sprite-height','asset-sprite-count']) el(id).dispatchEvent(new Event('change',{bubbles:true}));
  }
  function read(): AssetSpritesheet | undefined {
    if (!check('asset-sprite-enabled')) return;
    const a = host.asset();
    if (!a || !/\.png$/i.test(a.image)) throw new Error('Per uno spritesheet importa un PNG.');
    const s = { frameWidth: Number(value('asset-sprite-width')), frameHeight: Number(value('asset-sprite-height')), frames: Number(value('asset-sprite-count')), frameMs: Number(value('asset-sprite-ms')), loop: check('asset-sprite-loop'), randomStart: check('asset-sprite-random') };
    if (!validAssetSpritesheet(s)) throw new Error('Controlla dimensioni, numero di frame (1–128) e tempo per frame (16–60000 ms).');
    if (!size || source !== a.image) throw new Error('Attendi il caricamento delle dimensioni del PNG.');
    spritesheetLayout(s,size.width,size.height); return s;
  }
  function info() {
    el<HTMLInputElement>('asset-sprite-random').disabled = !check('asset-sprite-loop');
    try {
      const s = read();
      if (s && size) { const layout = spritesheetLayout(s,size.width,size.height); el('asset-sprite-info').textContent = `${layout.columns} colonne × ${layout.rows} righe · ${s.frames} frame · ${(1000/s.frameMs).toFixed(1)} FPS`; }
      else el('asset-sprite-info').textContent = 'Immagine statica. Attiva spritesheet per ritagliare e animare i fotogrammi.';
    } catch (e) { el('asset-sprite-info').textContent = e instanceof Error ? e.message : String(e); }
  }
  function refresh() {
    composer.refresh();
    const a = host.asset(); if (!a) return;
    if (context !== a.id) { context = a.id; frame = 0; playing = true; countEdited = false; startedAt = performance.now(); el('asset-sprite-play').textContent = 'Pausa'; }
    const s = a.animation;
    el<HTMLInputElement>('asset-sprite-enabled').checked = !!s;
    el<HTMLInputElement>('asset-sprite-width').value = String(s?.frameWidth ?? size?.width ?? 1);
    el<HTMLInputElement>('asset-sprite-height').value = String(s?.frameHeight ?? size?.height ?? 1);
    el<HTMLInputElement>('asset-sprite-count').value = String(s?.frames ?? 1); el<HTMLInputElement>('asset-sprite-ms').value = String(s?.frameMs ?? 130);
    el<HTMLInputElement>('asset-sprite-loop').checked = s?.loop ?? true; el<HTMLInputElement>('asset-sprite-random').checked = s?.randomStart ?? false;
    el<HTMLInputElement>('asset-sprite-columns').value = '1'; el<HTMLInputElement>('asset-sprite-rows').value = '1'; gridFromPixels();
    if (source !== a.image) {
      source = a.image; size = undefined; el('asset-sprite-source').textContent = `Caricamento ${decodeURIComponent(a.image.split('/').at(-1)!)}…`;
      const image = new Image(), expected = source;
      image.onload = () => {
        if (source !== expected) return;
        size = {width:image.naturalWidth,height:image.naturalHeight};
        el('asset-sprite-source').textContent = `${decodeURIComponent(source.split('/').at(-1)!)} · ${size.width} × ${size.height} px`;
        if (!host.asset()?.animation && !check('asset-sprite-enabled')) {
          el<HTMLInputElement>('asset-sprite-width').value = String(size.width); el<HTMLInputElement>('asset-sprite-height').value = String(size.height);
        }
        gridFromPixels(); info(); host.schedule();
      };
      image.onerror = () => { if (source === expected) el('asset-sprite-source').textContent = 'Immagine non disponibile.'; }; image.src = source;
    }
    info();
  }
  for (const id of configIds) el(id).addEventListener('input', () => {
    if (id === 'asset-sprite-columns' || id === 'asset-sprite-rows') { pixelsFromGrid(); countEdited = false; }
    if (id === 'asset-sprite-count') countEdited = true;
    if ((id === 'asset-sprite-width' || id === 'asset-sprite-height') && !countEdited && !host.asset()?.animation && size) {
      const w = Number(value('asset-sprite-width')), h = Number(value('asset-sprite-height'));
      if (w > 0 && h > 0 && size.width%w === 0 && size.height%h === 0) el<HTMLInputElement>('asset-sprite-count').value = String(Math.min(128,size.width/w*size.height/h));
    }
    if (id === 'asset-sprite-width' || id === 'asset-sprite-height') {
      gridFromPixels();
      for (const field of ['asset-sprite-columns','asset-sprite-rows']) el(field).dispatchEvent(new Event('change',{bubbles:true}));
    }
    startedAt = performance.now(); frame = 0; info(); host.schedule();
  });
  el('asset-sprite-update').onclick = () => { try { host.apply(read()); } catch (e) { host.report(e); } };
  el('asset-sprite-import').onclick = () => el<HTMLInputElement>('asset-sprite-file').click();
  el('asset-sprite-file').onchange = () => { void (async () => {
    const file = el<HTMLInputElement>('asset-sprite-file').files?.[0]; if (!file) return;
    if (!/\.png$/i.test(file.name)) throw new Error('Importa uno spritesheet PNG.');
    await host.import(file); refresh();
  })().catch(host.report).finally(() => { el<HTMLInputElement>('asset-sprite-file').value = ''; }); };
  el('asset-sprite-play').onclick = () => { playing = !playing; startedAt = performance.now() - frame*Number(value('asset-sprite-ms')); el('asset-sprite-play').textContent = playing ? 'Pausa' : 'Riproduci'; host.schedule(); };
  el('asset-sprite-restart').onclick = () => { frame = 0; startedAt = performance.now(); host.schedule(); };
  el('asset-sprite-frame').oninput = () => { playing = false; frame = Number(value('asset-sprite-frame')); el('asset-sprite-play').textContent = 'Riproduci'; host.schedule(); };
  return {
    refresh, read, configIds, syncInfo: info,
    preview(a: WorldAsset): { asset: WorldAsset; frame?: number; animated: boolean } {
      try {
        const s = read(); if (!s) return {asset:{...a,animation:undefined},animated:false};
        const now = performance.now();
        if (playing) frame = assetSpriteFrame({...s,randomStart:false},now-startedAt);
        frame = Math.min(frame,s.frames-1);
        el<HTMLInputElement>('asset-sprite-frame').max = String(s.frames-1); el<HTMLInputElement>('asset-sprite-frame').value = String(frame);
        el('asset-sprite-frame-label').textContent = `Frame ${frame+1} / ${s.frames}`;
        return {asset:{...a,visual:{kind:'image'},animation:s},frame,animated:playing && (s.loop || frame < s.frames-1)};
      } catch { return {asset:a,frame:0,animated:false}; }
    },
  };
}
