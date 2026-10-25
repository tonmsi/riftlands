type Value = { value: string; checked: boolean };
/** Keep incomplete forms through canvas refreshes and unrelated immediate edits. */
export class WorldInspectorDrafts {
  private drafts = new Map<string, Map<string, Value>>();
  constructor(private root: HTMLElement, private context: (section: string) => string, private sections=['asset-inspector','selection-inspector','zone-inspector']) {
    const remember = (event: Event) => {
      const field = event.target;
      if (field instanceof HTMLInputElement && field.type === 'file') return;
      if (field instanceof HTMLInputElement && field.id === 'asset-random-variants') return;
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement) || !field.id) return;
      if (['asset-cell-subdivision','cell-floor','cell-floor-custom','cell-blocked','cell-visibility','preview-fade','edit-asset-image','keep-ratio'].includes(field.id)) return;
      if (['warp-entry-size','warp-arrival-size','warp-entry-elevation','warp-arrival-elevation','warp-one-way','warp-to','warp-from'].includes(field.id)) return;
      const section = field.closest<HTMLElement>('.inspector > section');
      if (!section || !this.sections.includes(section.id)) return;
      const key = this.context(section.id), fields = this.drafts.get(key) ?? new Map();
      fields.set(field.id, { value: field.value, checked: (field as HTMLInputElement).checked }); this.drafts.set(key, fields);
      this.mark(section,fields);
    };
    root.addEventListener('input', remember); root.addEventListener('change', remember);
  }
  accept(section: string, ids?: string[]) {
    const key = this.context(section);
    if (!ids) this.drafts.delete(key); else for (const id of ids) this.drafts.get(key)?.delete(id);
  }
  clear() { this.drafts.clear(); }
  private mark(section: HTMLElement, fields?: Map<string, Value>) {
    let note = section.querySelector<HTMLElement>(':scope > .inspector-pending');
    if (!note) { note=document.createElement('p');note.className='inspector-pending';note.textContent='Campi modificati · premi Aggiorna per confermare';section.querySelector('h2')?.after(note); }
    note.hidden = !fields?.size;
    for (const field of section.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[id],select[id]')) field.classList.toggle('field-pending',!!fields?.has(field.id));
  }
  restore() {
    for (const section of this.root.querySelectorAll<HTMLElement>('.inspector > section')) {
      if(!this.sections.includes(section.id))continue;
      const fields=this.drafts.get(this.context(section.id));
      this.mark(section,fields);
      for (const [id, state] of fields ?? []) {
        const field = section.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`);
        if (!field) continue;
        field.value = state.value;
        if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = state.checked;
      }
    }
  }
}
