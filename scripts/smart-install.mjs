// Ensures the native better-sqlite3 binary is present in the plugin root.
// Idempotent; exits 0 even on failure (failure logged to a fallback file).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const VERSION = '^12.11.1'; // must match @kddkit/core
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function resolves() {
  // Prod: installed into pluginRoot/node_modules (base = this script).
  // Dev: pnpm keeps it in a nested store, unhoisted — resolve from packages/core,
  // where it is linked. Either base succeeding means the runtime can load it.
  const bases = [import.meta.url, join(pluginRoot, 'packages/core/index.js')];
  for (const base of bases) {
    try {
      createRequire(base).resolve('better-sqlite3');
      return true;
    } catch { /* try next base */ }
  }
  return false;
}

if (!resolves()) {
  try {
    execFileSync('npm', ['install', `better-sqlite3@${VERSION}`, '--prefix', pluginRoot],
      { stdio: 'ignore', shell: process.platform === 'win32' });
  } catch (e) {
    try {
      appendFileSync(join(pluginRoot, '.kdd-install-error.log'),
        `${new Date().toISOString()} ${String(e)}\n`);
    } catch { /* ignore */ }
  }
}
process.exit(0);
