export interface AssetSpritesheet {
  frameWidth: number; frameHeight: number; frames: number; frameMs: number; loop: boolean; randomStart: boolean;
}
export function validAssetSpritesheet(value: unknown): value is AssetSpritesheet {
  const a = value as AssetSpritesheet;
  return !!a && typeof a === 'object' && !Array.isArray(a)
    && [a.frameWidth, a.frameHeight].every(n => Number.isInteger(n) && n >= 1 && n <= 8192)
    && Number.isInteger(a.frames) && a.frames >= 1 && a.frames <= 128
    && Number.isInteger(a.frameMs) && a.frameMs >= 16 && a.frameMs <= 60_000
    && typeof a.loop === 'boolean' && typeof a.randomStart === 'boolean';
}
export function spritesheetLayout(a: AssetSpritesheet, width: number, height: number): { columns: number; rows: number } {
  if (!validAssetSpritesheet(a) || width % a.frameWidth || height % a.frameHeight) throw new Error('Le dimensioni del PNG devono essere multipli delle dimensioni del fotogramma.');
  const columns = width / a.frameWidth, rows = height / a.frameHeight;
  if (!columns || !rows || a.frames > columns * rows) throw new Error('Il numero di fotogrammi supera quelli contenuti nel PNG.');
  return { columns, rows };
}
export function assetSpriteFrame(a: AssetSpritesheet, elapsed: number, phase = 0): number {
  const index = Math.floor(Math.max(0, elapsed) / a.frameMs + (a.loop && a.randomStart ? phase * a.frames : 0));
  return a.loop ? index % a.frames : Math.min(a.frames - 1, index);
}
