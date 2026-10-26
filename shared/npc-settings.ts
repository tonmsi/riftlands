export interface NpcSettings {
  variantId?: string;
  showDialogueRing?: boolean;
  name?: string; dialogueId?: string; speed?: number; wanderRadius?: number;
  aggroRadius?: number; leashRadius?: number; respawnMs?: number; initialAngle?: number;
}
export function validNpcSettings(value: unknown): value is NpcSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  if (settings.showDialogueRing !== undefined && typeof settings.showDialogueRing !== 'boolean') return false;
  if (settings.variantId !== undefined && (typeof settings.variantId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(settings.variantId))) return false;
  for (const key of ['name', 'dialogueId']) if (settings[key] !== undefined && (typeof settings[key] !== 'string' || (settings[key] as string).length > 80)) return false;
  const ranges = { speed: 1000, wanderRadius: 10000, aggroRadius: 10000, leashRadius: 10000, respawnMs: 86_400_000, initialAngle: 360 };
  for (const [key, max] of Object.entries(ranges)) if (settings[key] !== undefined && (typeof settings[key] !== 'number' || !Number.isFinite(settings[key]) || (settings[key] as number) < 0 || (settings[key] as number) > max)) return false;
  return Object.keys(settings).every(key => ['name', 'dialogueId', 'variantId', 'showDialogueRing', ...Object.keys(ranges)].includes(key));
}
