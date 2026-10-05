import type { ClassId } from '../../../shared/types';

export interface LobbyArt {
  logo?: string;
  loginBackground?: string;
  selectionBackground?: string;
  classes: Partial<Record<ClassId, { portrait?: string; background?: string }>>;
}

// Keep decoded images alive: large PNGs are ready before the player enters.
const images = new Map<string, HTMLImageElement>();
const imageKeys = ['logo', 'loginBackground', 'selectionBackground'] as const;
const classIds: ClassId[] = ['paladin', 'warrior', 'mage', 'hunter'];

function localImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return;
  const url = new URL(value, location.origin);
  if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return;
  return url.href;
}

async function decodeImage(url: string): Promise<void> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { image.src = ''; reject(new Error('Timeout immagine')); }, 60_000);
    image.onload = () => { clearTimeout(timeout); resolve(); };
    image.onerror = () => { clearTimeout(timeout); reject(new Error('Immagine non disponibile')); };
    image.src = url;
  });
  await image.decode();
  images.set(url, image);
}

export async function prepareLobbyArt(
  spritesReady: Promise<void>,
  progress: (done: number, total: number, failed: number) => void,
  builtInPortraits: string[] = [],
): Promise<LobbyArt> {
  const art: LobbyArt = { classes: {} };
  try {
    const response = await fetch('/home/assets.json', { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Manifest non disponibile');
    const data = await response.json();
    for (const key of imageKeys) art[key] = localImage(data?.[key]);
    for (const id of classIds) art.classes[id] = {
      portrait: localImage(data?.classes?.[id]?.portrait),
      background: localImage(data?.classes?.[id]?.background),
    };
  } catch { /* Built-in art remains available without a custom manifest. */ }
  const urls = [...new Set([...builtInPortraits, ...imageKeys.map(key => art[key]), ...Object.values(art.classes).flatMap(value => [value?.portrait, value?.background])].filter((url): url is string => Boolean(url)))];
  let done = 0, failed = 0;
  const total = urls.length + 1;
  progress(done, total, failed);
  const complete = () => progress(++done, total, failed);
  // Three downloads at a time avoid decoding many heavy backgrounds together.
  let cursor = 0;
  await Promise.all([
    spritesReady.catch(() => { failed++; }).then(complete),
    ...Array.from({ length: Math.min(3, urls.length) }, async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        try { await decodeImage(url); } catch { failed++; }
        complete();
      }
    }),
  ]);
  for (const key of imageKeys) if (art[key] && !images.has(art[key]!)) delete art[key];
  for (const value of Object.values(art.classes)) {
    if (value?.portrait && !images.has(value.portrait)) delete value.portrait;
    if (value?.background && !images.has(value.background)) delete value.background;
  }
  return art;
}
