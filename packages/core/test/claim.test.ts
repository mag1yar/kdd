import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { addTask, moveTask, placeTask } from '../src/ops.js';
import { addCriterion, setCriterionChecked } from '../src/criteria.js';
import {
  claimTask, claimNext, renewClaim, reclaimExpired, releaseClaim, MAX_FAILED_ATTEMPTS, DEFAULT_TTL,
} from '../src/claim.js';
import { now } from '../src/db.js';
import { KddError } from '../src/errors.js';

let db: Database.Database;
beforeEach(() => { db = openDb(':memory:', 'p'); });
const user = { type: 'user' as const };

describe('claim migration', () => {
  it('adds nullable claim columns, defaulting NULL', () => {
    addTask(db, { title: 't' }, user);
    const t = db.prepare(`SELECT claimed_by, claim_expires FROM tasks WHERE id = 1`).get();
    expect(t).toEqual({ claimed_by: null, claim_expires: null });
  });
});

const ai = { type: 'ai' as const, id: 's1' };
const ai2 = { type: 'ai' as const, id: 's2' };
const withCriteria = (title: string) => {
  const t = addTask(db, { title }, user); addCriterion(db, t.id, 'done', user); return t.id;
};

describe('claim ops', () => {
  it('claims a ready task with criteria: new -> in_progress + lease + event', () => {
    const id = withCriteria('t');
    const res = claimTask(db, id, ai);
    expect(res.ok).toBe(true);
    const t = db.prepare(`SELECT status, claimed_by, claim_expires FROM tasks WHERE id=?`).get(id) as any;
    expect(t.status).toBe('in_progress');
    expect(t.claimed_by).toBe('ai:s1');
    expect(t.claim_expires).toBeGreaterThan(now());
    expect(db.prepare(`SELECT action FROM events WHERE task_id=? ORDER BY id DESC LIMIT 1`).get(id))
      .toEqual({ action: 'claimed' });
  });

  it('mutex: second claimant loses', () => {
    const id = withCriteria('t');
    expect(claimTask(db, id, ai).ok).toBe(true);
    const r2 = claimTask(db, id, ai2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/not claimable/);
  });

  it('rejects claim on a task with no criteria + logs claim_rejected', () => {
    const t = addTask(db, { title: 'no-crit' }, user);
    const res = claimTask(db, t.id, ai);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no acceptance criteria/);
    expect(db.prepare(`SELECT status FROM tasks WHERE id=?`).get(t.id)).toEqual({ status: 'new' });
    expect(db.prepare(`SELECT action FROM events WHERE task_id=? ORDER BY id DESC LIMIT 1`).get(t.id))
      .toEqual({ action: 'claim_rejected' });
  });

  it('claimNext picks priority then FIFO, skips unclaimable, returns null when empty', () => {
    expect(claimNext(db, ai)).toBeNull();                       // пустая очередь
    const low = withCriteria('low');
    const high = addTask(db, { title: 'high', priority: 'high' }, user);
    addCriterion(db, high.id, 'done', user);
    addTask(db, { title: 'no-crit' }, user);                    // без критериев — пропустить
    expect(claimNext(db, ai)!.id).toBe(high.id);                // приоритет вперёд
    expect(claimNext(db, ai)!.id).toBe(low);                    // потом FIFO
    expect(claimNext(db, ai)).toBeNull();                       // остались только неclaimable
  });

  it('renew extends lease for owner, fails for non-owner', () => {
    const id = withCriteria('t');
    claimTask(db, id, ai);
    const before = db.prepare(`SELECT claim_expires e FROM tasks WHERE id=?`).get(id) as any;
    const ok = renewClaim(db, id, ai, 1800);
    expect(ok.ok).toBe(true);
    const after = db.prepare(`SELECT claim_expires e FROM tasks WHERE id=?`).get(id) as any;
    expect(after.e).toBeGreaterThanOrEqual(before.e);
    expect(renewClaim(db, id, ai2).ok).toBe(false);             // чужой lease
  });

  it('reclaimExpired returns expired lease to new, clears claim, logs reclaimed', () => {
    const id = withCriteria('t');
    claimTask(db, id, ai, 900);
    db.prepare(`UPDATE tasks SET claim_expires = ? WHERE id = ?`).run(now() - 1, id); // форсим истечение
    expect(reclaimExpired(db)).toEqual([id]);
    const t = db.prepare(`SELECT status, claimed_by FROM tasks WHERE id=?`).get(id);
    expect(t).toEqual({ status: 'new', claimed_by: null });
    // после reclaim задача снова берётся
    expect(claimNext(db, ai2)!.id).toBe(id);
  });

  it('DEFAULT_TTL is 15 minutes', () => { expect(DEFAULT_TTL).toBe(900); });

  it('rejects invalid ttl (0, NaN) in claimTask, claimNext, renewClaim', () => {
    const id = withCriteria('t');
    expect(() => claimTask(db, id, ai, 0)).toThrow(KddError);
    expect(() => claimTask(db, id, ai, NaN)).toThrow(KddError);
    expect(() => claimNext(db, ai, 0)).toThrow(KddError);
    expect(() => claimNext(db, ai, NaN)).toThrow(KddError);
    claimTask(db, id, ai); // hold a lease so renewClaim has something to validate against
    expect(() => renewClaim(db, id, ai, 0)).toThrow(KddError);
    expect(() => renewClaim(db, id, ai, NaN)).toThrow(KddError);
  });
});

