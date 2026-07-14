import { describe, it, expect, beforeEach } from 'vitest';
import { makeEnv, kdd, kddFail } from './run.js';

let env: NodeJS.ProcessEnv;
let ai: NodeJS.ProcessEnv;
beforeEach(() => {
  env = makeEnv();
  ai = { ...env, KDD_ACTOR: 'ai', KDD_SESSION: 's1' };
  kdd(env, 'add', 'Задача один');
  kdd(env, 'add', 'Задача два');
});

describe('move', () => {
  it('moves along matrix; ai skip needs --reason', () => {
    expect(kdd(ai, 'move', '#1', 'in_progress')).toContain('#1 → in_progress');
    const r = kddFail(ai, 'move', '#2', 'done');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('invalid transition');
    expect(kdd(ai, 'move', '#2', 'done', '--reason', 'просьба пользователя'))
      .toContain('#2 → done');
  });
});

describe('edit/comment/block/link/archive', () => {
  it('full verb roundtrip visible in show', () => {
    kdd(env, 'edit', '#1', '--priority', 'urgent', '--area', 'клиент');
    kdd(env, 'comment', '#1', 'первый коммент');
    kdd(env, 'block', '#1', 'жду бэк');
    kdd(env, 'link', '#1', '#2');
    const show = kdd(env, 'show', '#1');
    expect(show).toContain('priority: urgent');
    expect(show).toContain('BLOCKED: жду бэк');
    expect(show).toContain('первый коммент');
    expect(show).toContain('relates_to #2');
    kdd(env, 'unblock', '#1');
    kdd(env, 'archive', '#2');
    expect(kdd(env, 'board')).not.toContain('Задача два');
    expect(kdd(env, 'board', '--archived')).toContain('Задача два');
    kdd(env, 'unarchive', '#2');
    expect(kdd(env, 'board')).toContain('Задача два');
  });
});

describe('status/export/projects', () => {
  it('status shows sections, export dumps json', () => {
    kdd(env, 'move', '#1', 'in_progress');
    const s = kdd(env, 'status');
    expect(s).toContain('in_progress (1)');
    expect(s).toContain('recent:');
    const dump = JSON.parse(kdd(env, 'export'));
    expect(dump.tasks).toHaveLength(2);
    expect(kdd(env, 'projects')).toBeDefined(); // не падает при KDD_DB
  });
});
