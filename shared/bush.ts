import { newWorldAsset, type WorldAsset } from './world-schema';

/** Also used for legacy terrain bushes, even in maps without a catalog entry. */
export const terrainBushAsset = newWorldAsset('terrain-bush', 'Cespuglio', '/world-assets/bush.png');
terrainBushAsset.imageTransform = { x: -.15, y: -.15, scale: 1.3 };
export const isBushAsset = (asset: WorldAsset): boolean => asset.id === 'bush' || asset.image === '/world-assets/bush.png';
