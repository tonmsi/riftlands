const pngUrls = import.meta.glob('../../public/actor-assets/fish-*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const fishImages = new Map<string, HTMLImageElement>();
export function drawFishingItem(ctx: CanvasRenderingContext2D, id: string): void {
  const url = pngUrls[`../../public/actor-assets/${id}.png`];
  if (url) {
    let img = fishImages.get(id);
    if (!img) { img = new Image(); img.onload = () => window.dispatchEvent(new Event('fishing-art-ready')); img.src = url; fishImages.set(id, img); }
    if (img.complete && img.naturalWidth) { const scale = 44 / Math.max(img.naturalWidth, img.naturalHeight); ctx.drawImage(img, 24 - img.naturalWidth * scale / 2, 24 - img.naturalHeight * scale / 2, img.naturalWidth * scale, img.naturalHeight * scale); return; }
  }
  if (id === 'fishing-rod') {
    ctx.lineCap = 'round'; ctx.strokeStyle = '#745232'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(10, 41); ctx.lineTo(22, 27); ctx.stroke();
    ctx.strokeStyle = '#d9bb7e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(19, 31); ctx.quadraticCurveTo(28, 15, 39, 6); ctx.stroke();
    ctx.strokeStyle = '#bde4e9'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(39, 6); ctx.lineTo(38, 29); ctx.quadraticCurveTo(34, 38, 30, 30); ctx.stroke();
    ctx.fillStyle = '#81aebb'; ctx.strokeStyle = '#e3e8c9'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(16, 30, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  } else {
    const color = id === 'fish-pike' ? '#99c9d1' : id === 'fish-catfish' ? '#9a9378' : '#d2a069';
    ctx.fillStyle = color; ctx.strokeStyle = '#e8ecd4'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(13, 24); ctx.lineTo(4, 14); ctx.lineTo(4, 34); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(28, 24, 16, 10, -.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e0d9b0'; ctx.beginPath(); ctx.moveTo(22, 16); ctx.lineTo(28, 7); ctx.lineTo(33, 16); ctx.fill();
    ctx.fillStyle = '#152e36'; ctx.beginPath(); ctx.arc(36, 21, 2, 0, Math.PI * 2); ctx.fill();
    if (id === 'fish-catfish') { ctx.strokeStyle = '#dec69c'; ctx.beginPath(); ctx.moveTo(40, 27); ctx.lineTo(45, 34); ctx.moveTo(40, 25); ctx.lineTo(47, 26); ctx.stroke(); }
  }
}
