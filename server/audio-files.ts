import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Byte ranges let browsers stream/loop tracks without buffering the whole file in JS. */
export function serveAudioFile(request: IncomingMessage, response: ServerResponse, path: string): void {
  let size: number;
  try { const stat = statSync(path); if (!stat.isFile() || !stat.size) throw new Error(); size = stat.size; }
  catch { response.writeHead(404); response.end(); return; }
  let start = 0, end = size - 1;
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
    }
    if (!match || !(match[1] || match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return;
    }
  }
  const types: Record<string, string> = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
  response.writeHead(range ? 206 : 200, { 'Content-Type': types[extname(path)], 'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': /-[a-f0-9]{16}\.(mp3|ogg|wav)$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (request.method === 'HEAD') response.end();
  else createReadStream(path, { start, end }).on('error', () => response.destroy()).pipe(response);
}
