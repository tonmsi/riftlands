import type { MatchResult } from '../shared/types';

export interface TransitionOverlay {
  heading: string;
  title: string;
  detail: string;
  opacity: number;
  veil: number;
  position?: number;
  vignette?: boolean;
}

/** Shared veil, panel and typography for dungeon entry and match outcomes. */
export function drawTransitionOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, overlay: TransitionOverlay): void {
  ctx.save();
  if (overlay.vignette) {
    const shade = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * .25, width / 2, height / 2, Math.hypot(width, height) / 2);
    shade.addColorStop(0, 'rgba(12,18,18,0)');
    shade.addColorStop(1, `rgba(12,18,18,${overlay.veil})`);
    ctx.fillStyle = shade;
  } else ctx.fillStyle = `rgba(12,18,18,${overlay.veil})`;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = overlay.opacity;
  const y = Math.max(100, height * (overlay.position ?? .22));
  const panelWidth = Math.min(600, width - 32);
  const gradient = ctx.createLinearGradient(width / 2 - panelWidth / 2, 0, width / 2 + panelWidth / 2, 0);
  gradient.addColorStop(0, '#101b1b00'); gradient.addColorStop(.2, '#101b1be8');
  gradient.addColorStop(.8, '#101b1be8'); gradient.addColorStop(1, '#101b1b00');
  ctx.fillStyle = gradient;
  ctx.fillRect(width / 2 - panelWidth / 2, y - 34, panelWidth, 112);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#efcf87'; ctx.font = '600 13px system-ui';
  ctx.fillText(overlay.heading, width / 2, y, panelWidth - 24);
  ctx.fillStyle = '#fff3d5'; ctx.font = '600 30px Georgia';
  ctx.fillText(overlay.title, width / 2, y + 32, panelWidth - 24);
  ctx.fillStyle = '#c5c7b8'; ctx.font = '13px system-ui';
  ctx.fillText(overlay.detail, width / 2, y + 59, panelWidth - 24);
  ctx.restore();
}

export const MATCH_RESULT_DURATION_MS = 5000;
export function matchResultText(result: MatchResult): Pick<TransitionOverlay, 'heading' | 'title' | 'detail'> {
  const title = { win: 'Hai vinto', loss: 'Hai perso', draw: 'Pareggio', closed: 'Partita conclusa' }[result.outcome];
  const heading = result.mode === 'arena' ? 'ARENA CONCLUSA' : 'BATTLEGROUND CONCLUSO';
  const detail = result.reason === 'forfeit'
    ? result.outcome === 'win' ? 'Forfait · L’avversario ha abbandonato la partita' : 'Forfait · Hai abbandonato la partita'
    : result.reason === 'timeout' ? 'Tempo scaduto · Ritorno nel mondo'
    : result.reason === 'elimination' ? result.outcome === 'draw' ? 'Entrambe le squadre sono state eliminate' : result.outcome === 'win' ? 'Avversario sconfitto · Ritorno nel mondo' : 'Sei stato sconfitto · Ritorno nel mondo'
    : 'Ritorno nel mondo';
  return { heading, title, detail };
}
