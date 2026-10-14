import { parseWallSpriteKitCatalog, type WallSpriteKit } from '../../shared/wall-sprite-kits';

/** A single selector shared by both makers; missing packs never prevent editing legacy maps. */
export function installWallSpriteKitControl(select: HTMLSelectElement, material: HTMLSelectElement,
  changed: () => void = () => {}, info?: HTMLElement) {
  let kits: WallSpriteKit[] = [];
  select.addEventListener('change', () => {
    const kit = kits.find(k => k.id === select.value);
    if (kit) material.value = kit.material;
    changed();
  });
  // Choosing an ordinary wall material explicitly returns to the standard artwork.
  material.addEventListener('change', () => { select.value = ''; changed(); });
  const ready = fetch('/terrain-walls/catalog.json').then(async response => {
    if (!response.ok) throw new Error('Catalogo non disponibile');
    const catalog = parseWallSpriteKitCatalog(await response.json());
    kits = catalog.kits;
    const previous = select.value;
    select.replaceChildren(new Option('Predefinito', ''), ...kits.map(kit => new Option(kit.name, kit.id)));
    select.value = kits.some(kit => kit.id === previous) ? previous : '';
    select.title = catalog.issues.join('\n');
    if (info) { info.textContent = catalog.issues.length ? catalog.issues.join(' · ') : ''; info.hidden = !catalog.issues.length; }
  }).catch(() => {
    select.title = 'Nessun catalogo PNG disponibile: usa i bordi predefiniti.';
    if (info) { info.textContent = select.title; info.hidden = false; }
  });
  return { ready, skin: () => select.value || undefined };
}
