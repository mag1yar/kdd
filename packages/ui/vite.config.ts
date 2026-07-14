import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)) } },
  build: { outDir: '../../dist/public', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:4499' } }, // dev: vite + kdd ui параллельно
});
