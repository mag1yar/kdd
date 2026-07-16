import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import {
  addTask, moveTask, placeTask, mustGetTask,
  blockTask, unblockTask, linkTasks, archiveTask, unarchiveTask,
} from '../src/ops.js';
import { boardData } from '../src/queries.js';

let db: Database.Database;
const user = { type: 'user' as const };
const ai = { type: 'ai' as const, id: 's1' };
beforeEach(() => { db = openDb(':memory:', 'p'); addTask(db, { title: 'a' }, user); });

describe('moveTask', () => {
  it('moves along the matrix and logs from/to', () => {
    const t = moveTask(db, 1, 'in_progress', ai);
    expect(t.status).toBe('in_progress');
    const ev: any = db.prepare(`SELECT detail FROM events WHERE action='moved'`).get();
    expect(JSON.parse(ev.detail)).toEqual({ from: 'new', to: 'in_progress' });
  });

  it('rejects ai skip without reason, task untouched', () => {
    expect(() => moveTask(db, 1, 'done', ai)).toThrow(/invalid transition/);
    expect(db.prepare(`SELECT status FROM tasks WHERE id=1`).get())
      .toEqual({ status: 'new' });
  });

  it('ai skip with reason → moved + reason stored as comment', () => {
    moveTask(db, 1, 'done', ai, 'пропустили по просьбе пользователя');
    expect(db.prepare(`SELECT status FROM tasks WHERE id=1`).get())
      .toEqual({ status: 'done' });
    const c: any = db.prepare(`SELECT author, body FROM comments`).get();
    expect(c).toEqual({ author: 'ai:s1', body: 'пропустили по просьбе пользователя' });
  });

  it('user jumps freely', () => {
    expect(moveTask(db, 1, 'done', user).status).toBe('done');
  });
});

describe('block/unblock', () => {
  it('sets flag + reason at any status, logs events', () => {
    const t = blockTask(db, 1, 'жду ответа', user);
    expect(t).toMatchObject({ blocked: 1, block_reason: 'жду ответа', status: 'new' });
    const t2 = unblockTask(db, 1, ai);
    expect(t2).toMatchObject({ blocked: 0, block_reason: null });
    expect(db.prepare(
      `SELECT COUNT(*) c FROM events WHERE action IN ('blocked','unblocked')`).get())
      .toEqual({ c: 2 });
  });
});

describe('linkTasks', () => {
  it('links two tasks, duplicate link is a silent success', () => {
    addTask(db, { title: 'b' }, user);
    linkTasks(db, 1, 2, 'relates_to', user);
    linkTasks(db, 1, 2, 'relates_to', user); // не бросает
    expect(db.prepare(`SELECT COUNT(*) c FROM task_links`).get()).toEqual({ c: 1 });
  });

  it('refuses to link to a missing task', () => {
    expect(() => linkTasks(db, 1, 99, 'relates_to', user)).toThrow('task #99 not found');
  });
});

describe('archive', () => {
  it('archives and restores, keeping the column', () => {
    moveTask(db, 1, 'in_progress', user);
    const t = archiveTask(db, 1, user);
    expect(t.archived_at).not.toBeNull();
    expect(t.status).toBe('in_progress');
    const t2 = unarchiveTask(db, 1, user);
    expect(t2.archived_at).toBeNull();
  });
});

describe('placeTask (order)', () => {
  beforeEach(() => { addTask(db, { title: 'b' }, user); addTask(db, { title: 'c' }, user); });
  // старт: три задачи в 'new', позиции 0,1,2 (addTask дописывает в конец)

  it('reorders within a column, no move event', () => {
    placeTask(db, 1, 'new', [3, 2, 1], user); // #1 в конец
    const order = boardData(db).new.map((t) => t.id);
    expect(order).toEqual([3, 2, 1]);
    expect(db.prepare(`SELECT COUNT(*) c FROM events WHERE action='moved'`).get()).toEqual({ c: 0 });
  });

  it('moves across columns at an index + logs moved', () => {
    placeTask(db, 1, 'in_progress', [1], user);
    expect(mustGetTask(db, 1).status).toBe('in_progress');
    expect(boardData(db).new.map((t) => t.id)).toEqual([2, 3]);
    const ev: any = db.prepare(`SELECT detail FROM events WHERE action='moved'`).get();
    expect(JSON.parse(ev.detail)).toEqual({ from: 'new', to: 'in_progress' });
  });
});
