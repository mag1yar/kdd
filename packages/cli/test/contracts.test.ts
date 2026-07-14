import { describe, it, expect, beforeEach } from 'vitest';
import { makeEnv, kdd } from './run.js';

let env: NodeJS.ProcessEnv;
beforeEach(() => { env = makeEnv(); });

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function seed100(): void {
  for (let i = 0; i < 100; i++) {
    kdd(env, 'add',
      `Задача с достаточно длинным заголовком номер ${i} про справочники и договоры`,
      '--priority', ['low', 'medium', 'high', 'urgent'][i % 4],
      '--area', ['справочники', 'договор', 'клиент'][i % 3]);
  }
  for (let i = 1; i <= 30; i++) kdd(env, 'move', `#${i}`, 'in_progress');
  for (let i = 31; i <= 40; i++) kdd(env, 'block', `#${i}`, 'причина блокировки');
}

describe('output contracts (CLI-05)', () => {
  it('status ≤ 2KB on a 100-task board', () => {
    seed100();
    const s = kdd(env, 'status');
    expect(Buffer.byteLength(s, 'utf8')).toBeLessThanOrEqual(2048);
    expect(EMOJI.test(s)).toBe(false);
  }, 60_000);

  it('board ≤ 4KB on a 100-task board', () => {
    seed100();
    const b = kdd(env, 'board');
    expect(Buffer.byteLength(b, 'utf8')).toBeLessThanOrEqual(4096);
    expect(EMOJI.test(b)).toBe(false);
  }, 60_000);

  it('show caps a 100KB body visibly', async () => {
    // 100KB аргументом не лезет в Windows-лимит командной строки — через --body-file
    const { writeFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const bodyFile = join(dirname(env.KDD_DB!), 'body.md');
    writeFileSync(bodyFile, 'x'.repeat(100_000));
    kdd(env, 'add', 'жирная', '--body-file', bodyFile);
    const s = kdd(env, 'show', '#1');
    expect(Buffer.byteLength(s, 'utf8')).toBeLessThanOrEqual(16_384);
    expect(s).toContain('chars]');
  });

  it('recall output stays under 4KB even with many fat hits', { timeout: 60_000 }, () => {
    for (let i = 0; i < 30; i++) {
      kdd(env, 'add', `omega search target ${i} ${'lorem ipsum dolor '.repeat(10)}`,
        '--body', `omega body ${i} ${'consectetur adipiscing elit sed do '.repeat(5)}`);
    }
    const out = kdd(env, 'recall', 'omega', '-k', '30');
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(4096);
    expect(out).toMatch(/\(\+\d+ more, use -k\)/);
    expect(EMOJI.test(out)).toBe(false);
  });
});
