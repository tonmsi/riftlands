import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDungeonDraft } from '../shared/dungeon-draft';
import { buildDungeonBundle, type DungeonBundle } from '../shared/dungeon-install';

const source = process.argv[2];
if (!source || process.argv.length !== 3) throw new Error('Uso: npm run dungeon:import -- percorso/dungeon.draft.json');
const path = fileURLToPath(new URL('../shared/custom-dungeons.json', import.meta.url));
const draft = parseDungeonDraft(readFileSync(source, 'utf8'));
const bundle = buildDungeonBundle(draft);
const catalog = JSON.parse(readFileSync(path, 'utf8')) as DungeonBundle[];
const temporary = `${path}.tmp`;
writeFileSync(temporary, JSON.stringify([...catalog, bundle], null, 2) + '\n', 'utf8');
renameSync(temporary, path);
console.log(`Installato ${draft.name}: ${bundle.bosses.length} boss, ${draft.encounters.length} incontri. Esegui npm run build e riavvia il server. Conserva la bozza originale per le modifiche.`);
