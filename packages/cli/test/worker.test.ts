import { execFileSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, runProduced } from '@kddkit/core';
import { kdd, kddFail, makeEnv } from './run.js';

// фикстура-claude: печатает канон NDJSON, выходит с заданным кодом
function stubClaude(dir: string, lines: object[], exit = 0): string {
  const p = join(dir, 'stub-claude.mjs');
  writeFileSync(p, `#!/usr/bin/env node
${lines.map((l) => `console.log(${JSON.stringify(JSON.stringify(l))});`).join('\n')}
process.exit(${exit});
`);
  chmodSync(p, 0o755);
  return p;
}

function repo() {
  const env = makeEnv();
  const dir = dirname(env.KDD_DB as string);
  // настоящий git-репо: worker.ensureWorktree делает `git worktree add`.
  // worktree ложатся в dir/worktrees/ (store-корень = dirname(KDD_DB) = dir) — как в проде (~/.kdd/<hash>/).
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-qm', 'root']);
  env.KDD_TOPLEVEL = dir;
  return { env, dir };
}

// CR-1 фикстура: static stubClaude сериализует строки на write-time и не может эхо-нуть
// рантайм-переменную окружения — этот .mjs читает process.env.KDD_TASK_ID В МОМЕНТ ЗАПУСКА.
function stubClaudeEnvEcho(dir: string): string {
  const p = join(dir, 'stub-claude-env-echo.mjs');
  writeFileSync(p, `#!/usr/bin/env node
const text = process.env.KDD_TASK_ID ?? '';
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }));
process.exit(0);
`);
  chmodSync(p, 0o755);
  return p;
}

// фикстура-claude: делает реальный коммит в СВОЁМ cwd (= worktree воркера), затем канон NDJSON.
function stubClaudeCommit(dir: string): string {
  const p = join(dir, 'stub-claude-commit.mjs');
  writeFileSync(p, `#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync('work.txt', 'done');
execFileSync('git', ['add', 'work.txt']);
execFileSync('git', ['commit', '-qm', 'worker commit']);
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }));
process.exit(0);
`);
  chmodSync(p, 0o755);
  return p;
}

// фикстура-claude: как stubClaudeCommit, но коммитит ДРУГОЙ файл — для теста back-to-back
// ранов на переиспользуемом worktree (второй запуск stubClaudeCommit на том же work.txt
// не даст реального diff → `git commit` упадёт "nothing to commit").
function stubClaudeCommit2(dir: string): string {
  const p = join(dir, 'stub-claude-commit-2.mjs');
  writeFileSync(p, `#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync('work2.txt', 'done2');
execFileSync('git', ['add', 'work2.txt']);
execFileSync('git', ['commit', '-qm', 'worker commit 2']);
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok2' }] } }));
process.exit(0);
`);
  chmodSync(p, 0o755);
  return p;
}

