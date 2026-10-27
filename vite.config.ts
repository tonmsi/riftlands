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
  server: { host: '0.0.0.0',
    // Saved authoring data and imported artwork are read through the runtime APIs.
    // They must not trigger HMR in other open makers or the development client.
    watch: { ignored: ['**/shared/actor-catalog.json', '**/shared/custom-world.json', '**/shared/custom-dungeons.json', '**/public/actor-assets/**', '**/public/world-assets/**', '**/*.bak', '**/*.tmp', '**/*.lock'] },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/server/**', '**/tests/**', '**/*accounts*.json', '**/*.log', '**/*.bak', '**/*.tmp', '**/*.lock', '**/scripts/**'] } }
});
