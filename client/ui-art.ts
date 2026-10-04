import type { ClassId } from '../shared/types';
/** Shared portraits and icons for lobby and HUD components. */
export const PROFILE_URLS: Partial<Record<ClassId, string>> = {
  paladin: new URL('../assets/paladinoProfile.png', import.meta.url).href,
  mage: new URL('../assets/mageProfile.png', import.meta.url).href,
  warrior: new URL('../assets/warriorProfile.png', import.meta.url).href,
};

export const CLASS_ICONS: Record<ClassId, string> = {
  mage: '<path d="M12 2 14.7 9.3 22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7Z"/><path d="m19 2 1 3 3 1M3 19l-1 3"/>',
  warrior: '<path d="m5 3 4 1 10 12-3 3L4 7Z"/><path d="m19 3-4 1-4 5M5 16l4-4M3 17l4 4M17 15l4 4M5 19l-2 3M19 19l3 3"/>',
  paladin: '<path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Z"/><path d="M12 6v11M8 10h8"/>',
  hunter: '<path d="M12 2v20M17 5l-5-3-5 3M12 2l-7 7v6l7 7M5 12h14"/>',
};
export const ABILITY_ICONS: Record<string, string> = {
  projectile: '<path d="m4 20 8-8M3 14l5-5M10 21l5-5M13 4l7-1-1 7-7 3-3-3Z"/>',
  melee: '<path d="m5 3 4 1 11 12-4 4L4 8ZM12 18l6-6M5 19l3-3M3 21l3-3"/>',
  area: '<circle cx="12" cy="12" r="4"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4 4l3 3M17 17l3 3M4 20l3-3M17 7l3-3"/>',
  heal: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
  shield: CLASS_ICONS.paladin,
  dash: '<path d="m11 3 9 9-9 9M3 6l6 6-6 6M6 12h14"/>',
  trap: '<circle cx="12" cy="12" r="8"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"/>',
};
export function icon(paths: string, extra = ''): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths}</svg>`;
}

export function portrait(classId: ClassId): string {
  const profileUrl = PROFILE_URLS[classId];
  if (profileUrl) {
    return `<img class="player-profile-image" src="${profileUrl}" alt="" onerror="this.hidden=true;this.nextElementSibling?.removeAttribute('hidden')">${icon(CLASS_ICONS[classId], 'hidden')}`;
  }
  return icon(CLASS_ICONS[classId]);
}