describe('kdd worker', () => {
  it('ingests stream into agent_events, run_start first, run_end last with exit code', () => {
    const { env, dir } = repo();
    kdd(env, 'add', 'do a thing'); // task #1
    const stub = stubClaude(dir, [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } },
    ], 0);
    kdd({ ...env, KDD_CLAUDE_CMD: `node ${stub}`, KDD_SESSION: 'tick:9-0' }, 'worker', '1');
    const feed = JSON.parse(kdd(env, 'feed', '1', '--json'));
    expect(feed.map((e: any) => e.kind)).toEqual(['run_start', 'text', 'tool_start', 'run_end']);
    expect(feed[0].worker_id).toBe('tick:9-0');
    expect(JSON.parse(feed.at(-1).detail).exitCode).toBe(0);
  });

  it('records nonzero exit', () => {
    const { env, dir } = repo();
    kdd(env, 'add', 't');
    const stub = stubClaude(dir, [], 3);
    kdd({ ...env, KDD_CLAUDE_CMD: `node ${stub}` }, 'worker', '1');
    const feed = JSON.parse(kdd(env, 'feed', '1', '--json'));
    expect(JSON.parse(feed.at(-1).detail).exitCode).toBe(3);
  });

  it('missing claude → error event + run_end, no crash', () => {
    const { env } = repo();
    kdd(env, 'add', 't');
    kdd({ ...env, KDD_CLAUDE_CMD: '/nonexistent/claude-xyz' }, 'worker', '1');
    const feed = JSON.parse(kdd(env, 'feed', '1', '--json'));
    expect(feed.some((e: any) => e.kind === 'error')).toBe(true);
    expect(feed.at(-1).kind).toBe('run_end');
  });

  it('CR-1: direct `kdd worker <id>` (no inherited KDD_TASK_ID) sets child env so $KDD_TASK_ID resolves', () => {
    const { env, dir } = repo();
    kdd(env, 'add', 'do a thing'); // task #1
    const stub = stubClaudeEnvEcho(dir);
    // deliberately WITHOUT KDD_TASK_ID / KDD_SESSION in the passed env — only KDD_TOPLEVEL + KDD_CLAUDE_CMD
    kdd({ ...env, KDD_CLAUDE_CMD: `node ${stub}` }, 'worker', '1');
    const feed = JSON.parse(kdd(env, 'feed', '1', '--json'));
    const textEvent = feed.find((e: any) => e.kind === 'text');
    expect(JSON.parse(textEvent.detail).text).toBe('1');
  });

  it('CR-2: bad id exits non-zero with a clean error: line, no stack', () => {
    const { env } = repo();
    const { code, stderr } = kddFail(env, 'worker', 'abc');
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/(^|\n)error:/);
    expect(stderr).not.toMatch(/at .*worker/); // no stack trace leaking through
  });

  it('CR-2: nonexistent task exits non-zero with a clean error: line, no stack', () => {
    const { env } = repo();
    const { code, stderr } = kddFail(env, 'worker', '999');
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/(^|\n)error:/);
  });

  it('runs claude in the per-task worktree (cwd = worktrees/task-<id>-*), not toplevel', () => {
    const { env, dir } = repo();
    kdd(env, 'add', 'wt task'); // task #1
    const p = join(dir, 'stub-cwd.mjs');
    writeFileSync(p, `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: process.cwd() }] } }));
process.exit(0);
`);
    chmodSync(p, 0o755);
    kdd({ ...env, KDD_CLAUDE_CMD: `node ${p}` }, 'worker', '1');
    const feed = JSON.parse(kdd(env, 'feed', '1', '--json'));
    const childCwd = JSON.parse(feed.find((e: any) => e.kind === 'text').detail).text;
    expect(childCwd).toContain(join('worktrees', 'task-1-'));
    expect(childCwd).not.toBe(dir); // не корень репо/стора
  });

  it('commit run: run_start/run_end carry head, runProduced.committed=true', () => {
    const { env, dir } = repo();
    kdd(env, 'add', 'x'); // task #1 — repo() не создаёт задачу
    const stub = stubClaudeCommit(dir);
    kdd({ ...env, KDD_CLAUDE_CMD: `node ${stub}` }, 'worker', '1');

    const d = openDb(env.KDD_DB as string, dir);
    const rows = d.prepare(
      `SELECT kind, detail FROM agent_events WHERE task_id = 1 AND kind IN ('run_start','run_end') ORDER BY id`,
    ).all() as { kind: string; detail: string }[];
    const start = JSON.parse(rows.find((r) => r.kind === 'run_start')!.detail);
    const end = JSON.parse(rows.find((r) => r.kind === 'run_end')!.detail);
    expect(typeof start.head).toBe('string');
    expect(typeof end.head).toBe('string');

    const rp = runProduced(d, 1);
    d.close();
    expect(rp).not.toBeNull();
    expect(rp!.committed).toBe(true);
    expect(rp!.before).not.toBe(rp!.after);
  });

  it('reused worktree: run 2 before_head == run 1 after_head, isolating run 2 own commit', () => {
    const { env, dir } = repo();
    kdd(env, 'add', 'x'); // task #1 — repo() не создаёт задачу

    // ран 1: коммитит work.txt в новом (только что созданном) worktree
    const stub1 = stubClaudeCommit(dir);
    kdd({ ...env, KDD_CLAUDE_CMD: `node ${stub1}` }, 'worker', '1');
    const d1 = openDb(env.KDD_DB as string, dir);
    const run1 = runProduced(d1, 1)!;
    d1.close();
    expect(run1.committed).toBe(true);

    // ран 2: тот же task id → ensureWorktree переиспользует ветку/worktree ран 1.
    // Коммитит work2.txt (другой файл — иначе второй `git commit` на идентичном diff упадёт).
    const stub2 = stubClaudeCommit2(dir);
    kdd({ ...env, KDD_CLAUDE_CMD: `node ${stub2}` }, 'worker', '1');

    const d = openDb(env.KDD_DB as string, dir);
    const rows = d.prepare(
      `SELECT kind, detail FROM agent_events WHERE task_id = 1 AND kind IN ('run_start','run_end') ORDER BY id`,
    ).all() as { kind: string; detail: string }[];
    const starts = rows.filter((r) => r.kind === 'run_start').map((r) => JSON.parse(r.detail));
    const ends = rows.filter((r) => r.kind === 'run_end').map((r) => JSON.parse(r.detail));
    expect(starts.length).toBe(2);
    expect(ends.length).toBe(2);
    // worktree переиспользован: before_head рана 2 == after_head рана 1
    expect(starts[1].head).toBe(ends[0].head);

    const rp = runProduced(d, 1);
    d.close();
    expect(rp).not.toBeNull();
    expect(rp!.committed).toBe(true);
    expect(rp!.before).toBe(run1.after); // ран 2 стартует с головы, оставленной раном 1
    expect(rp!.after).not.toBe(rp!.before); // ран 2 сам что-то закоммитил
  });

  it('empty run: no commit → runProduced.committed=false', () => {
    const { env, dir } = repo();
    kdd(env, 'add', 'x'); // task #1 — repo() не создаёт задачу
    const stub = stubClaude(dir, [{ type: 'assistant', message: { content: [{ type: 'text', text: 'noop' }] } }]);
    kdd({ ...env, KDD_CLAUDE_CMD: `node ${stub}` }, 'worker', '1');

    const d = openDb(env.KDD_DB as string, dir);
    const rp = runProduced(d, 1);
    d.close();
    expect(rp).not.toBeNull();
    expect(rp!.committed).toBe(false);
    expect(rp!.before).toBe(rp!.after);
  });
});
