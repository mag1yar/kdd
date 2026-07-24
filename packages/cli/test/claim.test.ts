import { describe, it, expect, beforeEach } from 'vitest';
import { kdd, kddFail, makeEnv } from './run.js';

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = makeEnv(); });

describe('kdd claim', () => {
  it('claims a ready task with a criterion and moves it to in_progress', () => {
    kdd(env, 'add', 'task', '--criterion', 'done');
    const out = kdd(env, 'claim', '1');
    expect(out).toMatch(/#1 claimed/);
    expect(kdd(env, 'show', '1', '--json')).toMatch(/"status":"in_progress"/);
  });

  it('rejects claiming a task with no criteria', () => {
    kdd(env, 'add', 'no-crit');
    const r = kddFail(env, 'claim', '1');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no acceptance criteria/);
  });

  it('--next picks the top task; prints a notice when the queue is empty', () => {
    kdd(env, 'add', 'a', '--criterion', 'done');
    expect(kdd(env, 'claim', '--next')).toMatch(/#1 claimed/);
    expect(kdd(env, 'claim', '--next')).toMatch(/no ready task/); // exit 0, informational
  });

  it('--renew extends a held lease', () => {
    kdd(env, 'add', 'a', '--criterion', 'done');
    kdd(env, 'claim', '1');
    expect(kdd(env, 'claim', '1', '--renew')).toMatch(/#1 renewed/);
  });
});
