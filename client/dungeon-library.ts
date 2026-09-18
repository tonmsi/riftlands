import { parseDungeonDraft, type DungeonDraft } from '../shared/dungeon-draft';

export async function setupDungeonLibrary(getDraft: () => DungeonDraft, open: (draft: DungeonDraft) => void, status: (message: string) => void): Promise<void> {
    const panel = document.querySelector<HTMLElement>('#dungeon-library')!;
    try {
        const response = await fetch('/__studio/library');
        if (!response.ok) return;
        const library = await response.json() as { token: string; dungeons: { id: string; name: string; draft?: DungeonDraft }[];
            backups: { scope: string; label: string; count: number; bytes: number; files: string[] }[] };
        if (!library.token || !Array.isArray(library.dungeons)) return;
        panel.hidden = false;
        const buttons = () => document.querySelectorAll<HTMLButtonElement>('#dungeon-library button, #dungeon-backups button');
        const backupPanel = document.querySelector<HTMLElement>('#dungeon-backups')!;
        backupPanel.hidden = false;
        const backupSelect = backupPanel.querySelector<HTMLSelectElement>('#backup-scope')!;
        const backupGroups = library.backups ?? [];
        const all = {scope:'all',label:'Tutti i backup',count:backupGroups.reduce((n,g)=>n+g.count,0),bytes:backupGroups.reduce((n,g)=>n+g.bytes,0),files:backupGroups.flatMap(g=>g.files)};
        for (const group of [...backupGroups,all]) backupSelect.add(new Option(`${group.label} · ${group.count} file`,group.scope));
        const selectedBackups = () => backupGroups.find(g=>g.scope===backupSelect.value) ?? all;
        const deleteBackups = backupPanel.querySelector<HTMLButtonElement>('#delete-backups')!;
        const refreshBackups = () => {
            const group=selectedBackups();
            deleteBackups.disabled=!group.count;
            backupPanel.querySelector('#backup-summary')!.textContent=`${group.count} file · ${(group.bytes/1024).toFixed(1)} KB. Cancellazione definitiva delle copie selezionate.`;
            backupPanel.querySelector('#backup-files')!.replaceChildren(...group.files.map(path=>{const li=document.createElement('li');li.textContent=path;return li;}));
        };
        backupSelect.onchange=refreshBackups; refreshBackups();
        deleteBackups.onclick=async()=>{
            const group=selectedBackups();
            if (!group.count || !confirm(`Eliminare definitivamente ${group.count} file di backup (${group.label})? Sono copie complete di catalogo e salvataggio. I file attuali restano invariati.`)) return;
            for(const b of buttons()) b.disabled=true;
            try {
                const response=await fetch('/__studio/library',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':library.token},body:JSON.stringify({action:'remove-backups',scope:group.scope})});
                const result=await response.json();
                if (!response.ok) throw new Error(result.error ?? 'Eliminazione backup fallita.');
                sessionStorage.setItem('riftlands.studio-result',`Eliminati ${result.deletedFiles} file di backup. Catalogo e account attuali invariati.`);
                location.reload();
            } catch(error) {status(error instanceof Error ? error.message : String(error));}
            finally {for(const b of buttons()) b.disabled=false;refreshBackups();}
        };
        const select = panel.querySelector<HTMLSelectElement>('select')!;
        for (const dungeon of library.dungeons) select.add(new Option(`${dungeon.name} · ${dungeon.id}`, dungeon.id));
        const selected = () => library.dungeons.find(d => d.id === select.value);
        panel.querySelector<HTMLButtonElement>('[data-library="open"]')!.onclick = () => {
            const draft = selected()?.draft;
            if (!draft) { status('Nessuna bozza nel catalogo: importa il file originale.'); return; }
            open(parseDungeonDraft(JSON.stringify(draft)));
        };
        for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-action]')) button.onclick = async () => {
            const action = button.dataset.action!, draft = getDraft(), id = action === 'remove' ? select.value : draft.id;
            if (!id) return;
            if (action !== 'install' && !confirm(`${action === 'remove' ? 'Eliminare' : 'Aggiornare'} il dungeon ${id}? Gli stati dei suoi boss e il loot non raccolto verranno azzerati. Gli account restano invariati; vengono creati backup.`)) return;
            for (const b of buttons()) b.disabled = true;
            try {
                const response = await fetch('/__studio/library', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': library.token }, body: JSON.stringify({ action, id, draft }) });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error ?? 'Operazione fallita.');
                const message = `Dungeon ${action === 'remove' ? 'eliminato' : action === 'update' ? 'aggiornato' : 'installato'}. Ricompila il gioco prima di avviarlo. Backup: ${result.backups.join(', ')}`;
                sessionStorage.setItem('riftlands.studio-result', message);
                location.reload();
            } catch (error) { status(error instanceof Error ? error.message : String(error)); }
            finally { for (const b of buttons()) b.disabled = false; refreshBackups(); }
        };
        const message = sessionStorage.getItem('riftlands.studio-result');
        if (message) { status(message); sessionStorage.removeItem('riftlands.studio-result'); }
    } catch { /* Ordinary game hosting has no developer management API. */ }
}
