/** Screen pixels keep speech readable at every camera zoom, including touch. */
export function drawSpeechBubble(ctx: CanvasRenderingContext2D, text: string, x: number, headY: number,
  viewportWidth: number, viewportHeight: number, opacity: number): void {
  ctx.save();
  ctx.font = '600 13px system-ui';
  const maxWidth = Math.max(80, Math.min(260, viewportWidth - 40)), lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth - 24) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  const width = Math.min(maxWidth, Math.max(100, ...lines.map(l => ctx.measureText(l).width + 24)));
  const height = lines.length * 19 + 20;
  const left = Math.max(10, Math.min(viewportWidth - width - 10, x - width / 2));
  const top = Math.max(10, Math.min(viewportHeight - height - 18, headY - height - 12));
  const tailX = Math.max(left + 14, Math.min(left + width - 14, x));
  ctx.globalAlpha = opacity;
  ctx.fillStyle = '#f3ecd8'; ctx.strokeStyle = '#584c3b'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(left, top, width, height, 10); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tailX - 6, top + height - 1); ctx.lineTo(tailX, top + height + 8);
  ctx.lineTo(tailX + 6, top + height - 1); ctx.fill();
  ctx.beginPath(); ctx.moveTo(tailX - 6, top + height); ctx.lineTo(tailX, top + height + 8);
  ctx.lineTo(tailX + 6, top + height); ctx.stroke();
  ctx.fillStyle = '#302a23'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, left + width / 2, top + 10 + i * 19));
  ctx.restore();
}
