import { dungeonFloorGraph } from './dungeon-floor-graph';
import { type DungeonRoom } from '../../../shared/dungeon-topology';
import type { DungeonDraft } from '../../../shared/dungeon-draft';
/** DOM controls use textContent for authored labels and participate in the maker's undo stack. */
export function topologyPanel(host: HTMLElement, getDraft: () => DungeonDraft, change: (action: () => void) => void, focus: (room: DungeonRoom) => void, portalHost: HTMLElement) {
  const section = document.createElement('section'); host.append(section);
  const number = (parent: HTMLElement, label: string, value: number, update: (n: number) => void) => {
    const wrap = document.createElement('label'); wrap.textContent = label;
    const input = document.createElement('input'); input.type = 'number'; input.value = String(value); input.step = '1';
    input.addEventListener('change', () => change(() => update(Number(input.value)))); wrap.append(input); parent.append(wrap);
  };
  const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', () => change(action)); section.append(b); };
  const title = (label: string) => { const h = document.createElement('h3'); h.textContent = label; section.append(h); };
  const xy = (parent: HTMLElement, p: { x: number; y: number }, prefix = '') => { number(parent, `${prefix}Colonna`, p.x, n => p.x = n); number(parent, `${prefix}Riga`, p.y, n => p.y = n); };
  return () => {
    section.replaceChildren(); portalHost.replaceChildren(); portalHost.hidden = !getDraft().topology; title('Stanze, piani e portali');
    const draft = getDraft(), enabled = document.createElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !!draft.topology;
    enabled.append(checkbox, ' Dungeon separato · ingresso immediato'); section.append(enabled);
    checkbox.addEventListener('change', () => change(() => {
      if (!checkbox.checked) delete draft.topology;
      else draft.topology = { entry: { x: 2, y: 2 }, exit: { x: 3, y: 2 }, worldExit: { x: draft.origin.x - 3, y: draft.origin.y }, rooms: [{ id: 'room-1', name: 'Stanza 1', floor: 0, x: 0, y: 0, width: draft.width, height: draft.height }], warps: [], shadows: [] };
    }));
    if (!draft.topology) return;
    const t = draft.topology;
    title('Panoramica di tutti i piani'); section.append(dungeonFloorGraph(t, focus));
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Il World Maker posiziona il portale. Scegli il piano nella barra degli strumenti. Disegna, aggiungi o ritaglia la forma della stanza direttamente sulla mappa. Fuori dalla stanza resta il vuoto. I warp collegano anche piani diversi. Nessuna attesa al passaggio.'; section.append(hint);
    const portalTitle = document.createElement('h3'); portalTitle.textContent = 'Ingresso e uscita sulla mappa'; portalHost.append(portalTitle);
    const placement = (label: string, tool: string) => { const b = document.createElement('button'); b.textContent = label; b.dataset.tool = tool; b.style.borderColor = tool === 'entry-place' ? '#c59aff' : '#76e4ff'; b.style.color = tool === 'entry-place' ? '#c59aff' : '#76e4ff'; portalHost.append(b); };
    placement('IN · Posiziona ingresso al dungeon', 'entry-place');
    const points = document.createElement('div'); points.className = 'two-fields'; portalHost.append(points); xy(points, t.entry, 'Ingresso · ');
    placement('OUT · Posiziona uscita finale nel mondo', 'exit-place');
    const exitPoints = document.createElement('div'); exitPoints.className = 'two-fields'; portalHost.append(exitPoints); xy(exitPoints, t.exit, 'Uscita finale · ');
    const destination = document.createElement('h3'); destination.textContent = 'Destinazione nel mondo'; portalHost.append(destination);
    const exitFields = document.createElement('div'); exitFields.className = 'two-fields'; portalHost.append(exitFields);
    if (t.worldExit) xy(exitFields, t.worldExit);
    else { const b = document.createElement('button'); b.textContent = 'Configura destinazione nel mondo'; b.addEventListener('click', () => change(() => t.worldExit = { x: draft.origin.x - 3, y: draft.origin.y })); portalHost.append(b); }
    const portalHint = document.createElement('p'); portalHint.className = 'hint'; portalHint.textContent = 'Scegli lo strumento e clicca una casella libera. Per andare a un altro piano usa Posiziona warp: clicca la partenza, cambia piano e clicca la destinazione. Il portale esterno si posiziona nel World Maker.'; portalHost.append(portalHint);
    for (const r of t.rooms) {
      title(r.name); const label = document.createElement('input'); label.value = r.name; label.setAttribute('aria-label', 'Nome stanza'); label.addEventListener('change', () => change(() => r.name = label.value)); section.append(label);
      const fields = document.createElement('div'); fields.className = 'two-fields'; section.append(fields); xy(fields, r); number(fields, 'Piano', r.floor, n => r.floor = n); number(fields, 'Larghezza', r.width, n => r.width = n); number(fields, 'Altezza', r.height, n => r.height = n);
      if (r.tiles) { for (const input of fields.querySelectorAll('input')) if (input.parentElement?.textContent !== 'Piano') input.disabled = true; }
      button('Rimuovi stanza', () => t.rooms.splice(t.rooms.indexOf(r), 1));
    }
    title('Collegamenti warp'); const warpHint=document.createElement('p'); warpHint.className='hint'; warpHint.textContent='Aggiungi o sposta i warp con gli strumenti a sinistra.'; section.append(warpHint);
    for (const w of t.warps) {
      const fields = document.createElement('div'); fields.className = 'two-fields'; section.append(fields); xy(fields, w.from, 'Da · '); xy(fields, w.to, 'A · ');
      button('Rimuovi warp', () => t.warps.splice(t.warps.indexOf(w), 1));
    }
    title('Zone d’ombra');
    for (const shadow of t.shadows) {
      const fields = document.createElement('div'); fields.className = 'two-fields'; section.append(fields); xy(fields, shadow); number(fields, 'Larghezza', shadow.width, n => shadow.width = n); number(fields, 'Altezza', shadow.height, n => shadow.height = n); number(fields, 'Visibilità (tile)', shadow.revealRadius, n => shadow.revealRadius = n);
      button('Rimuovi ombra', () => t.shadows.splice(t.shadows.indexOf(shadow), 1));
    }
  };
}
