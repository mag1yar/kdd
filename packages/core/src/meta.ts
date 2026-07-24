import type Database from 'better-sqlite3';

export function getMeta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: Database.Database, key: string, value: string): void {
  db.transaction(() => {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`).run(key, value);
  })();
}

// Атомарная запись нескольких ключей: single transaction so a partial write can't
// leave last_run without its matching last_result (tick self-report).
export function setMetaMany(db: Database.Database, entries: Record<string, string>): void {
  db.transaction(() => {
    const stmt = db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`);
    for (const [k, v] of Object.entries(entries)) stmt.run(k, v);
  })();
}
