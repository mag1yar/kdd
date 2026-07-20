import { describe, it, expect } from 'vitest';
import { checkMove, STATUSES, type Status } from '../src/state.js';

const ADJACENT: Record<Status, Status[]> = {
  backlog: ['new'],
  new: ['backlog', 'in_progress'],
  in_progress: ['new', 'review'],
  review: ['in_progress', 'done'],
  done: ['review'],
};

describe('checkMove', () => {
  it('user may make any transition', () => {
    for (const from of STATUSES) for (const to of STATUSES) {
      if (from === to) continue;
      expect(checkMove(from, to, { type: 'user' }).ok).toBe(true);
    }
  });

  it('ai follows the matrix', () => {
    for (const from of STATUSES) for (const to of STATUSES) {
      if (from === to) continue;
      const res = checkMove(from, to, { type: 'ai' });
      expect(res.ok).toBe(ADJACENT[from].includes(to));
    }
  });

  it('ai may skip with a reason', () => {
    expect(checkMove('new', 'done', { type: 'ai' }, 'пропустили по просьбе пользователя').ok)
      .toBe(true);
  });

  it('same-status move is rejected for everyone', () => {
    const res = checkMove('new', 'new', { type: 'user' });
    expect(res).toEqual({ ok: false, error: 'task is already in new' });
  });

  it('ai skip without reason returns actionable error', () => {
    const res = checkMove('new', 'done', { type: 'ai' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(
      'invalid transition new → done for ai; allowed: backlog, in_progress; pass --reason if user requested a skip');
  });

  it('ai cannot move to review with unchecked criteria', () => {
    const res = checkMove('in_progress', 'review', { type: 'ai' }, undefined, 2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/2 unchecked acceptance criteria/);
    // все отмечены → пропускает
    expect(checkMove('in_progress', 'review', { type: 'ai' }, undefined, 0).ok).toBe(true);
    // reason обходит гейт
    expect(checkMove('in_progress', 'review', { type: 'ai' }, 'user asked', 2).ok).toBe(true);
    // user не ограничен
    expect(checkMove('in_progress', 'review', { type: 'user' }, undefined, 2).ok).toBe(true);
    // гейт только на review — другие переходы не трогает
    expect(checkMove('new', 'in_progress', { type: 'ai' }, undefined, 2).ok).toBe(true);
  });
});
