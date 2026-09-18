import { DUNGEON_DEFINITIONS } from '../shared/dungeons';
import { dungeonOriginAt, dungeonPlacementIssue } from '../shared/dungeon-placement';
import { TERRAIN_CATALOG, type DungeonDraft } from '../shared/dungeon-draft';
import { World } from '../shared/world';
import type { Vec2 } from '../shared/types';
export function chooseDungeonPlacement(draft: DungeonDraft): Promise<Vec2 | null> {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog');
        dialog.className = 'world-picker';
        dialog.innerHTML = `<h2>Posiziona il dungeon nel mondo</h2><p>Clicca per scegliere. Trascina per esplorare, usa la rotella o i pulsanti per lo zoom. Il rettangolo evidenziato è il tuo dungeon.</p><div class="world-picker-tools"><button data-zoom="in" aria-label="Ingrandisci mappa mondo">+</button><button data-zoom="out" aria-label="Riduci mappa mondo">−</button></div><canvas aria-label="Scegli posizione dungeon sulla mappa del mondo" tabindex="0"></canvas><p class="placement-status" role="status"></p><div class="world-picker-actions"><button data-cancel>Annulla</button><button data-apply class="primary">Usa questa posizione</button></div>`;
        document.body.append(dialog);
        dialog.showModal();
        const canvas = dialog.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
        const apply = dialog.querySelector<HTMLButtonElement>('[data-apply]')!, message = dialog.querySelector<HTMLElement>('.placement-status')!;
        const world = new World(), background = document.createElement('canvas'), bg = background.getContext('2d')!;
        let chosen = { ...draft.origin }, center = { x: 0, y: -3200 }, span = Math.max(16000, Math.abs((chosen.x + draft.width / 2) * 48) * 2.5, Math.abs((chosen.y + draft.height / 2) * 48 + 3200) * 2.5);
        let w = 1, h = 1, scale = 1, gesture: {
            id: number;
            x: number;
            y: number;
            lastX: number;
            lastY: number;
            dragged: boolean;
        } | undefined;
        let scheduled = 0, dirty = true, closed = false;
        const screen = (p: Vec2) => ({ x: (p.x - center.x) * scale + w / 2, y: (p.y - center.y) * scale + h / 2 });
        const point = (x: number, y: number) => ({ x: center.x + (x - w / 2) / scale, y: center.y + (y - h / 2) / scale });
        function schedule(terrain = false): void { dirty ||= terrain; if (!scheduled)
            scheduled = requestAnimationFrame(draw); }
        function draw(): void {
            scheduled = 0;
            if (dirty) {
                // Overview sampling is bounded by canvas pixels, independent of world extent.
                for (let y = 0; y < h; y += 8)
                    for (let x = 0; x < w; x += 8) {
                        const p = point(x + 4, y + 4);
                        bg.fillStyle = TERRAIN_CATALOG[world.getTile(Math.floor(p.x / 48), Math.floor(p.y / 48))].color;
                        bg.fillRect(x, y, 8, 8);
                    }
                dirty = false;
            }
            ctx.drawImage(background, 0, 0);
            ctx.font = '12px system-ui';
            ctx.textAlign = 'left';
            ctx.lineWidth = 2;
            for (const d of DUNGEON_DEFINITIONS) {
                const b = d.layout.bounds, p = screen({ x: b.minTx * 48, y: b.minTy * 48 });
                ctx.fillStyle = '#191e24cc';
                ctx.strokeStyle = '#ffbd81';
                ctx.fillRect(p.x, p.y, (b.maxTx - b.minTx + 1) * 48 * scale, (b.maxTy - b.minTy + 1) * 48 * scale);
                ctx.strokeRect(p.x, p.y, (b.maxTx - b.minTx + 1) * 48 * scale, (b.maxTy - b.minTy + 1) * 48 * scale);
                ctx.fillStyle = '#fff';
                ctx.fillText(d.name, p.x, p.y - 7);
            }
            const home = screen({ x: 0, y: 0 });
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(home.x, home.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillText('Avamposto / arena', home.x + 9, home.y + 4);
            const issue = dungeonPlacementIssue(chosen, draft.width, draft.height), p = screen({ x: chosen.x * 48, y: chosen.y * 48 });
            ctx.fillStyle = issue ? '#ed655577' : '#a4ef8f77';
            ctx.strokeStyle = issue ? '#ff8176' : '#c8ffc1';
            ctx.fillRect(p.x, p.y, draft.width * 48 * scale, draft.height * 48 * scale);
            ctx.strokeRect(p.x, p.y, draft.width * 48 * scale, draft.height * 48 * scale);
            ctx.fillStyle = '#fff';
            ctx.fillText(draft.name, p.x, p.y - 7);
            apply.disabled = !!issue;
            message.textContent = issue ?? 'Posizione disponibile. Terreno, boss, NPC e incontri verranno spostati insieme.';
        }
        const resize = new ResizeObserver(() => { const r = canvas.getBoundingClientRect(); w = Math.max(1, Math.round(r.width)); h = Math.max(1, Math.round(r.height)); canvas.width = background.width = w; canvas.height = background.height = h; scale = w / span; schedule(true); });
        resize.observe(canvas);
        function zoom(factor: number): void { span = Math.max(1600, Math.min(2000000, span * factor)); scale = w / span; schedule(true); }
        dialog.querySelector('[data-zoom="in"]')!.addEventListener('click', () => zoom(.7));
        dialog.querySelector('[data-zoom="out"]')!.addEventListener('click', () => zoom(1 / .7));
        canvas.addEventListener('wheel', e => { e.preventDefault(); zoom(e.deltaY < 0 ? .85 : 1 / .85); }, { passive: false });
        canvas.addEventListener('pointerdown', e => { if (gesture || e.button !== 0)
            return; canvas.focus(); canvas.setPointerCapture(e.pointerId); gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragged: false }; });
        canvas.addEventListener('pointermove', e => { if (!gesture || gesture.id !== e.pointerId)
            return; gesture.dragged ||= Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 5; if (gesture.dragged) {
            center.x -= (e.clientX - gesture.lastX) / scale;
            center.y -= (e.clientY - gesture.lastY) / scale;
            schedule(true);
        } gesture.lastX = e.clientX; gesture.lastY = e.clientY; });
        canvas.addEventListener('pointerup', e => { if (!gesture || gesture.id !== e.pointerId)
            return; if (!gesture.dragged) {
            const r = canvas.getBoundingClientRect();
            chosen = dungeonOriginAt(point(e.clientX - r.left, e.clientY - r.top), draft.width, draft.height);
            schedule();
        } gesture = undefined; });
        canvas.addEventListener('pointercancel', () => { gesture = undefined; });
        canvas.addEventListener('lostpointercapture', () => { gesture = undefined; });
        canvas.addEventListener('keydown', e => { const delta: Record<string, Vec2> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }; if (delta[e.key]) {
            e.preventDefault();
            chosen.x += delta[e.key].x;
            chosen.y += delta[e.key].y;
            schedule();
        } });
        function finish(result: Vec2 | null): void { if (closed)
            return; closed = true; cancelAnimationFrame(scheduled); resize.disconnect(); dialog.close(); dialog.remove(); resolve(result); }
        dialog.querySelector('[data-cancel]')!.addEventListener('click', () => finish(null));
        apply.addEventListener('click', () => { if (!dungeonPlacementIssue(chosen, draft.width, draft.height))
            finish(chosen); });
        dialog.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    });
}
