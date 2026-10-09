export const AUDIO_STORAGE_KEY = 'riftlands.audio.volumes';
export interface AudioSettings { effects: number; music: number; }
export function parseAudioSettings(raw: string | null): AudioSettings {
  let value: any; try { value = JSON.parse(raw ?? '{}'); } catch { value = {}; }
  const volume = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  return { effects: volume(value?.effects), music: volume(value?.music) };
}
