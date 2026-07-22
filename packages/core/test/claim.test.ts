import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db.js';
import { addTask, moveTask } from '../src/ops.js';
import { addCriterion } from '../src/criteria.js';
import { claimTask, claimNext, renewClaim, reclaimExpired, DEFAULT_TTL } from '../src/claim.js';
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
