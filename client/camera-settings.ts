import type { Vec2 } from '../shared/types';

export const CAMERA_STORAGE_KEY = 'riftlands.camera';
export const VIEW_LIMITS = {
  standard: { width: 2200, height: 1400 },
  compact: { width: 1920, height: 1080 },
  close: { width: 1600, height: 1000 },
} as const;
export interface CameraSettings { zoom: number; viewLimit: keyof typeof VIEW_LIMITS; }
export function parseCameraSettings(raw: string | null): CameraSettings {
  try {
    const value = JSON.parse(raw ?? '{}');
    return {
      zoom: typeof value?.zoom === 'number' && Number.isFinite(value.zoom) ? Math.max(1, Math.min(2, value.zoom)) : 1,
      viewLimit: value?.viewLimit && Object.hasOwn(VIEW_LIMITS, value.viewLimit) ? value.viewLimit : 'standard',
    };
  } catch { return { zoom: 1, viewLimit: 'standard' }; }
}
export function cameraZoom(width: number, height: number, touch: boolean, settings: CameraSettings): number {
  const limit = VIEW_LIMITS[settings.viewLimit];
  const base = (width < 680 ? 0.8 : 0.95) * (touch ? 0.8 : 1);
  return base * Math.max(1, width / limit.width, height / limit.height) * settings.zoom;
}
/** Reflect about the horizontal axis only for the team spawning at the top. */
export function arenaViewSign(mode: string, teamId?: string | null): number {
  return mode === 'arena' && teamId?.endsWith(':0') ? -1 : 1;
}
export function viewVector(vector: Vec2, sign: number): Vec2 { return { x: vector.x, y: vector.y * sign }; }
