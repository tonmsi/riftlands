/** Native disclosure controls keep the existing field IDs, listeners and visibility rules. */
export function installDungeonPanels(root: HTMLElement): void {
  const palette = root.querySelector<HTMLElement>('.palette')!;
  const toolbar = root.querySelector('.canvas-toolbar > div')!;
  for (const tool of ['select', 'erase']) toolbar.append(palette.querySelector(`[data-tool="${tool}"]`)!);
  toolbar.querySelector('[data-tool="erase"]')!.textContent = '⌫ Cancella';
  for (const aside of root.querySelectorAll<HTMLElement>('.palette, .inspector')) {
    const panels: HTMLDetailsElement[] = [];
    const makePanel = (heading: Element) => {
      const panel = document.createElement('details'); panel.open = true; panel.className = 'maker-disclosure';
      const summary = document.createElement('summary'); summary.textContent = heading.textContent?.trim() ?? '';
      panel.append(summary); panels.push(panel); return panel;
    };
    // Catalog, backups and selected-object sections have their own visibility conditions.
    for (const block of [...aside.children]) {
      if (!block.matches('section, #entity-properties')) continue;
      const heading = block.querySelector(':scope > h2, :scope > h3'); if (!heading) continue;
      const panel = makePanel(heading);
      for (const attribute of block.attributes) if (attribute.name !== 'class') panel.setAttribute(attribute.name, attribute.value);
      panel.classList.add(...block.classList); heading.remove(); panel.append(...block.childNodes); block.replaceWith(panel);
    }
    for (const heading of [...aside.children]) {
      if (!heading.matches('h2, h3')) continue;
      const panel = makePanel(heading); heading.before(panel);
      let next = heading.nextElementSibling;
      while (next && !next.matches('h2,h3,details,section')) {
        const after = next.nextElementSibling; panel.append(next); next = after;
      }
      heading.remove();
    }
    const actions = document.createElement('div'); actions.className = 'disclosure-actions';
    for (const [label, open] of [['Apri tutto', true], ['Chiudi tutto', false]] as const) {
      const button = document.createElement('button'); button.textContent = label;
      button.addEventListener('click', () => { for (const panel of aside.querySelectorAll<HTMLDetailsElement>('.maker-disclosure')) panel.open = open; }); actions.append(button);
    }
    aside.prepend(actions);
  }
  const groups = [
    ['Mappe', []],
    ['Costruisci', ['Terreno', 'Asset condivisi']],
    ['Popola', ['NPC', 'Mob', 'Powerup e powerdown']],
    ['Passaggi', []],
    ['Boss', ['Boss disponibili', 'Incontro']],
  ] as const;
  const original = [...palette.querySelectorAll<HTMLDetailsElement>(':scope > details')];
  for (const panel of original) if (panel.querySelector('summary')!.textContent!.replace(/\s+/g, ' ').trim() === '01 Strumenti') panel.remove();
  const navigation = document.createElement('nav'); navigation.className = 'dungeon-navigation';
  for (const [title, names] of groups) {
    const panel = document.createElement('details'); panel.open = true; panel.className = 'maker-disclosure'; panel.id = `dungeon-section-${title.toLowerCase()}`;
    const summary = document.createElement('summary'); summary.textContent = title; panel.append(summary);
    for (const child of original) if ((names as readonly string[]).includes(child.querySelector('summary')!.textContent!.replace(/\s+/g, ' ').trim())) panel.append(child);
    palette.append(panel);
    const button = document.createElement('button'); button.textContent = title;
    button.onclick = () => { panel.open = true; panel.scrollIntoView({ block: 'start' }); }; navigation.append(button);
  }
  root.querySelector('#dungeon-section-mappe')!.append(root.querySelector('.new-map')!);
  const mapLabel = root.querySelector('.new-map > label')!;
  const dimensions = document.createElement('div'); dimensions.className = 'new-map-dimensions';
  const separator = document.createElement('span'); separator.textContent = '×';
  const width = root.querySelector<HTMLInputElement>('#width')!, height = root.querySelector<HTMLInputElement>('#height')!;
  width.setAttribute('aria-label', 'Larghezza nuova mappa'); height.setAttribute('aria-label', 'Altezza nuova mappa');
  dimensions.append(width, separator, height);
  mapLabel.replaceChildren(document.createTextNode('Nuova mappa'), dimensions);
  root.querySelector('#dungeon-section-mappe')!.append(root.querySelector('#dungeon-library')!);
  palette.prepend(navigation);
}
