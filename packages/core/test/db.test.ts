import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';

describe('openDb', () => {
  it('creates schema at user_version 1 with all tables', () => {
    const db = openDb(':memory:', 'C:/proj');
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all().map((r: any) => r.name);
    expect(tables).toEqual(expect.arrayContaining(
      ['tasks', 'comments', 'task_links', 'events', 'errors', 'meta']));
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(db.prepare(`SELECT value FROM meta WHERE key='project_path'`).get())
      .toEqual({ value: 'C:/proj' });
  });

  it('is idempotent on reopen (file db)', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const p = join(mkdtempSync(join(tmpdir(), 'kdd-')), 'kdd.db');
    openDb(p, 'x').close();
    const db2 = openDb(p, 'x'); // не падает, версия та же
    expect(db2.pragma('user_version', { simple: true })).toBe(1);
    db2.close();
  });

  it('rejects bad status via CHECK', () => {
    const db = openDb(':memory:', 'x');
    expect(() => db.prepare(
      `INSERT INTO tasks (title, status, created_at, updated_at) VALUES ('t','bogus',0,0)`
    ).run()).toThrow(/CHECK/);
  });
});
