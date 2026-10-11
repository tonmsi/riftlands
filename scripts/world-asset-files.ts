import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Only regular files beneath the public asset directory; links are not traversed. */
export async function listWorldAssetFiles(root: string): Promise<{ name: string; image: string }[]> {
  const files: { name: string; image: string }[] = [];
  async function visit(parts: string[]): Promise<void> {
    const entries = await readdir(join(root, 'public', 'world-assets', ...parts), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) await visit([...parts, entry.name]);
      else if (entry.isFile() && /\.(png|svg)$/i.test(entry.name)) files.push({
        name: entry.name.replace(/\.(png|svg)$/i, ''),
        image: '/world-assets/' + [...parts, entry.name].map(encodeURIComponent).join('/'),
      });
    }
  }
  try { await visit([]); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return files.sort((a,b) => a.image.localeCompare(b.image, 'it'));
}