describe('claim invariant on move', () => {
  it('leaving in_progress clears the claim (ai finishing -> review)', () => {
    const id = withCriteria('t');
    claimTask(db, id, ai);
    addCriterion(db, id, 'x', user); // чтобы ai мог уйти в review нужно закрыть критерии
    db.prepare(`UPDATE criteria SET checked_at = ? WHERE task_id = ?`).run(now(), id);
    moveTask(db, id, 'review', ai);
    expect(db.prepare(`SELECT status, claimed_by, claim_expires FROM tasks WHERE id=?`).get(id))
      .toEqual({ status: 'review', claimed_by: null, claim_expires: null });
  });

  it('user pulling a claimed task back to new clears the claim (human > lease)', () => {
    const id = withCriteria('t');
    claimTask(db, id, ai);
    moveTask(db, id, 'new', user);
    expect(db.prepare(`SELECT claimed_by FROM tasks WHERE id=?`).get(id)).toEqual({ claimed_by: null });
    // и снова берётся
    expect(claimNext(db, ai2)!.id).toBe(id);
  });
});

describe('run-token fence', () => {
  function readyClaimed(db: ReturnType<typeof openDb>, holder: string) {
    const t = addTask(db, { title: 'w' }, { type: 'user' });
    const c = addCriterion(db, t.id, 'done', { type: 'user' });
    setCriterionChecked(db, t.id, c.id, true, { type: 'user' });
    const r = claimTask(db, t.id, { type: 'ai', id: holder });
    expect(r.ok).toBe(true);
    return t.id;
  }

  it('rejects an ai move from in_progress when the lease is held by another tick worker', () => {
    const db = openDb(':memory:');
    const id = readyClaimed(db, 's1');
    // симулируем reclaim+respawn: задачу теперь держит другой tick-воркер
    db.prepare(`UPDATE tasks SET claimed_by='ai:tick:999-0' WHERE id=?`).run(id);
    expect(() => moveTask(db, id, 'review', { type: 'ai', id: 's1' }))
      .toThrow(/lease lost/);
  });

  it('rejects an ai move when the lease is held by another (non-tick) ai session', () => {
    const db = openDb(':memory:');
    const id = readyClaimed(db, 's1');
    db.prepare(`UPDATE tasks SET claimed_by='ai:s2' WHERE id=?`).run(id); // другая ai-сессия
    expect(() => moveTask(db, id, 'review', { type: 'ai', id: 's1' }))
      .toThrow(/lease lost/);
  });

  it('allows the holder to move to review and resets failed_attempts', () => {
    const db = openDb(':memory:');
    const id = readyClaimed(db, 's1');
    db.prepare(`UPDATE tasks SET failed_attempts=2 WHERE id=?`).run(id);
    const t = moveTask(db, id, 'review', { type: 'ai', id: 's1' });
    expect(t.status).toBe('review');
    expect(t.failed_attempts).toBe(0);
  });

  it('never fences a user actor', () => {
    const db = openDb(':memory:');
    const id = readyClaimed(db, 's1');
    db.prepare(`UPDATE tasks SET claimed_by='ai:tick:999-0' WHERE id=?`).run(id);
    expect(() => moveTask(db, id, 'review', { type: 'user' })).not.toThrow();
  });

  it('does NOT fence an ai move on a USER-held in_progress task (manual claim)', () => {
    const db = openDb(':memory:');
    const id = readyClaimed(db, 's1');
    db.prepare(`UPDATE tasks SET claimed_by='user' WHERE id=?`).run(id);
    expect(() => moveTask(db, id, 'review', { type: 'ai', id: 'x' })).not.toThrow();
  });

  it('does NOT fence an ai move on an UNCLAIMED in_progress task (doc-mode)', () => {
    // doc-режим: ai двигает доску без claim -> claimed_by NULL -> fence не срабатывает.
    const db = openDb(':memory:');
    const t = addTask(db, { title: 'doc' }, { type: 'user' });
    const c = addCriterion(db, t.id, 'done', { type: 'user' });
    setCriterionChecked(db, t.id, c.id, true, { type: 'user' });
    moveTask(db, t.id, 'in_progress', { type: 'ai', id: 's9' }); // raw move, без claim -> claimed_by NULL
    expect(() => moveTask(db, t.id, 'review', { type: 'ai', id: 's9' })).not.toThrow();
  });

  it('placeTask fences an ai move on a task held by another tick worker', () => {
    const db = openDb(':memory:');
    const id = readyClaimed(db, 's1');
    db.prepare(`UPDATE tasks SET claimed_by='ai:tick:999-0' WHERE id=?`).run(id);
    expect(() => placeTask(db, id, 'review', [id], { type: 'ai', id: 's1' }))
      .toThrow(/lease lost/);
  });

  it('placeTask resets failed_attempts when the holder reaches review', () => {
    const db = openDb(':memory:');
    const id = readyClaimed(db, 's1');
    db.prepare(`UPDATE tasks SET failed_attempts=2 WHERE id=?`).run(id);
    const t = placeTask(db, id, 'review', [id], { type: 'ai', id: 's1' });
    expect(t.status).toBe('review');
    expect(t.failed_attempts).toBe(0);
  });
});

