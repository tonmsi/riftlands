export type WorldBuildMode = 'floor' | 'object' | 'elevation';

/** Change the visible controls only; tool selection and catalog filtering belong to the maker. */
export function setWorldBuildMode(root: HTMLElement, mode: WorldBuildMode): void {
  const build = root.querySelector<HTMLDetailsElement>('#build-controls')!;
  build.dataset.buildMode = mode; build.open = true;
  for (const [category, id] of [['floor', 'floor-controls'], ['object', 'object-controls'], ['elevation', 'elevation-controls']] as const)
    root.querySelector<HTMLElement>(`#${id}`)!.hidden = category !== mode;
  if (mode === 'elevation') root.querySelector<HTMLDetailsElement>('#elevation-controls')!.open = true;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-build-mode]')) {
    if (button.tagName !== 'BUTTON') continue;
    const selected = button.dataset.buildMode === mode;
    button.setAttribute('aria-pressed', String(selected)); button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
  }
  root.querySelector('#build-mode-hint')!.textContent = {
    floor: 'Una superficie piatta su cui camminare.',
    object: 'Pietre, cespugli e decorazioni appoggiati al terreno.',
    elevation: 'Terreno più alto, con una superficie e pareti ai lati.',
  }[mode];
}

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
  const populationTools = document.createElement('div'); populationTools.className = 'tool-grid';
  for (const id of ['npc', 'spawn']) {
    populationTools.append(root.querySelector(`[data-tool="${id}"]`)!);
  }
  const group = (id: string, title: string, hint: string) => {
    const section = document.createElement('section'); section.id = id; section.className = 'construction-group';
    const heading = document.createElement('h2'); heading.textContent = title;
    const explanation = document.createElement('p'); explanation.className = 'hint'; explanation.textContent = hint;
    section.append(heading, explanation); return section;
  };
  const choices = document.createElement('div'); choices.className = 'build-mode-tabs'; choices.setAttribute('role', 'tablist'); choices.setAttribute('aria-label', 'Che cosa vuoi costruire?');
  for (const [mode, label, controls] of [['floor', 'Pavimenti', 'floor-controls'], ['object', 'Oggetti', 'object-controls'], ['elevation', 'Rialzi', 'elevation-controls']]) {
    const button = document.createElement('button'); button.type = 'button'; button.id = `build-mode-${mode}`; button.dataset.buildMode = mode; button.textContent = label;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', controls); choices.append(button);
  }
  choices.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...choices.querySelectorAll<HTMLButtonElement>('button')], current = buttons.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next].focus(); buttons[next].click();
  });
  const modeHint = document.createElement('p'); modeHint.id = 'build-mode-hint'; modeHint.className = 'hint build-mode-hint';
  const floors = group('floor-controls', 'Dipingi un pavimento', 'Il pavimento di pietra è piatto e calpestabile. Per un sasso scegli Oggetti.');
  const objects = group('object-controls', 'Posiziona un oggetto', 'Clicca dove vuoi appoggiarlo, anche sopra un rialzo.');
  const toolGrid = (ids: string[]) => {
    const grid = document.createElement('div'); grid.className = 'tool-grid';
    for (const id of ids) grid.append(root.querySelector(`[data-tool="${id}"]`)!);
    return grid;
  };
  const fields = document.createElement('div'); fields.className = 'fields';
  fields.append(root.querySelector('#terrain')!.closest('label')!);
  floors.append(toolGrid(['terrain', 'restore']), fields);
  const objectPresets = document.createElement('div'); objectPresets.className = 'tool-grid terrain-object-presets';
  for (const [terrain, label] of [['rock', 'Pietra / sasso'], ['bush', 'Cespuglio']]) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.terrainObject = terrain;
    button.textContent = label; objectPresets.append(button);
  }
  objects.append(objectPresets);
  const elevation = tools.querySelector<HTMLDetailsElement>('#elevation-controls')!;
  elevation.querySelector('summary')!.textContent = 'Forma un rialzo';
  const elevationAdvanced = elevation.querySelector<HTMLDetailsElement>('.fields > details')!;
  elevationAdvanced.id = 'elevation-advanced-controls'; elevationAdvanced.open = false;
  elevationAdvanced.querySelector('summary')!.textContent = 'Quota precisa e aspetto delle pareti';
  elevationAdvanced.append(toolGrid(['height', 'clear-height']));
  for (const id of ['surface-wall', 'surface-wall-skin']) elevationAdvanced.append(root.querySelector(`#${id}`)!.closest('label')!);
  elevationAdvanced.append(root.querySelector('#surface-wall-kit-info')!, root.querySelector('#surface-lab')!);
  const structures = document.createElement('details'); structures.id = 'structure-controls'; structures.open = false;
  const structuresTitle = document.createElement('summary'); structuresTitle.textContent = 'Opzioni scale e ponti';
  const structuresFields = document.createElement('div'); structuresFields.className = 'fields';
  for (const id of ['surface-stair-width', 'surface-stair-profile', 'surface-stair-underpass', 'surface-bridge-width', 'surface-bridge-route', 'surface-bridge-extend', 'surface-show-under']) {
    const control = root.querySelector(`#${id}`); if (control) structuresFields.append(control.closest('label')!);
  }
  const profileInfo = root.querySelector('#surface-stair-profile-info'); if (profileInfo) structuresFields.append(profileInfo);
  structures.append(structuresTitle, structuresFields, toolGrid(['clear-link', 'clear-bridge']));
  const objectPlane = document.createElement('details'); objectPlane.id = 'object-plane-controls';
  const planeTitle = document.createElement('summary'); planeTitle.textContent = 'Piano di appoggio';
  const objectFields = document.createElement('div'); objectFields.className = 'fields';
  objectFields.append(root.querySelector('#placement-surface')!.closest('label')!, root.querySelector('#surface-plane-hint')!);
  objectPlane.append(planeTitle, objectFields);
  const connections = document.createElement('h3'); connections.textContent = 'Collega due piani';
  const accessFields = document.createElement('div'); accessFields.className = 'fields'; accessFields.append(root.querySelector('#surface-link-kind')!.closest('label')!);
  objects.append(objectPlane, connections, toolGrid(['surface-link', 'bridge']), accessFields, root.querySelector('#surface-link-cancel')!, root.querySelector('#surface-link-hint')!, structures);
  const brush = document.createElement('details'); brush.id = 'brush-controls';
  const brushTitle = document.createElement('summary'); brushTitle.textContent = 'Pennello · raggio e densità';
  const brushFields = document.createElement('div'); brushFields.className = 'fields';
  brushFields.append(root.querySelector('#brush-radius')!.closest('.pair')!, root.querySelector('#mass')!.closest('label')!);
  brush.append(brushTitle, brushFields);
  const gestures = document.createElement('details'); gestures.id = 'maker-gesture-help';
  const gestureTitle = document.createElement('summary'); gestureTitle.textContent = 'Come usare la mappa'; gestures.append(gestureTitle, tools.querySelector('.hint')!);
  build.append(choices, modeHint, floors, objects, elevation, brush);
  const catalog = original[1]; catalog.id = 'asset-catalog-controls'; catalog.querySelector('h2')!.textContent = 'PNG della categoria';
  catalog.querySelector('h2')!.after(toolGrid(['asset'])); build.append(catalog, gestures);
  const contents = original[2]; contents.querySelector('h2')!.remove();
  const zoneLabel = contents.querySelector('#zone-template')!.closest('label')!;
  const zones = group('zone-controls', 'Zone e generazione', 'Definisci clima e regole locali.');
  zones.append(toolGrid(['zone']), zoneLabel, contents.querySelector('.hint')!);
  populate.append(populationTools, ...contents.childNodes, zones);
  const dungeon = original[3]; dungeon.querySelector('h2')!.remove();
  const dungeonTools = document.createElement('div'); dungeonTools.className = 'tool-grid';
  dungeonTools.append(root.querySelector('[data-tool="dungeon"]')!);
  dungeon.querySelector('.dungeon-control-group + .dungeon-control-group')!.remove();
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
  floors.setAttribute('aria-label', 'Pavimenti'); objects.setAttribute('aria-label', 'Oggetti e strutture');
  for (const [mode, controls] of [['floor', floors], ['object', objects], ['elevation', elevation]] as const) {
    controls.setAttribute('role', 'tabpanel'); controls.setAttribute('aria-labelledby', `build-mode-${mode}`);
  }
  setWorldBuildMode(root, 'floor');
}
