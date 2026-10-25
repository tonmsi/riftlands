import { climateCurveWeight, climateBandState } from '../../../shared/world-authoring';
import type { WorldZone, ClimateBand } from '../../../shared/world-schema';

/** Curve controls only edit the zone form; Aggiorna zona commits them with the other rules. */
export function installZoneClimateControls(root: HTMLElement) {
    const get = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
    const toggle = get<HTMLInputElement>('zone-climate-transition');
    const depth = get<HTMLInputElement>('zone-climate-depth');
    const label = toggle.closest('label')!;
    const heading = document.createElement('div'); heading.className = 'climate-transition-heading';
    label.before(heading); heading.append(label);
    const gear = document.createElement('button'); gear.id = 'zone-climate-settings-toggle'; gear.type = 'button';
    gear.textContent = '⚙'; gear.title = 'Regola le curve di temperatura e umidità';
    gear.setAttribute('aria-label', gear.title); gear.setAttribute('aria-expanded', 'false'); gear.setAttribute('aria-controls', 'zone-climate-settings');
    heading.append(gear);
    get('zone-climate-depth-label').insertAdjacentHTML('afterend', `<div id="zone-climate-settings" class="climate-curve-settings" hidden>
      <h3>Curve del clima</h3>
      <p>Regola separatamente quanto presto temperatura e umidità raggiungono il valore della zona. La profondità sopra stabilisce dove termina la transizione.</p>
      ${(['temperature', 'moisture'] as const).map(key => `<section class="climate-band-section"><h4>${key === 'temperature' ? 'Temperatura' : 'Umidità'}</h4><div id="zone-climate-simple-${key}"><label for="zone-climate-curve-${key}">Curva unica <output id="zone-climate-curve-${key}-value" for="zone-climate-curve-${key}"></output></label><input id="zone-climate-curve-${key}" aria-label="Curva ${key === 'temperature' ? 'temperatura' : 'umidità'}" type="range" min="0.25" max="12" step="0.25" value="3"><div class="climate-curve-scale"><span>Cambia più all’interno</span><span>Cambia più al bordo</span></div></div>
      <input id="zone-climate-band-count-${key}" type="hidden" value="0">
      ${[0, 1, 2].map(i => `<div id="zone-climate-band-row-${key}-${i}" class="climate-band-row" hidden><strong>Banda ${i + 1}</strong><div class="pair"><label>Posizione %<input id="zone-climate-band-${key}-${i}-at" type="number" min="0.1" max="100" step="0.1" value="100"></label><label>Valore da raggiungere<input id="zone-climate-band-${key}-${i}-value" type="number" min="0" max="1" step="0.01" value="0.5"></label></div><label>Curva di questo tratto<select id="zone-climate-band-${key}-${i}-curve"><option value="1">Lineare</option><option value="3">Rapida all’inizio</option><option value="6">Molto rapida all’inizio</option><option value="0.5">Lenta all’inizio</option></select></label><button id="zone-climate-band-remove-${key}-${i}" type="button">Elimina banda ${i + 1}</button></div>`).join('')}
      <button id="zone-climate-band-add-${key}" type="button">+ Aggiungi banda</button></section>`).join('')}
      <p>Massimo 3 bande per parametro. La posizione è una percentuale della profondità di sfumatura. L’ultima banda termina al 100% e determina il valore interno della zona. Due valori uguali creano un tratto costante.</p>
      <div id="zone-climate-band-preview-start" hidden><p>Clima al bordo simulato, solo per il grafico. Nel mondo viene usato il clima circostante effettivo.</p><div class="pair"><label>Temperatura al bordo<input id="zone-climate-preview-temperature" type="number" min="0" max="1" step="0.01" value="1"></label><label>Umidità al bordo<input id="zone-climate-preview-moisture" type="number" min="0" max="1" step="0.01" value="0.5"></label></div></div>
      <svg id="zone-climate-curve-preview" viewBox="0 0 300 160" role="img" aria-label="Avvicinamento al clima della zona dal bordo verso l’interno"></svg>
      <p class="climate-curve-legend"><span>● Temperatura</span><span>● Umidità</span></p>
      <p id="zone-climate-curve-explanation">Variazione completata: 0% = clima circostante; 100% = valore impostato nella zona.</p>
      <table class="climate-curve-table"><thead><tr><th>Distanza interna</th><th>Temp.</th><th>Umidità</th></tr></thead><tbody id="zone-climate-curve-samples"></tbody></table>
      <button id="zone-climate-curves-reset" type="button">Ripristina curve</button>
      <p>Le modifiche si salvano con “Aggiorna zona”.</p>
    </div>`);
    const panel = get('zone-climate-settings');
    const controls = { temperature: get<HTMLInputElement>('zone-climate-curve-temperature'), moisture: get<HTMLInputElement>('zone-climate-curve-moisture') };
    type Key = keyof typeof controls;
    const strength = (key: keyof typeof controls) => Number(controls[key].value);
    const count = (key: Key) => Number(get<HTMLInputElement>(`zone-climate-band-count-${key}`).value);
    const bandField = (key: Key, i: number, name: string) => get<HTMLInputElement | HTMLSelectElement>(`zone-climate-band-${key}-${i}-${name}`);
    function readBands(key: Key): ClimateBand[] | undefined {
        const n = count(key); if (!n) return;
        if (!Number.isInteger(n) || n < 0 || n > 3) throw new Error('Massimo 3 bande per parametro.');
        const bands: ClimateBand[] = []; let previous = 0;
        for (let i = 0; i < n; i++) {
            const at = Number(bandField(key, i, 'at').value) / 100;
            const value = Number(bandField(key, i, 'value').value), curve = Number(bandField(key, i, 'curve').value);
            if (['at', 'value', 'curve'].some(name => bandField(key, i, name).value.trim() === '')
                || !Number.isFinite(at) || at <= previous || at > 1 || at < .001
                || !Number.isFinite(value) || value < 0 || value > 1 || !Number.isFinite(curve) || curve < .25 || curve > 12)
                throw new Error('Bande clima: valori da 0 a 1 e posizioni crescenti da 0,1% a 100%.');
            bands.push({ at, value, curve }); previous = at;
        }
        if (previous !== 1) throw new Error('L’ultima banda deve terminare al 100%.');
        return bands;
    }
    function setBand(key: Key, i: number, band: ClimateBand) {
        bandField(key, i, 'at').value = String(band.at * 100);
        bandField(key, i, 'value').value = String(band.value);
        const select = bandField(key, i, 'curve') as HTMLSelectElement, curve = String(band.curve ?? 1);
        if (![...select.options].some(o => o.value === curve)) select.add(new Option(`Personalizzata (${curve})`, curve));
        select.value = curve;
    }
    function rememberBands(key: Key) {
        for (const field of [get<HTMLInputElement>(`zone-climate-band-count-${key}`), ...[0, 1, 2].flatMap(i => ['at', 'value', 'curve'].map(name => bandField(key, i, name)))])
            field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function refresh() {
        gear.disabled = !toggle.checked;
        if (!toggle.checked) { panel.hidden = true; gear.setAttribute('aria-expanded', 'false'); }
        const fraction = Math.max(.01, Math.min(1, Number(depth.value) / 100 || 1));
        const absolute = count('temperature') > 0 || count('moisture') > 0;
        get('zone-climate-band-preview-start').hidden = !absolute;
        get('zone-climate-curve-explanation').textContent = absolute ? 'Valori decimali reali lungo la distanza interna, con il bordo simulato indicato sopra.' : 'Variazione completata: 0% = clima circostante; 100% = valore impostato nella zona.';
        const configured: Partial<Record<Key, ClimateBand[]>> = {};
        for (const key of ['temperature', 'moisture'] as const) {
            get(`zone-climate-simple-${key}`).hidden = count(key) > 0;
            get<HTMLButtonElement>(`zone-climate-band-add-${key}`).disabled = count(key) >= 3;
            for (let i = 0; i < 3; i++) {
                get(`zone-climate-band-row-${key}-${i}`).hidden = i >= count(key);
                (bandField(key, i, 'at') as HTMLInputElement).readOnly = i === count(key) - 1;
            }
            try { configured[key] = readBands(key); } catch { /* Allow incomplete numbers while typing. */ }
            const n = strength(key);
            get<HTMLOutputElement>(`zone-climate-curve-${key}-value`).value = `${n.toLocaleString('it-IT')} · ${n === 1 ? 'uniforme' : n > 1 ? 'rapida al bordo' : 'rapida all’interno'}`;
        }
        const weight = (key: Key, t: number) => {
            const influence = climateCurveWeight(t / fraction, strength(key));
            if (!absolute) return influence;
            const start = Math.max(0, Math.min(1, Number(get<HTMLInputElement>(`zone-climate-preview-${key}`).value) || 0));
            const bands = configured[key];
            if (bands) { const state = climateBandState(t / fraction, bands); return start * (1 - state.weight) + state.value * state.weight; }
            const target = get<HTMLInputElement>(key === 'temperature' ? 'zone-temperature' : 'zone-moisture').value;
            return start + ((target === '' ? start : Number(target)) - start) * influence;
        };
        const path = (key: keyof typeof controls) => Array.from({ length: 65 }, (_, i) => `${i ? 'L' : 'M'}${30 + 250 * i / 64},${120 - 110 * weight(key, i / 64)}`).join(' ');
        get('zone-climate-curve-preview').innerHTML = `<path d="M30 10V120H280 M30 65H280" fill="none" stroke="#819481" stroke-opacity=".4"/><text x="0" y="15">${absolute ? '1' : '100%'}</text><text x="9" y="123">${absolute ? '0' : '0%'}</text><text x="30" y="145">Bordo</text><text x="240" y="145">Interno</text><path d="${path('temperature')}" fill="none" stroke="#edb678" stroke-width="2.5"/><path d="${path('moisture')}" fill="none" stroke="#7acbdf" stroke-width="2.5" stroke-dasharray="5 3"/>`;
        const format = (value: number) => absolute ? value.toFixed(3) : `${(value * 100).toFixed(1)}%`;
        get('zone-climate-curve-samples').innerHTML = [0, .25, .5, .75, 1].map(t => `<tr><th>${t * 100}%</th><td>${format(weight('temperature', t))}</td><td>${format(weight('moisture', t))}</td></tr>`).join('');
    }
    gear.onclick = () => { panel.hidden = !panel.hidden; gear.setAttribute('aria-expanded', String(!panel.hidden)); refresh(); };
    for (const control of [...Object.values(controls), depth, toggle]) control.addEventListener('input', refresh);
    for (const key of ['temperature', 'moisture'] as const) {
        for (const field of [get<HTMLInputElement>(`zone-climate-preview-${key}`), get<HTMLInputElement>(key === 'temperature' ? 'zone-temperature' : 'zone-moisture'), get<HTMLInputElement>(`zone-climate-band-count-${key}`), ...[0, 1, 2].flatMap(i => ['at', 'value', 'curve'].map(name => bandField(key, i, name)))]) field.addEventListener('input', refresh);
        get(`zone-climate-band-add-${key}`).onclick = () => {
            const n = count(key); if (n >= 3) return;
            if (!n) {
                const value = get<HTMLInputElement>(key === 'temperature' ? 'zone-temperature' : 'zone-moisture').value;
                setBand(key, 0, { at: 1, value: value === '' ? .5 : Number(value), curve: 1 });
            } else {
                const last = { at: 1, value: Number(bandField(key, n - 1, 'value').value) || 0, curve: Number(bandField(key, n - 1, 'curve').value) || 1 };
                const previous = n > 1 ? Number(bandField(key, n - 2, 'at').value) / 100 : 0;
                setBand(key, n - 1, { ...last, at: (previous + 1) / 2 });
                setBand(key, n, last);
            }
            get<HTMLInputElement>(`zone-climate-band-count-${key}`).value = String(n + 1); rememberBands(key); refresh();
        };
        for (let i = 0; i < 3; i++) get(`zone-climate-band-remove-${key}-${i}`).onclick = () => {
            const n = count(key);
            for (let row = i; row < n - 1; row++) for (const name of ['at', 'value', 'curve']) bandField(key, row, name).value = bandField(key, row + 1, name).value;
            if (n > 1) bandField(key, n - 2, 'at').value = '100';
            get<HTMLInputElement>(`zone-climate-band-count-${key}`).value = String(n - 1); rememberBands(key); refresh();
        };
    }
    get('zone-climate-curves-reset').onclick = () => {
        for (const control of Object.values(controls)) { control.value = '3'; control.dispatchEvent(new Event('input', { bubbles: true })); }
        for (const key of ['temperature', 'moisture'] as const) { get<HTMLInputElement>(`zone-climate-band-count-${key}`).value = '0'; rememberBands(key); }
    };
    return {
        refresh,
        fill(zone: WorldZone) { for (const key of ['temperature', 'moisture'] as const) {
            controls[key].value = String(zone.climateCurves?.[key] ?? 3);
            const bands = zone.climateBands?.[key] ?? [];
            get<HTMLInputElement>(`zone-climate-band-count-${key}`).value = String(bands.length);
            for (let i = 0; i < 3; i++) setBand(key, i, bands[i] ?? { at: 1, value: zone[key] ?? .5, curve: 1 });
        } },
        read(zone: WorldZone) {
            const curves: NonNullable<WorldZone['climateCurves']> = {};
            for (const key of ['temperature', 'moisture'] as const) {
                const n = strength(key);
                if (!Number.isFinite(n) || n < .25 || n > 12) throw new Error('Intensità curve clima: da 0,25 a 12.');
                if (n !== 3) curves[key] = n;
            }
            if (Object.keys(curves).length) zone.climateCurves = curves; else delete zone.climateCurves;
            const bands: NonNullable<WorldZone['climateBands']> = {};
            for (const key of ['temperature', 'moisture'] as const) {
                const values = readBands(key);
                if (values) { bands[key] = values; zone[key] = values[values.length - 1].value; }
            }
            if (Object.keys(bands).length) zone.climateBands = bands; else delete zone.climateBands;
        },
    };
}
