import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Runtime imports need complete definitions and boss overrides, but no editable draft. */
export function runtimeDungeonData(source: string): string {
  const entries: unknown = JSON.parse(source);
  if (!Array.isArray(entries)) throw new Error('Catalogo dungeon non valido.');
  return JSON.stringify(entries.map(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Dungeon non valido.');
    const { draft: _draft, ...runtime } = entry;
    return runtime;
  }));
}

export function runtimeDungeonDataPlugin(): Plugin {
  const moduleId = '\0riftlands:runtime-dungeons';
  let file: string;
  return {
    name: 'riftlands-runtime-dungeon-data', enforce: 'pre',
    configResolved(config) { file = path.resolve(config.root, 'shared/custom-dungeons.json'); },
    resolveId(source, importer) {
      if (source === './custom-dungeons.json' && importer && /\/shared\/(dungeons|bosses)\.ts$/.test(importer.replace(/\\/g, '/')))
        return moduleId;
    },
    async load(id) {
      if (id !== moduleId) return;
      this.addWatchFile(file);
      return `export default ${runtimeDungeonData(await readFile(file, 'utf8'))};`;
    },
  };
}
