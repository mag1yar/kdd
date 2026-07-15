// SessionStart pointer for KDD. Never throws; always exits 0.
// Prints <=3 lines; records failures in the errors table when the db is reachable.
import { createRequire } from 'node:module';

const POINTER = 'KDD substrate active. Tools: list_tasks, recall (MCP). Board UI: kdd ui.';

async function main() {
  let core;
  try {
    const require = createRequire(import.meta.url);
    // resolve @kddkit/core relative to this plugin root
    core = await import(require.resolve('@kddkit/core'));
  } catch {
    console.log(POINTER); // core not installed yet — bare pointer
    return;
  }

  let db;
  try {
    const { dbPath, projectPath } = core.resolveDbPath();
    db = core.openDb(dbPath, projectPath);
  } catch {
    console.log(POINTER); // no db (not a git repo / unusable path)
    return;
  }

  try {
    const d = core.statusDigest(db);
    const parts = [];
    if (d.in_progress.length) parts.push(`${d.in_progress.length} in progress`);
    if (d.blocked.length) parts.push(`${d.blocked.length} blocked`);
    console.log(POINTER);
    if (parts.length) console.log(parts.join(', ') + '. Run kdd status for detail.');
  } catch (e) {
    try { core.logError(db, 'session-start', String(e)); } catch { /* ignore */ }
    console.log(POINTER);
  }
}

main().finally(() => process.exit(0));
