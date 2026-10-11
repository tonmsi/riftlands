/** Group existing controls without changing their IDs or event bindings. */
export function organizeWorldPanels(root: HTMLElement): void {
  const aside = root.querySelector('.world-palette')!;
  const original = [...aside.children];
  const panel = (id: string, title: string) => {
    const details = document.createElement('details');
    details.id = id; details.className = 'world-panel'; details.open = true;
    const summary = document.createElement('summary'); summary.textContent = title;
    details.append(summary); return details;
  };
  const maps = panel('map-controls-panel', '01 · Mappe');
  const build = panel('build-controls', '02 · Costruisci');
  const populate = panel('population-controls', '03 · Popola');
  const areas = panel('areas-controls-panel', '04 · Dungeon e interni');
  const tools = original[0]; tools.querySelector('h2')!.remove();
  const grid = tools.querySelector('.tool-grid')!;
  const populationTools = document.createElement('div'); populationTools.className = 'tool-grid';
  for (const id of ['npc', 'spawn']) {
    populationTools.append(root.querySelector(`[data-tool="${id}"]`)!);
  }
  build.append(...tools.childNodes);
  const catalog = original[1]; catalog.querySelector('h2')!.textContent = 'Asset e decorazioni'; build.append(catalog);
  const contents = original[2]; contents.querySelector('h2')!.remove();
  const zoneLabel = contents.querySelector('#zone-template')!.closest('label')!;
  build.append(zoneLabel, contents.querySelector('.hint')!);
  populate.append(populationTools, ...contents.childNodes);
  const dungeon = original[3]; dungeon.querySelector('h2')!.remove();
  dungeon.querySelector('.dungeon-control-group + .dungeon-control-group')!.remove();
  const dungeonTools = document.createElement('div'); dungeonTools.className = 'tool-grid';
  dungeonTools.append(root.querySelector('[data-tool="dungeon"]')!);
  const resources = document.createElement('details'); resources.id = 'dungeon-resources';
  const resourcesTitle = document.createElement('summary'); resourcesTitle.textContent = 'Dungeon Maker e boss';
  resources.append(resourcesTitle, dungeonTools, dungeon); areas.append(resources);
  const project = root.querySelector('#world-properties')!;
  project.querySelector('h2')!.remove();
  const settings = document.createElement('details'); settings.id = 'project-settings';
  const settingsTitle = document.createElement('summary'); settingsTitle.textContent = 'Progetto e verifica';
  settings.append(settingsTitle, project); maps.append(settings);
  aside.replaceChildren(maps, build, populate, areas);
  const navigation = document.createElement('nav'); navigation.className = 'palette-navigation';
  navigation.setAttribute('aria-label', 'Sezioni del maker');
  for (const section of [maps, build, populate, areas]) {
    const button = document.createElement('button');
    button.textContent = section.querySelector('summary')!.textContent!.split(' · ')[1];
    button.onclick = () => { section.open = true; section.scrollIntoView({ block: 'start' }); };
    navigation.append(button);
  }
  aside.prepend(navigation);
  grid.setAttribute('aria-label', 'Strumenti di costruzione');
}
