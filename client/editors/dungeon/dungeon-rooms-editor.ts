import type { DungeonDraft } from '../../../shared/dungeon-draft';
import type { Vec2 } from '../../../shared/types';

export function installDungeonRooms(root: HTMLElement, host: { draft(): DungeonDraft; change(action: () => void): void; tool(): string; setTool(tool: string): void; refresh(): void; status(message: string): void; connect(): void }) {
  const panel = document.createElement('details'); panel.open = true; panel.id = 'dungeon-section-stanze'; panel.className = 'maker-disclosure';
  panel.innerHTML = '<summary>Stanze</summary><p class="hint">Disegna la forma della stanza, anche a L. Dentro vedi solo questa stanza; fuori non vedi il suo contenuto. Si entra e si esce solo con i passaggi.</p><label>Stanza selezionata<select id="dungeon-room-list"></select></label><button id="dungeon-room-new">＋ Nuova stanza</button><label>Nome stanza<input id="dungeon-room-name" maxlength="80"></label><div class="tool-grid"><button data-tool="room-add">Disegna / aggiungi</button><button data-tool="room-rectangle">Rettangolo</button><button data-tool="room-cut">Ritaglia</button></div><label>Dimensione pennello<select id="dungeon-room-brush"><option value="0">1 casella</option><option value="1">3 × 3</option><option value="2">5 × 5</option></select></label><button id="dungeon-room-connect">Collega passaggio</button><button id="dungeon-room-delete">Elimina stanza</button><p id="dungeon-room-info" class="hint"></p>';
  root.querySelector('#dungeon-section-passaggi')!.before(panel);
  const navigation = document.createElement('button'); navigation.textContent = 'Stanze'; navigation.onclick = () => { panel.open = true; panel.scrollIntoView({ block: 'start' }); };
  const nav = root.querySelector('.dungeon-navigation')!; nav.insertBefore(navigation, [...nav.children].find(button => button.textContent === 'Passaggi') ?? null);
  const el = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  let selected = '';
  let rectangle: { start: Vec2; tiles: Vec2[] } | null = null;
  const active = () => host.draft().rooms?.find(room => room.id === selected);
  el('dungeon-room-new').onclick = () => { host.change(() => { const rooms = host.draft().rooms ??= []; if (rooms.length >= 64) throw new Error('Massimo 64 stanze.'); selected = crypto.randomUUID(); rooms.push({ id: selected, name: `Stanza ${rooms.length + 1}`, tiles: [] }); }); host.setTool('room-add'); host.refresh(); };
  el<HTMLSelectElement>('dungeon-room-list').onchange = () => { selected = el<HTMLSelectElement>('dungeon-room-list').value; host.refresh(); };
  el<HTMLInputElement>('dungeon-room-name').onchange = () => { const name = el<HTMLInputElement>('dungeon-room-name').value.trim(); if (name) host.change(() => { if (active()) active()!.name = name; }); else host.refresh(); };
  el('dungeon-room-delete').onclick = () => host.change(() => { host.draft().rooms = host.draft().rooms?.filter(room => room.id !== selected); selected = ''; });
  el('dungeon-room-connect').onclick = () => { if (active()?.tiles.length) host.connect(); };
  function refresh() {
    const rooms = host.draft().rooms ?? []; if (!active()) selected = rooms[0]?.id ?? '';
    el<HTMLSelectElement>('dungeon-room-list').replaceChildren(...(rooms.length ? rooms.map(room => new Option(`${room.name} · ${room.tiles.length} caselle`, room.id)) : [new Option('Nessuna stanza: premi Nuova stanza', '')]));
    el<HTMLSelectElement>('dungeon-room-list').value = selected; el<HTMLInputElement>('dungeon-room-name').value = active()?.name ?? '';
    for (const id of ['dungeon-room-name', 'dungeon-room-delete', 'dungeon-room-brush']) (el(id) as HTMLInputElement | HTMLButtonElement).disabled = !active();
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.disabled = !active();
    el<HTMLButtonElement>('dungeon-room-connect').disabled = !active()?.tiles.length;
    el('dungeon-room-info').textContent = active() ? 'Trascina per disegnare o ritagliare. Con Rettangolo trascina fra due angoli per riempire tutta la superficie. Il resto della mappa è lo spazio comune. Aggiorna la bozza installata prima di collegare i passaggi.' : 'Crea una stanza e disegna la sua forma sulla mappa.';
  }
  function paint(point: Vec2, previous: Vec2 | null): boolean {
    if (host.tool() === 'room-rectangle') {
      const room = active(); if (!room) return true;
      const draft = host.draft();
      rectangle ??= { start: { ...point }, tiles: room.tiles.slice() };
      const tiles = new Map(rectangle.tiles.map(p => [`${p.x},${p.y}`, p]));
      const others = new Set(draft.rooms!.filter(r => r !== room).flatMap(r => r.tiles.map(p => `${p.x},${p.y}`)));
      let overlap = false;
      for (let y = Math.max(0, Math.min(rectangle.start.y, point.y)); y <= Math.min(draft.height - 1, Math.max(rectangle.start.y, point.y)); y++)
        for (let x = Math.max(0, Math.min(rectangle.start.x, point.x)); x <= Math.min(draft.width - 1, Math.max(rectangle.start.x, point.x)); x++) {
          const key = `${x},${y}`;
          if (others.has(key)) overlap = true; else tiles.set(key, { x, y });
        }
      room.tiles = [...tiles.values()];
      if (overlap) host.status('Le caselle di altre stanze restano escluse dal rettangolo.');
      return true;
    }
    if (!['room-add','room-cut'].includes(host.tool())) return false;
    const room = active(); if (!room) return true;
    const draft = host.draft(), radius = Number(el<HTMLSelectElement>('dungeon-room-brush').value);
    const from = previous ?? point, steps = Math.max(Math.abs(from.x - point.x), Math.abs(from.y - point.y));
    const tiles = new Map(room.tiles.map(p => [`${p.x},${p.y}`, p]));
    const others = new Set(draft.rooms!.filter(r => r !== room).flatMap(r => r.tiles.map(p => `${p.x},${p.y}`)));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 1, cx = Math.round(from.x + (point.x - from.x) * t), cy = Math.round(from.y + (point.y - from.y) * t);
      for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x >= draft.width || y >= draft.height) continue;
        const key = `${x},${y}`; if (host.tool() === 'room-cut') tiles.delete(key); else if (!others.has(key)) tiles.set(key, { x, y }); else host.status('Questa casella appartiene già a un’altra stanza.');
      }
    }
    room.tiles = [...tiles.values()]; return true;
  }
  function draw(ctx: CanvasRenderingContext2D, scale: number) {
    for (const [index, room] of (host.draft().rooms ?? []).entries()) {
      const color = `hsl(${(index * 67 + 270) % 360} 70% 72%)`, cells = new Set(room.tiles.map(p => `${p.x},${p.y}`));
      ctx.strokeStyle = color; ctx.lineWidth = room.id === selected ? 3 : 1.5; ctx.fillStyle = color;
      for (const tile of room.tiles) {
        ctx.globalAlpha = room.id === selected ? .18 : .08; ctx.fillRect(tile.x * scale, tile.y * scale, scale, scale); ctx.globalAlpha = 1;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if (!cells.has(`${tile.x + dx},${tile.y + dy}`)) {
          const x = (tile.x + (dx === 1 ? 1 : 0)) * scale, y = (tile.y + (dy === 1 ? 1 : 0)) * scale;
          ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x + (dx === 0 ? scale : 0), y + (dy === 0 ? scale : 0)); ctx.stroke();
        }
      }
      const anchor = room.tiles.slice().sort((a,b) => a.y - b.y || a.x - b.x)[0];
      if (anchor) { ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(room.name, anchor.x * scale + 4, anchor.y * scale + 4); }
    }
  }
  return { refresh, paint, draw, finish: () => { rectangle = null; }, selectedId: () => selected };
}
