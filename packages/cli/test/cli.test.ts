import { describe, it, expect, beforeEach } from 'vitest';
import { makeEnv, kdd, kddFail } from './run.js';

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = makeEnv(); });

describe('kdd add / board / show', () => {
  it('add prints #id, board shows columns, show prints detail', () => {
    expect(kdd(env, 'add', 'Первая задача', '--priority', 'high', '--area', 'договор'))
      .toContain('#1 created');
    const board = kdd(env, 'board');
    expect(board).toContain('new (1)');
    expect(board).toContain('#1 Первая задача [high] @договор');
    const show = kdd(env, 'show', '#1');
    expect(show).toContain('#1 Первая задача');
    expect(show).toContain('status: new');
  });

  it('--json returns machine-readable objects', () => {
    kdd(env, 'add', 'x');
    const out = JSON.parse(kdd(env, 'show', '1', '--json'));
    expect(out.task).toMatchObject({ id: 1, title: 'x' });
  });

  it('errors are one line on stderr with exit 1', () => {
    const r = kddFail(env, 'show', '#99');
    expect(r.code).toBe(1);
    expect(r.stderr.trim()).toBe('error: task #99 not found');
  });

  it('ai actor is recorded in events', () => {
    kdd({ ...env, KDD_ACTOR: 'ai', KDD_SESSION: 's7' }, 'add', 'от ии');
    const out = JSON.parse(kdd(env, 'show', '1', '--json'));
    expect(out.events[0]).toMatchObject({ actor_type: 'ai', actor_id: 's7' });
  });
});
