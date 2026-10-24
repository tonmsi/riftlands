import { worldAssetVisual, type WorldAsset } from '../../../shared/world-schema';
import { WorldAssetCatalog } from './world-asset-catalog';

/** Pick an existing file without changing the asset being edited or its group. */
export function installWorldImagePicker(root: HTMLElement, assets: () => readonly WorldAsset[], replace: (targetId: string, image: string) => Promise<void>): (target: WorldAsset) => void {
    const dialog = document.createElement('dialog'); dialog.id = 'asset-image-picker';
    dialog.innerHTML = `<div class="asset-dialog-header"><h2>Sostituisci immagine interna</h2><button type="button" id="asset-image-picker-close" aria-label="Chiudi scelta immagine">×</button></div>
        <p id="asset-image-picker-target" class="hint"></p>
        <label>Cerca nel catalogo<input id="asset-image-picker-search" type="search" placeholder="Nome o gruppo dell’immagine"></label>
        <div id="asset-image-picker-list" class="asset-list"></div>
        <div id="asset-image-picker-preview" class="selection-card" hidden><img alt="Immagine scelta"><span></span></div>
        <p id="asset-image-picker-status" class="hint" role="status"></p>
        <div class="property-actions"><button type="button" id="asset-image-picker-cancel">Annulla</button><button type="button" id="asset-image-picker-use" disabled>Usa immagine</button></div>`;
    root.append(dialog);
    const get = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#${id}`)!;
    const search = get<HTMLInputElement>('asset-image-picker-search'), use = get<HTMLButtonElement>('asset-image-picker-use');
    const preview = get<HTMLDivElement>('asset-image-picker-preview'), status = get<HTMLParagraphElement>('asset-image-picker-status');
    let targetId = '', sourceId = '', busy = false;
    const catalog = new WorldAssetCatalog(get('asset-image-picker-list'), id => {
        const source = assets().find(a => a.id === id); if (!source || busy) return;
        sourceId = id; preview.hidden = false;
        preview.querySelector('img')!.src = source.image;
        preview.querySelector('span')!.textContent = source.name;
        use.disabled = false; status.textContent = ''; render();
    });
    function render(): void {
        catalog.update(assets().filter(a => worldAssetVisual(a).kind === 'image'), sourceId, search.value);
    }
    function close(): void { if (!busy) dialog.close(); }
    get('asset-image-picker-close').onclick = close;
    get('asset-image-picker-cancel').onclick = close;
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    search.addEventListener('input', render);
    use.onclick = () => { void (async () => {
        const source = assets().find(a => a.id === sourceId); if (!source || busy) return;
        busy = true; use.disabled = true; status.textContent = 'Sostituzione immagine…';
        try { await replace(targetId, source.image); dialog.close(); }
        catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
        finally { busy = false; use.disabled = !sourceId; }
    })(); };
    return target => {
        targetId = target.id; sourceId = ''; search.value = ''; preview.hidden = true; use.disabled = true; status.textContent = '';
        get('asset-image-picker-target').textContent = `Scegli l’immagine per «${target.name}». Cambia solo l’immagine di questo asset: dimensioni, collisioni e gruppo restano invariati.`;
        render(); dialog.showModal(); search.focus();
    };
}
