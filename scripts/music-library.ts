import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export async function listWorldMusic(root: string): Promise<string[]> {
  try { return (await readdir(resolve(root, 'public/music'))).filter(name => /^[a-zA-Z0-9_-]+\.(mp3|ogg|wav)$/.test(name)).sort().map(name => `/music/${name}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function importWorldMusic(root: string, filename: unknown, base64: unknown): Promise<string> {
  if (typeof filename !== 'string' || filename.length > 200 || /[/\\]/.test(filename)) throw new Error('Nome traccia non valido.');
  const ext = /\.(mp3|ogg|wav)$/i.exec(filename)?.[1].toLowerCase();
  if (!ext || typeof base64 !== 'string' || base64.length > 27_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Importa MP3, OGG o WAV, massimo 20 MB.');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 20_000_000) throw new Error('Traccia oltre 20 MB.');
  const valid = ext === 'mp3' ? bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224)
    : ext === 'ogg' ? bytes.subarray(0, 4).toString() === 'OggS'
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE';
  if (!valid) throw new Error('Contenuto della traccia non valido.');
  const stem = filename.slice(0, -(ext.length + 1)).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'musica';
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const name = `${stem.replace(new RegExp(`-${hash}$`), '')}-${hash}.${ext}`;
  const directory = resolve(root, 'public/music'); await mkdir(directory, { recursive: true });
  try { await writeFile(resolve(directory, name), bytes, { flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!(await readFile(resolve(directory, name))).equals(bytes)) throw new Error('Nome traccia già occupato.'); }
  return `/music/${name}`;
}
