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
  try {
    createRequire(import.meta.url).resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
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
