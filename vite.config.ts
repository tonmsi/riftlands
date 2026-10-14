import { defineConfig } from 'vite';
import { wallSpriteKitPlugin } from './scripts/wall-sprite-kits';
import { runtimeDungeonDataPlugin } from './scripts/runtime-dungeon-data';
export default defineConfig({
  plugins: [wallSpriteKitPlugin(), runtimeDungeonDataPlugin()],
  build: { outDir: 'dist', sourcemap: true, rollupOptions: { input: ['index.html', 'dungeon-maker.html', 'world-maker.html', 'surface-lab.html'] } },
  server: { host: '0.0.0.0', fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/server/**', '**/tests/**', '**/*accounts*.json', '**/*.log', '**/*.bak', '**/*.tmp', '**/*.lock', '**/scripts/**'] } }
});
