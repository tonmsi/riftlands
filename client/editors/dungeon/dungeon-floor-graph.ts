import { dungeonRoomContains } from '../../../shared/dungeon-topology';
import type { DungeonTopology, DungeonRoom } from '../../../shared/dungeon-topology';

export function dungeonFloorGraph(t: DungeonTopology, focus: (room: DungeonRoom) => void): HTMLElement {
  const ns = 'http://www.w3.org/2000/svg', wrapper = document.createElement('div'); wrapper.style.overflowX = 'auto';
  const floors = [...new Set(t.rooms.map(r => r.floor))].sort((a, b) => b - a);
  const width = Math.max(240, floors.length * 180), height = Math.max(140, Math.max(...floors.map(f => t.rooms.filter(r => r.floor === f).length)) * 90 + 60);
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height)); svg.setAttribute('aria-label', 'Panoramica dei piani e dei warp'); svg.style.background = '#111b1e'; svg.style.borderRadius = '8px'; wrapper.append(svg);
  const element = (tag: string, attrs: Record<string, string>, parent: Element = svg) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); parent.append(node); return node; };
  const text = (x: number, y: number, label: string, parent: Element = svg) => { const node = element('text', { x: String(x), y: String(y), fill: '#e9e1fa', 'font-size': '12', 'font-family': 'system-ui', 'text-anchor': 'middle' }, parent); node.textContent = label; };
  const nodes = new Map(t.rooms.map(r => [r.id, { room: r, x: floors.indexOf(r.floor)*180+90, y: t.rooms.filter(other => other.floor === r.floor).indexOf(r)*90+80 }]));
  floors.forEach((floor, i) => text(i*180+90, 26, `Piano ${floor}`));
  const roomAt = (p: { x: number; y: number }) => t.rooms.find(r => dungeonRoomContains(r,p.x,p.y));
  const connections = new Map<string, { from: string; to: string; reverse: boolean }>();
  for (const warp of t.warps) {
    const from = roomAt(warp.from)?.id, to = roomAt(warp.to)?.id;
    if (!from || !to) continue;
    const reverse = connections.get(`${to}:${from}`);
    if (reverse) reverse.reverse = true;
    else connections.set(`${from}:${to}`, { from, to, reverse: false });
  }
  for (const edge of connections.values()) {
    const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!;
    const path = element('path', { d: `M ${a.x} ${a.y} C ${a.x+55} ${a.y-40}, ${b.x-55} ${b.y-40}, ${b.x} ${b.y}`, stroke: '#b898f5', 'stroke-width': '2', fill: 'none' });
    const title = element('title', {}, path); title.textContent = `${a.room.name} ${edge.reverse ? '↔' : '→'} ${b.room.name}`;
    text((a.x+b.x)/2, (a.y+b.y)/2-30, edge.reverse ? '↔ warp' : '→ warp');
  }
  for (const node of nodes.values()) {
    const group = element('g', { role: 'button', tabindex: '0', 'aria-label': `Vai a ${node.room.name}, piano ${node.room.floor}` }); group.style.cursor = 'pointer';
    element('rect', { x: String(node.x-65), y: String(node.y-20), width: '130', height: '42', rx: '7', fill: '#302342', stroke: '#c5a3ff' }, group);
    text(node.x, node.y+4, node.room.name.length > 17 ? `${node.room.name.slice(0,16)}…` : node.room.name, group);
    group.addEventListener('click', () => focus(node.room)); group.addEventListener('keydown', event => { const key = (event as KeyboardEvent).key; if (key === 'Enter' || key === ' ') { event.preventDefault(); focus(node.room); } });
  }
  return wrapper;
}
