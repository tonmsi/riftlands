import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [{
    name: 'runtime-world',
    transform(source, id) {
      if (!id.replace(/\\/g, '/').endsWith('/shared/world-content.ts')) return;
      return {
        code: source.replace("import customWorld from './custom-world.json';", "const customWorld = (globalThis as typeof globalThis & { __RIFTLANDS_WORLD__: unknown }).__RIFTLANDS_WORLD__;"),
        map: { version: 3, sources: [id], sourcesContent: [source], names: [], mappings: source.split('\n').map((_, i) => i ? 'AACA' : 'AAAA').join(';') }
      };
    },
    transformIndexHtml(html) {
      return html.replace('</head>', '<script src="/api/world.js"></script></head>');
    }
  }],
  build: { outDir: 'dist', sourcemap: true, rollupOptions: { input: ['index.html', 'dungeon-maker.html', 'world-maker.html'] } },
  server: { host: '0.0.0.0', fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/server/**', '**/tests/**', '**/*accounts*.json', '**/*.log', '**/*.bak', '**/*.tmp', '**/*.lock', '**/scripts/**'] } }
});