describe('failure accounting', () => {
  // tick-спаун: claimed_by='ai:tick:1-0' -> reclaim штрафует (Fix B).
  function claimedExpired(db: ReturnType<typeof openDb>) {
    const t = addTask(db, { title: 'w' }, { type: 'user' });
    const c = addCriterion(db, t.id, 'd', { type: 'user' });
    setCriterionChecked(db, t.id, c.id, true, { type: 'user' });
    claimTask(db, t.id, { type: 'ai', id: 'tick:1-0' });
    db.prepare(`UPDATE tasks SET claim_expires = 1 WHERE id=?`).run(t.id); // истёк в прошлом
    return t.id;
  }

  it('reclaim increments failed_attempts and returns task to new', () => {
    const db = openDb(':memory:');
    const id = claimedExpired(db);
    reclaimExpired(db);
    const t = db.prepare(`SELECT status, failed_attempts, blocked FROM tasks WHERE id=?`).get(id) as any;
    expect(t.status).toBe('new');
    expect(t.failed_attempts).toBe(1);
    expect(t.blocked).toBe(0);
  });

  it('auto-blocks after K reclaims', () => {
    const db = openDb(':memory:');
    const id = claimedExpired(db);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      db.prepare(`UPDATE tasks SET status='in_progress', claimed_by='ai:tick:1-0', claim_expires=1 WHERE id=?`).run(id);
      reclaimExpired(db);
    }
    const t = db.prepare(`SELECT blocked, failed_attempts FROM tasks WHERE id=?`).get(id) as any;
    expect(t.failed_attempts).toBeGreaterThanOrEqual(MAX_FAILED_ATTEMPTS);
    expect(t.blocked).toBe(1);
  });

  it('reclaim of a USER-claimed expired lease returns to new without counting a failure', () => {
    const db = openDb(':memory:');
    const t = addTask(db, { title: 'w' }, { type: 'user' });
    const c = addCriterion(db, t.id, 'd', { type: 'user' });
    setCriterionChecked(db, t.id, c.id, true, { type: 'user' });
    claimTask(db, t.id, { type: 'user' }); // claimed_by='user'
    db.prepare(`UPDATE tasks SET claim_expires = 1 WHERE id=?`).run(t.id);
    reclaimExpired(db);
    const row = db.prepare(`SELECT status, failed_attempts FROM tasks WHERE id=?`).get(t.id) as any;
    expect(row.status).toBe('new');
    expect(row.failed_attempts).toBe(0);
  });

  it('releaseClaim returns task to new and counts a failure', () => {
    const db = openDb(':memory:');
    const id = claimedExpired(db);
    db.prepare(`UPDATE tasks SET claim_expires = ${2 ** 31} WHERE id=?`).run(id); // не истёк
    releaseClaim(db, id, { type: 'ai', id: 'tick:1-0' }, 'spawn failed');
    const t = db.prepare(`SELECT status, claimed_by, failed_attempts FROM tasks WHERE id=?`).get(id) as any;
    expect(t.status).toBe('new');
    expect(t.claimed_by).toBeNull();
    expect(t.failed_attempts).toBe(1);
  });
});
