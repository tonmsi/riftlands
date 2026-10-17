import { defaultWorldPainting, type PaintMaterial } from '../../../shared/world-painting';
import type { WorldDocument } from '../../../shared/world-schema';
import { terrainMaskCommands } from '../../render/terrain-masks';
import { installPaintingMaskEditor } from './painting-mask-editor';
import { installTransitionScope } from './painting-transition-scope';
import { installWaterCoastControls } from './water-coast-controls';

const names: Record<PaintMaterial, string> = { grass: 'Erba', path: 'Strade', water: 'Mare / acqua', mud: 'Fango',
  snow: 'Neve', ice: 'Ghiaccio', rock: 'Rocce', bush: 'Cespugli', stone: 'Pavimenti dungeon' };
export function installWorldPaintingPanel(root: HTMLElement, current: () => WorldDocument, change: (action: () => void) => void): () => void {
  const panel = document.createElement('details');
  panel.id = 'world-painting-panel'; panel.className = 'world-panel';
  panel.innerHTML = `<summary>05 · World Painting</summary><p class="hint">Aspetto della mappa selezionata. I confini usano quattro celle vicine e 16 maschere. Il mare continua sotto la terra.</p>
    <div class="fields"><label>Bordi<select id="painting-edges"><option value="masks">Nuove maschere · 4 angoli</option><option value="legacy">Bordi precedenti · confronto</option></select></label>
    <label>Curvatura dei bordi<input id="painting-curve" type="range" min="0" max="1" step=".05"></label>
    <label class="check"><input id="show-painting" type="checkbox" checked>Anteprima pittorica sulla mappa</label></div>
    <p class="hint">Anteprima dettagliata da 12 px/cella. Allontanando la vista torna la mappa semplificata.</p>
    <canvas id="painting-masks" width="288" height="288" style="width:100%;height:auto" aria-label="Le 16 maschere di passaggio tra acqua e terra"></canvas>
    <button id="painting-edit-masks" class="wide">Modifica le singole maschere…</button>
    <p class="hint">Clicca una maschera per disegnarne il contorno con punti, onde o spezzate. Le maschere vuota (0) e piena (15) restano fisse.</p>
    <div class="fields">${(Object.keys(names) as PaintMaterial[]).map(key => `<fieldset><legend>${names[key]}</legend>
      <label>Colore base<input id="painting-${key}-color" type="color"></label>
      <label>Intensità macchie<input id="painting-${key}-intensity" type="range" min="0" max="2" step=".05"></label>
      <label>Grandezza macchie<input id="painting-${key}-size" type="range" min=".25" max="2" step=".05"></label></fieldset>`).join('')}</div>
    <button id="painting-reset" class="wide">Ripristina World Painting</button>
    <p class="hint">Le modifiche entrano nella bozza e nell’esportazione; usa “Applica al gioco” per installarle. Annulla e ripeti funzionano anche qui. Rocce e cespugli conservano le forme degli oggetti.</p>`;
  root.querySelector('.world-palette')!.append(panel);
  const nav = root.querySelector('.palette-navigation')!;
  const button = document.createElement('button'); button.textContent = 'Painting';
  button.onclick = () => { panel.open = true; panel.scrollIntoView({ block: 'start' }); }; nav.append(button);
  const input = (id: string) => panel.querySelector<HTMLInputElement>(`#${id}`)!;
  const scope=installTransitionScope(panel,current,change);
  const refreshCoast=installWaterCoastControls(panel,current,change);
  const maskEditor = installPaintingMaskEditor(panel,change,scope);
  panel.querySelector('#painting-edit-masks')!.addEventListener('click',()=>maskEditor.open());
  const atlas = panel.querySelector<HTMLCanvasElement>('#painting-masks')!;
  atlas.style.cursor='pointer';
  atlas.addEventListener('click',e=>{
    const r=atlas.getBoundingClientRect(), mask=Math.floor((e.clientY-r.top)*288/r.height/72)*4+Math.floor((e.clientX-r.left)*288/r.width/72);
    if(mask>0&&mask<15)maskEditor.open(mask);
  });
  const refresh = () => {
    refreshCoast();
    const painting = current().painting ?? defaultWorldPainting();
    scope.refresh();
    const style=scope.style(),colors=scope.colors();
    (panel.querySelector('#painting-edges') as HTMLSelectElement).value = painting.edges;
    input('painting-curve').value = String(style.curve);
    for (const key of Object.keys(names) as PaintMaterial[]) for (const prop of ['color', 'intensity', 'size'] as const) {
      const control = input(`painting-${key}-${prop}`); control.value = String(painting.materials[key][prop]);
      control.title = control.value;
    }
    const canvas = panel.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    ctx.clearRect(0,0,288,288);
    for (let mask = 0; mask < 16; mask++) {
      ctx.save(); ctx.translate(mask % 4 * 72 + 4, Math.floor(mask / 4) * 72 + 4);
      ctx.fillStyle = colors.background; ctx.fillRect(0,0,64,64);
      ctx.fillStyle = colors.foreground; ctx.fill(new Path2D(terrainMaskCommands(mask,64,style.curve,style.maskShapes?.[mask])), 'evenodd');
      ctx.fillStyle = '#14291a'; ctx.font = '11px sans-serif'; ctx.fillText(String(mask),3,13); ctx.restore();
    }
    maskEditor.refresh();
  };
  panel.addEventListener('change', event => {
    const target = event.target as HTMLInputElement;
    if (target.id!=='painting-edges'&&target.id!=='painting-curve'&&!/^painting-(grass|path|water|mud|snow|ice|rock|bush|stone)-(color|intensity|size)$/.test(target.id)) return;
    change(() => {
      const painting = current().painting ??= defaultWorldPainting();
      if (target.id === 'painting-edges') painting.edges = target.value as 'masks' | 'legacy';
      else if (target.id === 'painting-curve') scope.target(true)!.curve = Number(target.value);
      else if (/^painting-(grass|path|water|mud|snow|ice|rock|bush|stone)-(color|intensity|size)$/.test(target.id)) {
        const [, key, prop] = target.id.split('-') as [string, PaintMaterial, 'color' | 'intensity' | 'size'];
        if (prop === 'color') painting.materials[key].color = target.value;
        else painting.materials[key][prop] = Number(target.value);
      }
    });
  });
  input('painting-curve').addEventListener('input', () => {
    // Preview mask geometry immediately; the map commits once on slider release.
    const canvas = panel.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    const painting = current().painting ?? defaultWorldPainting();
    const style=scope.style(),colors=scope.colors();
    for (let mask = 0; mask < 16; mask++) {
      ctx.save(); ctx.translate(mask % 4 * 72 + 4, Math.floor(mask / 4) * 72 + 4);
      ctx.fillStyle = colors.background; ctx.fillRect(0,0,64,64);
      ctx.fillStyle = colors.foreground; ctx.fill(new Path2D(terrainMaskCommands(mask,64,Number(input('painting-curve').value),style.maskShapes?.[mask])), 'evenodd'); ctx.restore();
    }
  });
  panel.querySelector('#painting-reset')!.addEventListener('click', () => change(() => { current().painting = defaultWorldPainting(); }));
  scope.onSelection(refresh);
  return refresh;
}
