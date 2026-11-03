import type { WorldAsset } from '../../../shared/world-schema';
import { worldAssetImageBounds } from '../../../shared/world-schema';
import type { AssetUseLocation } from './world-asset-usage';

/** Explicit catalog folders override the default image-folder / random-pool grouping. */
export const assetGroup = (asset: WorldAsset, assets: readonly WorldAsset[] = []): string => {
  if (asset.group) return asset.group;
  const root = asset.variantOf ? assets.find(a => a.id === asset.variantOf) : asset;
  if (root && (asset.variantOf || assets.some(a => a.variantOf === root.id))) return root.name;
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
/** Shared by the catalog and the family selector so virtual variant pools appear in both. */
export function assetCatalogLabels(assets: readonly WorldAsset[]): Map<string, string> {
  const definitions = new Map(assets.map(a => [a.id, a]));
  const roots = new Set(assets.flatMap(a => a.variantOf ? [a.variantOf] : []));
  return new Map(assets.map(a => [a.id, a.group ?? (roots.has(a.variantOf ?? a.id) ? definitions.get(a.variantOf ?? a.id)?.name ?? a.name : assetGroup(a))]));
}
export function isAssetVariantGroup(assets: readonly WorldAsset[], all: readonly WorldAsset[]): boolean {
  const roots = new Set(all.flatMap(a => a.variantOf ? [a.variantOf] : []));
  return assets.some(a => !a.group && roots.has(a.variantOf ?? a.id));
}
/** Collapsed groups create no thumbnails; open groups grow in bounded pages. */
export class WorldAssetCatalog {
  private open = new Map<string, boolean>();
  private limits = new Map<string, number>();
  private searchOpen = new Map<string, boolean>();
  private assets: readonly WorldAsset[] = [];
  private active = '';
  private selected = new Set<string>();
  private usage = new Map<string, AssetUseLocation[]>();
  private mapId = 'world';
  private folders: readonly string[] = [];
  get selectedIds(): string[] { return [...this.selected]; }
  clearSelection(): void { this.selected.clear(); this.markActive(); }
  selectVisible(): void {
    const search = this.search.trim().toLocaleLowerCase(), labels = this.groupLabels();
    for (const asset of this.assets) if (!search || `${asset.name} ${labels.get(asset.id)} ${asset.generation.category}`.toLocaleLowerCase().includes(search)) this.selected.add(asset.id);
    this.markActive();
  }
  private search = '';
  private signature = '';
  constructor(private root: HTMLElement, private select: (id: string) => void, private multiple: () => boolean = () => false, private selectionChanged: () => void = () => {}, private locate: (id: string) => void = () => {}) {
    try { for (const [group, open] of JSON.parse(localStorage.getItem('riftlands.asset-groups') ?? '[]')) if (typeof group === 'string' && typeof open === 'boolean') this.open.set(group, open); } catch { /* Optional view preferences. */ }
  }
  private save(): void {
    try { localStorage.setItem('riftlands.asset-groups', JSON.stringify([...this.open])); } catch { /* Catalog editing still works without preferences. */ }
  }
  expandAll(open: boolean): void {
    for (const group of this.groupLabels().values()) (this.search.trim() ? this.searchOpen : this.open).set(group, open);
    this.save(); this.signature = ''; this.render();
  }
  reveal(asset: WorldAsset): void {
    const labels = this.groupLabels(), group = labels.get(asset.id) ?? assetGroup(asset, this.assets);
    const siblings = this.assets.filter(a => labels.get(a.id) === group).sort((a,b) => a.name.localeCompare(b.name, 'it'));
    this.limits.set(group, Math.max(this.limits.get(group) ?? PAGE_SIZE, siblings.findIndex(a => a.id === asset.id) + 1));
    this.open.set(group, true); this.signature = ''; this.save();
  }
  focusAsset(id: string): void {
    const asset = this.assets.find(a => a.id === id); if (!asset) return;
    this.search = ''; this.selected = new Set([id]); this.reveal(asset); this.render();
    const row = [...this.root.querySelectorAll<HTMLButtonElement>('[data-asset]')].find(button => button.dataset.asset === id);
    row?.scrollIntoView({ block: 'center' }); row?.focus({ preventScroll: true });
    this.selectionChanged();
  }
  update(assets: readonly WorldAsset[], active: string, search: string, usage = new Map<string, AssetUseLocation[]>(), folders: readonly string[] = [], mapId = 'world'): void {
    this.usage = usage; this.folders = folders; this.mapId = mapId;
    for (const id of this.selected) if (!assets.some(a => a.id === id)) this.selected.delete(id);
    this.assets = assets; this.active = active;
    if (this.search !== search) { this.limits.clear(); this.searchOpen.clear(); }
    this.search = search; this.render();
  }
  private groupLabels(): Map<string, string> {
    return assetCatalogLabels(this.assets);
  }
  private render(): void {
    const search = this.search.trim().toLocaleLowerCase();
    const expansion = search ? this.searchOpen : this.open;
    const groups = new Map<string, WorldAsset[]>();
    const labels = this.groupLabels();
    for (const folder of this.folders) if (!search || folder.toLocaleLowerCase().includes(search)) groups.set(folder, []);
    for (const asset of [...this.assets].sort((a,b) => labels.get(a.id)!.localeCompare(labels.get(b.id)!, 'it') || a.name.localeCompare(b.name, 'it'))) {
      const group = labels.get(asset.id)!;
      if (search && !`${asset.name} ${group} ${asset.generation.category}`.toLocaleLowerCase().includes(search)) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(asset);
    }
    const signature = JSON.stringify([search, this.multiple(), this.mapId, this.folders, [...groups].map(([group, assets]) => [group, expansion.get(group) ?? true, this.limits.get(group) ?? PAGE_SIZE,
      assets.map(a => [a.id, a.name, a.image, a.width, a.height, a.generation.enabled, a.animation, this.usage.get(a.id)])])]);
    if (signature === this.signature) { this.markActive(); return; }
    this.signature = signature;
    this.root.replaceChildren();
    for (const [group, assets] of groups) {
      const details = document.createElement('details'); details.className = 'asset-group'; details.dataset.group = group;
      details.open = expansion.get(group) ?? true;
      const summary = document.createElement('summary'), name = document.createElement('span'), count = document.createElement('span');
      name.textContent = group; count.textContent = String(assets.length); count.className = 'group-count'; summary.append(name, count);
      if (isAssetVariantGroup(assets, this.assets)) {
        const badge = document.createElement('small'); badge.className = 'asset-group-kind'; badge.textContent = 'Gruppo varianti';
        badge.title = 'Gruppo virtuale di varianti casuali. Non crea una cartella sul disco.'; summary.append(badge);
      }
      details.append(summary);
      details.addEventListener('toggle', () => {
        if (!details.isConnected || details.open === (expansion.get(group) ?? true)) return;
        expansion.set(group, details.open); if (!search) this.save(); this.signature = ''; this.render();
      });
      if (details.open) {
        const items = document.createElement('div'); items.className = 'asset-group-items';
        const limit = this.limits.get(group) ?? PAGE_SIZE;
        for (const asset of assets.slice(0, limit)) {
          const button = document.createElement('button'); button.className = 'asset-item'; button.dataset.asset = asset.id;
          const image = document.createElement('img'); image.loading = 'lazy'; image.decoding = 'async'; image.src = asset.image; image.alt = '';
          const info = document.createElement('div'), name = document.createElement('span'), detail = document.createElement('small');
          name.textContent = asset.name; detail.textContent = `${asset.width} × ${asset.height} · ${asset.generation.enabled ? 'genera + manuale' : 'manuale'}`;
          if (asset.variantOf) detail.textContent = `${asset.width} × ${asset.height} · variante casuale`;
          let thumbnail: HTMLElement = image;
          if (asset.animation) {
            image.loading = 'eager';
            const canvas = document.createElement('canvas'), s = asset.animation;
            canvas.width = 48; canvas.height = 48; canvas.style.cssText = 'width:44px;height:44px;flex-shrink:0';
            image.onload = () => {
              const bounds = worldAssetImageBounds(asset), scale = Math.min(48 / bounds.width, 48 / bounds.height), w = bounds.width * scale, h = bounds.height * scale;
              canvas.getContext('2d')!.drawImage(image,0,0,s.frameWidth,s.frameHeight,(48-w)/2,(48-h)/2,w,h);
            };
            thumbnail = canvas;
          }
          const locations = this.usage.get(asset.id) ?? [], count = locations.filter(location => location.mapId === this.mapId).length;
          const otherMaps = [...new Set(locations.filter(location => location.mapId !== this.mapId).map(location => location.mapName))];
          info.append(name, detail);
          if (this.multiple()) {
            const usage = document.createElement('small'); usage.className = 'asset-usage';
            usage.textContent = count ? `In uso nella mappa attuale · ${count} ${count === 1 ? 'istanza' : 'istanze'}` : '';
            if (otherMaps.length) usage.textContent += `${count ? ' · ' : ''}In uso in altre mappe: ${otherMaps.join(', ')}`;
            if (!locations.length) usage.textContent = 'Nessuna istanza collocata nel progetto';
            usage.dataset.used = String(count > 0);
            if (asset.generation.enabled) usage.textContent += ' · Generazione attiva';
            info.append(usage);
          } else {
            const dot = document.createElement('span'); dot.className = 'asset-usage-dot'; dot.dataset.used = String(count > 0);
            dot.title = count ? 'In uso nella mappa attuale' : otherMaps.length ? `In uso in altre mappe: ${otherMaps.join(', ')}` : 'Nessuna istanza collocata nel progetto';
            dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', dot.title); detail.append(dot);
          }
          button.append(thumbnail, info);
          button.onclick = () => {
            if (this.multiple()) {
              if (this.selected.has(asset.id)) this.selected.delete(asset.id); else this.selected.add(asset.id);
              this.markActive(); this.selectionChanged();
            } else this.select(asset.id);
          };
          if (this.multiple()) {
            const entry = document.createElement('div'); entry.className = 'asset-catalog-entry';
            const locate = document.createElement('button'); locate.className = 'asset-locate'; locate.dataset.locateAsset = asset.id;
            locate.textContent = '⌖ Localizza'; locate.disabled = !locations.length;
            locate.setAttribute('aria-label', `Localizza ${asset.name}`); locate.onclick = () => this.locate(asset.id);
            entry.append(button, locate); items.append(entry);
          } else items.append(button);
        }
        if (assets.length > limit) {
          const more = document.createElement('button'); more.className = 'asset-more'; more.textContent = `Mostra altri · ${assets.length - limit} asset`;
          more.onclick = () => { this.limits.set(group, limit + PAGE_SIZE); this.render(); }; items.append(more);
        }
        details.append(items);
      }
      this.root.append(details);
    }
    if (!groups.size) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = search ? 'Nessun asset trovato.' : 'Importa un’immagine per iniziare.'; this.root.append(empty); }
    this.markActive();
  }
  private markActive(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-asset]').forEach(button => button.setAttribute('aria-pressed', String(this.multiple() ? this.selected.has(button.dataset.asset!) : button.dataset.asset === this.active)));
  }
}
