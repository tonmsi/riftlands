import type { WallMaterial } from './world-surfaces';

export const WALL_SPRITE_PARTS = ['body', 'front', 'cap', 'foot', 'side-left', 'side-right', 'corner', 'corner-left', 'corner-right',
  'inner-corner-left', 'inner-corner-right', 'back', 'back-left', 'back-right', 'center',
  'stairs-tread', 'stairs-riser', 'stairs-border', 'stairs-landing'] as const;
export type WallSpritePart = typeof WALL_SPRITE_PARTS[number];
export interface WallSpritePartImage { image: string; width: number; height: number; flipX?: boolean; }
export interface WallSpriteKit {
  id: string; name: string; material: WallMaterial; tileSize: number; levelHeight: number; pixelated: boolean;
  layout?: 'grid-3x3';
  parts: Partial<Record<WallSpritePart, WallSpritePartImage>>;
}
export interface WallSpriteKitCatalog { version: 1; kits: WallSpriteKit[]; issues: string[]; }
const materials = ['earth', 'rock', 'stone', 'brick', 'wood'] as const;
export const isWallSpriteKitId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);

/** A complete front remains independently available; named directional parts always take precedence. */
export function completeWallSpriteParts(input: WallSpriteKit['parts']): WallSpriteKit['parts'] {
  const parts = { ...input };
  if (!parts.body && parts.front) parts.body = { ...parts.front };
  if (parts.corner) {
    parts['corner-left'] ??= { ...parts.corner };
    parts['corner-right'] ??= { ...parts.corner, flipX: !parts.corner.flipX };
  }
  return parts;
}

function validPartImage(kitId: string, part: WallSpritePart, image: unknown): boolean {
  const names: WallSpritePart[] = part === 'body' ? ['body', 'front']
    : part === 'corner-left' || part === 'corner-right' ? [part, 'corner'] : [part];
  return names.some(name => image === `/terrain-walls/${kitId}/${name}.png`);
}

/** Folder discovery and client loading share the same bounded, local-only contract. */
export function parseWallSpriteKitCatalog(input: unknown): WallSpriteKitCatalog {
  const raw = input as any;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.kits) || raw.kits.length > 128 || !Array.isArray(raw.issues)
    || raw.issues.length > 512 || raw.issues.some((issue: unknown) => typeof issue !== 'string' || issue.length > 512))
    throw new Error('Catalogo dei kit PNG non valido.');
  const ids = new Set<string>();
  const kits = raw.kits.map((kit: any): WallSpriteKit => {
    if (!kit || !isWallSpriteKitId(kit.id) || ids.has(kit.id) || typeof kit.name !== 'string' || !kit.name.trim() || kit.name.length > 100
      || !materials.includes(kit.material) || !Number.isFinite(kit.tileSize) || kit.tileSize < 1 || kit.tileSize > 8192
      || !Number.isFinite(kit.levelHeight) || kit.levelHeight < .25 || kit.levelHeight > 8192
      || typeof kit.pixelated !== 'boolean' || kit.layout !== undefined && kit.layout !== 'grid-3x3'
      || !kit.parts || typeof kit.parts !== 'object' || Array.isArray(kit.parts))
      throw new Error('Definizione del kit PNG non valida.');
    ids.add(kit.id);
    const parts: WallSpriteKit['parts'] = {};
    for (const [name, part] of Object.entries(kit.parts) as [WallSpritePart, any][]) {
      if (!WALL_SPRITE_PARTS.includes(name) || !part || !validPartImage(kit.id, name, part.image)
        || !Number.isInteger(part.width) || part.width < 1 || part.width > 8192
        || !Number.isInteger(part.height) || part.height < 1 || part.height > 8192
        || part.flipX !== undefined && typeof part.flipX !== 'boolean')
        throw new Error(`Componente PNG non valido: ${name}.`);
      parts[name] = { image: part.image, width: part.width, height: part.height, ...(part.flipX !== undefined ? { flipX: part.flipX } : {}) };
    }
    const complete = completeWallSpriteParts(parts);
    if (!complete.body) throw new Error(`Kit ${kit.id}: manca body.png oppure front.png.`);
    return { id: kit.id, name: kit.name.trim(), material: kit.material, tileSize: kit.tileSize, levelHeight: kit.levelHeight,
      pixelated: kit.pixelated, ...(kit.layout !== undefined ? { layout: kit.layout } : {}), parts: complete };
  });
  return { version: 1, kits, issues: [...raw.issues] };
}
