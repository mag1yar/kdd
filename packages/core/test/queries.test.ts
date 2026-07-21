import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { addTask, moveTask, blockTask, archiveTask } from '../src/ops.js';
import { boardData, taskDetail, statusDigest, exportBoard } from '../src/queries.js';
import { linkTasks } from '../src/ops.js';
import { addCriterion, setCriterionChecked } from '../src/criteria.js';

let db: Database.Database;
const user = { type: 'user' as const };
beforeEach(() => {
  db = openDb(':memory:', 'p');
  addTask(db, { title: 'срочная', priority: 'urgent', area: 'договор' }, user); // #1
  addTask(db, { title: 'обычная', area: 'клиент' }, user);                      // #2
  addTask(db, { title: 'в работе' }, user);                                     // #3
  moveTask(db, 3, 'in_progress', user);
});

describe('boardData', () => {
  it('groups by status, urgent first, has all 5 keys', () => {
    const b = boardData(db);
    expect(Object.keys(b)).toEqual(['backlog', 'new', 'in_progress', 'review', 'done']);
    expect(b.new.map((t) => t.title)).toEqual(['срочная', 'обычная']);
    expect(b.in_progress).toHaveLength(1);
  });

  it('filters by area and hides archived by default', () => {
    archiveTask(db, 2, user);
    expect(boardData(db, { area: 'договор' }).new.map((t) => t.id)).toEqual([1]);
    expect(boardData(db).new.map((t) => t.id)).toEqual([1]);
    expect(boardData(db, { archived: true }).new.map((t) => t.id)).toEqual([2]);
  });

  it('marks only unblocked new tasks ready', () => {
    moveTask(db, 2, 'backlog', user);        // #2 new → backlog
    blockTask(db, 1, 'жду', user);           // #1 new but blocked
    const b = boardData(db);
    expect(b.new.find((t) => t.id === 1)?.ready).toBe(0);   // blocked
    expect(b.backlog.find((t) => t.id === 2)?.ready).toBe(0); // backlog
    expect(b.in_progress[0].ready).toBe(0);                  // in_progress
  });

  it('regression: urgent backlog task is not ready', () => {
    moveTask(db, 1, 'backlog', user);        // #1 urgent, now backlog
    expect(boardData(db).backlog[0].ready).toBe(0);
  });

  it('ready filter returns exactly the ready set', () => {
    // #1, #2 are unblocked new → ready; #3 in_progress → not
    expect(boardData(db, { ready: true }).new.map((t) => t.id)).toEqual([1, 2]);
    expect(boardData(db, { ready: true }).in_progress).toEqual([]);
    expect(boardData(db, { ready: false }).in_progress.map((t) => t.id)).toEqual([3]);
  });

  it('counts checked/total criteria per row', () => {
    const c1 = addCriterion(db, 1, 'a', user);
    addCriterion(db, 1, 'b', user);
    setCriterionChecked(db, 1, c1.id, true, user);
    const row = boardData(db).new.find((t) => t.id === 1);
    expect(row?.criteria_checked).toBe(1);
    expect(row?.criteria_total).toBe(2);
  });
});

describe('taskDetail', () => {
  it('returns task with comments, events and links both ways', () => {
    linkTasks(db, 2, 1, 'relates_to', user);
    const d1 = taskDetail(db, 1);
    expect(d1.links).toEqual([{ id: 2, title: 'обычная', kind: 'relates_to' }]);
    expect(d1.events.map((e) => e.action)).toEqual(['created']);
  });
});

describe('statusDigest', () => {
  it('collects in_progress, review, blocked and recent events', () => {
    blockTask(db, 2, 'жду', user);
    const d = statusDigest(db);
    expect(d.in_progress.map((t) => t.id)).toEqual([3]);
    expect(d.blocked.map((t) => t.id)).toEqual([2]);
    expect(d.recent.length).toBeLessThanOrEqual(5);
  });
});

describe('exportBoard', () => {
  it('dumps everything including archived', () => {
    archiveTask(db, 1, user);
    const dump = exportBoard(db);
    expect(dump.tasks).toHaveLength(3);
    expect(dump.events.length).toBeGreaterThan(3);
  });
});
