/** Loading and rasterization stay outside the frame renderer. */
const SPRITE_RASTER_DPR = 2;
export interface RasterSpriteSheet {
  frames: HTMLCanvasElement[];
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error(`Impossibile caricare la risorsa ${url}`)), { once: true });
  });
  image.src = url;
  await loaded;
  try { await image.decode(); } catch { /* onload verifica già la validità dell'immagine */ }
  return image;
}

/** Rasterizza il foglio vettoriale all'avvio: il loop di animazione vede solo bitmap pronte. */
// Aggiungi parametri per colonne e righe, con default a 4x4
export async function rasterizeSpriteSheet(url: string, frameSize: number, drawSize: number, columns = 4, rows = 4): Promise<RasterSpriteSheet> {
  const image = await loadImage(url);
  const atlas = document.createElement('canvas');
  atlas.width = image.naturalWidth;
  atlas.height = image.naturalHeight;
  const atlasContext = atlas.getContext('2d');
  if (!atlasContext) throw new Error('Canvas 2D non disponibile per la cache delle sprite.');
  atlasContext.imageSmoothingEnabled = true;
  atlasContext.imageSmoothingQuality = 'high';
  atlasContext.drawImage(image, 0, 0);

  const cachedSize = Math.ceil(drawSize * SPRITE_RASTER_DPR);
  const frames: HTMLCanvasElement[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const frame = document.createElement('canvas');
      frame.width = cachedSize;
      frame.height = cachedSize;
      const frameContext = frame.getContext('2d');
      if (!frameContext) throw new Error('Canvas 2D non disponibile per un frame della sprite.');
      frameContext.imageSmoothingEnabled = true;
      frameContext.imageSmoothingQuality = 'high';
      frameContext.drawImage(atlas, column * frameSize, row * frameSize, frameSize, frameSize, 0, 0, cachedSize, cachedSize);
      frames.push(frame);
    }
  }
  return { frames };
}
