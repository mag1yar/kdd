import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  clean: true,
  noExternal: ['@kddkit/core', '@modelcontextprotocol/sdk', 'zod'],
  external: ['better-sqlite3'], // native .node — installed by smart-install
});
