import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const now = (): number => Math.floor(Date.now() / 1000);

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    body         TEXT,
    status       TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('backlog','new','in_progress','review','done')),
    blocked      INTEGER NOT NULL DEFAULT 0,
    block_reason TEXT,
    priority     TEXT NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low','medium','high','urgent')),
    area         TEXT,
    position     INTEGER NOT NULL DEFAULT 0,
    archived_at  INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE TABLE comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id),
    author     TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE task_links (
    from_id INTEGER NOT NULL REFERENCES tasks(id),
    to_id   INTEGER NOT NULL REFERENCES tasks(id),
    kind    TEXT NOT NULL DEFAULT 'relates_to',
    PRIMARY KEY (from_id, to_id, kind)
  );
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER REFERENCES tasks(id),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user','ai')),
    actor_id   TEXT,
    action     TEXT NOT NULL CHECK (action IN
               ('created','moved','edited','commented','blocked','unblocked','linked','archived','unarchived')),
    detail     TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT, message TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE INDEX idx_tasks_status ON tasks(status);
  CREATE INDEX idx_comments_task ON comments(task_id, created_at);
  CREATE INDEX idx_events_task ON events(task_id, created_at);
  `,
  `
  CREATE TABLE decisions (
    slug          TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    path          TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    created       TEXT,
    superseded_by TEXT
  );
  CREATE INDEX idx_decisions_hash ON decisions(content_hash);
  CREATE VIRTUAL TABLE search_index USING fts5(
    kind UNINDEXED,
    ref UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  INSERT OR IGNORE INTO meta (key, value) VALUES ('fts_last_event_id', '0');
  `,
  `
  CREATE TABLE tracks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done')),
    created_at  INTEGER NOT NULL
  );
  ALTER TABLE tasks ADD COLUMN track_id INTEGER REFERENCES tracks(id);
  CREATE INDEX idx_tasks_track ON tasks(track_id);
  `,
];

export function openDb(dbPath: string, projectPath?: string): Database.Database {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  const from = db.pragma('user_version', { simple: true }) as number;
  for (let i = from; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  if (from === 0 && projectPath) {
    db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('project_path', ?)`)
      .run(projectPath);
  }
  return db;
}
