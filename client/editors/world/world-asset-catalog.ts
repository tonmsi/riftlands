import { worldAssetCategory, type WorldAsset } from '../../../shared/world-schema';

export type CatalogCategory = 'all' | 'floor' | 'object' | 'elevation';
export const assetCategoryLabels = { floor: 'Pavimento', object: 'Oggetto', elevation: 'Rialzo' } as const;
const catalogCategory = (value: unknown): CatalogCategory => value === 'floor' || value === 'object' || value === 'elevation' ? value : 'all';

/** Catalog groups follow the image's public folder instead of manual tags. */
export const assetGroup = (asset: WorldAsset): string => {
  let path = asset.image.split(/[?#]/)[0].replaceAll('\\', '/');
  try { path = decodeURIComponent(path); } catch { /* Preserve malformed legacy URLs. */ }
  const match = /(?:^|\/)world-assets\/(.*)/.exec(path);
  if (match) {
    const folders = match[1].split('/').slice(0, -1).filter(Boolean);
    return folders.length ? folders.join(' / ') : 'world-assets';
  }
  const folders = path.split('/').filter(Boolean).slice(0, -1);
  return folders.length ? folders.join(' / ') : 'Altri asset';
};
const PAGE_SIZE = 40;
/** Collapsed groups create no thumbnails; open groups grow in bounded pages. */
export class WorldAssetCatalog {
  private open = new Map<string, boolean>();
  private limits = new Map<string, number>();
  private searchOpen = new Map<string, boolean>();
  private assets: readonly WorldAsset[] = [];
  private active = '';
  private search = '';
  private category: CatalogCategory = 'all';
  private signature = '';
  constructor(private root: HTMLElement, private select: (id: string) => void) {
    try { for (const [group, open] of JSON.parse(localStorage.getItem('riftlands.asset-groups') ?? '[]')) if (typeof group === 'string' && typeof open === 'boolean') this.open.set(group, open); } catch { /* Optional view preferences. */ }
    try { this.category = catalogCategory(localStorage.getItem('riftlands.asset-category')); } catch { /* Optional view preferences. */ }
    const filter = this.root.ownerDocument.querySelector<HTMLSelectElement>('#asset-category-filter');
    if (filter) filter.value = this.category;
  }
  setCategory(value: string): void {
    const category = catalogCategory(value);
    if (category === this.category) return;
    this.category = category; this.limits.clear(); this.signature = '';
    try { localStorage.setItem('riftlands.asset-category', category); } catch { /* View preferences are optional. */ }
    const filter = this.root.ownerDocument.querySelector<HTMLSelectElement>('#asset-category-filter');
    if (filter) filter.value = category;
    this.render();
  }
  private save(): void {
    try { localStorage.setItem('riftlands.asset-groups', JSON.stringify([...this.open])); } catch { /* Catalog editing still works without preferences. */ }
  }
  expandAll(open: boolean): void {
    for (const asset of this.assets) (this.search.trim() ? this.searchOpen : this.open).set(assetGroup(asset), open);
    this.save(); this.signature = ''; this.render();
  }
  reveal(asset: WorldAsset): void {
    if (this.category !== 'all' && this.category !== worldAssetCategory(asset)) this.setCategory(worldAssetCategory(asset));
    this.open.set(assetGroup(asset), true); this.signature = ''; this.save();
  }
  update(assets: readonly WorldAsset[], active: string, search: string): void {
    this.assets = assets; this.active = active;
    if (this.search !== search) { this.limits.clear(); this.searchOpen.clear(); }
    this.search = search; this.render();
  }
  private render(): void {
    const search = this.search.trim().toLocaleLowerCase();
    const expansion = search ? this.searchOpen : this.open;
    const groups = new Map<string, WorldAsset[]>();
    for (const asset of [...this.assets].sort((a,b) => assetGroup(a).localeCompare(assetGroup(b), 'it') || a.name.localeCompare(b.name, 'it'))) {
      const group = assetGroup(asset);
      const category = worldAssetCategory(asset);
      if (this.category !== 'all' && category !== this.category) continue;
      if (search && !`${asset.name} ${group} ${assetCategoryLabels[category]} ${asset.generation.category}`.toLocaleLowerCase().includes(search)) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(asset);
    }
    const signature = JSON.stringify([search, this.category, [...groups].map(([group, assets]) => [group, expansion.get(group) ?? true, this.limits.get(group) ?? PAGE_SIZE,
      assets.map(a => [a.id, a.name, a.image, a.width, a.height, a.generation.enabled, worldAssetCategory(a)])])]);
    if (signature === this.signature) { this.markActive(); return; }
    this.signature = signature;
    this.root.replaceChildren();
    for (const [group, assets] of groups) {
      const details = document.createElement('details'); details.className = 'asset-group'; details.dataset.group = group;
      details.open = expansion.get(group) ?? true;
      const summary = document.createElement('summary'), name = document.createElement('span'), count = document.createElement('span');
      name.textContent = group; count.textContent = String(assets.length); count.className = 'group-count'; summary.append(name, count); details.append(summary);
      details.addEventListener('toggle', () => {
        if (!details.isConnected || details.open === (expansion.get(group) ?? true)) return;
        expansion.set(group, details.open); if (!search) this.save(); this.signature = ''; this.render();
      });
      if (details.open) {
        const items = document.createElement('div'); items.className = 'asset-group-items';
        const limit = this.limits.get(group) ?? PAGE_SIZE;
        for (const asset of assets.slice(0, limit)) {
          const button = document.createElement('button'); button.className = 'asset-item'; button.dataset.asset = asset.id; button.dataset.category = worldAssetCategory(asset);
          const image = document.createElement('img'); image.loading = 'lazy'; image.decoding = 'async'; image.src = asset.image; image.alt = '';
          const info = document.createElement('div'), name = document.createElement('span'), detail = document.createElement('small');
          name.textContent = asset.name; detail.textContent = `${asset.category ? '' : 'Auto · '}${assetCategoryLabels[worldAssetCategory(asset)]} · ${asset.width} × ${asset.height} · ${asset.generation.enabled ? 'genera + manuale' : 'manuale'}`;
          info.append(name, detail); button.append(image, info); button.onclick = () => this.select(asset.id); items.append(button);
        }
        if (assets.length > limit) {
          const more = document.createElement('button'); more.className = 'asset-more'; more.textContent = `Mostra altri · ${assets.length - limit} asset`;
          more.onclick = () => { this.limits.set(group, limit + PAGE_SIZE); this.render(); }; items.append(more);
        }
        details.append(items);
      }
      this.root.append(details);
    }
    if (!groups.size) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = search || this.category !== 'all' ? 'Nessun asset in questa selezione.' : 'Importa un’immagine per iniziare.'; this.root.append(empty); }
    this.markActive();
  }
  private markActive(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-asset]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.asset === this.active)));
  }
}
