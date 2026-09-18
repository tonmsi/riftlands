import { defineConfig } from 'vite';
export default defineConfig({
  build: { outDir: 'dist', sourcemap: true, rollupOptions: { input: ['index.html', 'dungeon-maker.html'] } },
  server: { host: '0.0.0.0', fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**', '**/server/**', '**/tests/**', '**/*accounts*.json', '**/*.log'] } }
});
