import { describe, it, expect } from 'vitest';
import { openDb, addTask } from '../src/index.js';
import { tick, addCriterion, setCriterionChecked } from '../src/index.js';

describe('failed_attempts column', () => {
  it('defaults to 0 on a new task', () => {
    const db = openDb(':memory:');
    const t = addTask(db, { title: 'x' }, { type: 'user' });
    expect(t.failed_attempts).toBe(0);
  });
});

function readyTask(db: ReturnType<typeof openDb>, title: string) {
  const t = addTask(db, { title }, { type: 'user' });
  const c = addCriterion(db, t.id, 'done', { type: 'user' });
  setCriterionChecked(db, t.id, c.id, true, { type: 'user' });
  return t.id;
}

describe('tick', () => {
  it('spawns up to maxWorkers and leaves the rest new', () => {
    const db = openDb(':memory:');
    readyTask(db, 'a'); readyTask(db, 'b'); readyTask(db, 'c');
    const calls: { taskId: number; workerId: string }[] = [];
    const r = tick(db, { maxWorkers: 2, ttl: 1800, projectDir: '/tmp',
      spawn: (taskId, workerId) => calls.push({ taskId, workerId }) });
    expect(r.spawned).toBe(2);
    expect(r.active).toBe(2);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.workerId)).size).toBe(2); // уникальные токены
    const newCount = (db.prepare(`SELECT COUNT(*) c FROM tasks WHERE status='new'`).get() as any).c;
    expect(newCount).toBe(1);
  });

  it('claims each task as its unique worker token', () => {
    const db = openDb(':memory:');
    const id = readyTask(db, 'a');
    const seen: string[] = [];
    tick(db, { maxWorkers: 1, ttl: 1800, projectDir: '/tmp',
      spawn: (_t, workerId) => seen.push(workerId) });
    const claimed = (db.prepare(`SELECT claimed_by FROM tasks WHERE id=?`).get(id) as any).claimed_by;
    expect(claimed).toBe(`ai:${seen[0]}`); // токен воркера == claimed_by
  });

  it('empty queue spawns nothing', () => {
    const db = openDb(':memory:');
    const r = tick(db, { maxWorkers: 3, ttl: 1800, projectDir: '/tmp', spawn: () => {} });
    expect(r.spawned).toBe(0);
  });

  it('sync spawn failure releases the claim and counts a failure', () => {
    const db = openDb(':memory:');
    const id = readyTask(db, 'a');
    const r = tick(db, { maxWorkers: 1, ttl: 1800, projectDir: '/tmp',
      spawn: () => { throw new Error('ENOENT'); } });
    expect(r.spawned).toBe(0);
    const t = db.prepare(`SELECT status, claimed_by, failed_attempts FROM tasks WHERE id=?`).get(id) as any;
    expect(t.status).toBe('new');
    expect(t.claimed_by).toBeNull();
    expect(t.failed_attempts).toBe(1);
  });
});
