import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { addTask, editTask, commentTask } from '../src/ops.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:', 'p'); });
const user = { type: 'user' as const };
const ai = { type: 'ai' as const, id: 's1' };

describe('addTask', () => {
  it('creates with defaults and logs created event', () => {
    const t = addTask(db, { title: 'Первая' }, user);
    expect(t).toMatchObject({ id: 1, title: 'Первая', status: 'new', priority: 'medium' });
    const ev = db.prepare(`SELECT * FROM events WHERE task_id=1`).all();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ action: 'created', actor_type: 'user' });
  });

  it('rejects bad priority before touching db', () => {
    expect(() => addTask(db, { title: 't', priority: 'nope' as any }, user))
      .toThrow(/invalid priority/);
    expect(db.prepare(`SELECT COUNT(*) c FROM tasks`).get()).toEqual({ c: 0 });
  });
});

describe('editTask', () => {
  it('patches fields, bumps updated_at, logs changed keys', () => {
    addTask(db, { title: 'a' }, user);
    const t = editTask(db, 1, { title: 'b', area: 'договор' }, ai);
    expect(t).toMatchObject({ title: 'b', area: 'договор' });
    const ev: any = db.prepare(
      `SELECT detail, actor_type, actor_id FROM events WHERE action='edited'`).get();
    expect(JSON.parse(ev.detail).fields.sort()).toEqual(['area', 'title']);
    expect(ev).toMatchObject({ actor_type: 'ai', actor_id: 's1' });
  });

  it('unknown id → task #N not found', () => {
    expect(() => editTask(db, 99, { title: 'x' }, user)).toThrow('task #99 not found');
  });
});

describe('commentTask', () => {
  it('stores author-attributed comment + event in one tx', () => {
    addTask(db, { title: 'a' }, user);
    const c = commentTask(db, 1, 'привет', ai);
    expect(c).toMatchObject({ task_id: 1, author: 'ai:s1', body: 'привет' });
    expect(db.prepare(`SELECT COUNT(*) c FROM events WHERE action='commented'`).get())
      .toEqual({ c: 1 });
  });
});
