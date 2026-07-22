import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { slugify } from './decisions.js';

const branchName = (taskId: number): string => `kdd/task-${taskId}`;

// git в repoRoot; бросает при ненулевом коде.
function git(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}
// git best-effort: глотает ошибку (remove/prune несуществующего — не беда).
function gitTry(repoRoot: string, args: string[]): void {
  try { git(repoRoot, args); } catch { /* ignore */ }
}

// Детерминированный путь worktree задачи. Корень стора = dirname(kdd.db) = ~/.kdd/<hash>/.
// realpath корня: git worktree add канонизирует путь через symlink-родителя (macOS /tmp,/var → /private/...),
// без этого свежесозданный путь разошёлся бы со строкой, которую вернёт `git worktree list`.
export function worktreePath(dbPath: string, taskId: number, title: string): string {
  const root = dirname(dbPath);
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  return join(realRoot, 'worktrees', `task-${taskId}-${slugify(title)}`);
}

interface WtEntry { path: string; branch: string | null }
// Парс `git worktree list --porcelain`. branch=null для detached/main-bare. Internal — не в barrel.
function listWorktrees(repoRoot: string): WtEntry[] {
  const out = git(repoRoot, ['worktree', 'list', '--porcelain']);
  const entries: WtEntry[] = [];
  let cur: WtEntry | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur);
      cur = { path: line.slice(9), branch: null }; // 'worktree '.length === 9
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice(7); // 'branch '.length === 7
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

function branchExists(repoRoot: string, branch: string): boolean {
  try { git(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); return true; }
  catch { return false; }
}

// Idempotent: гарантирует worktree на ветке kdd/task-<id>, возвращает путь.
// Reuse — по ВЕТКЕ (path-agnostic: обходит macos /tmp↔/private/tmp symlink-сравнение и смену slug).
export function ensureWorktree(
  repoRoot: string, dbPath: string, taskId: number, title: string,
): string {
  const branch = branchName(taskId);
  const ref = `refs/heads/${branch}`;
  const existing = listWorktrees(repoRoot).find((e) => e.branch === ref);
  if (existing && existsSync(existing.path)) return existing.path; // живой — reuse как есть
  if (existing) gitTry(repoRoot, ['worktree', 'remove', '--force', existing.path]); // ветка есть, каталог пропал
  const path = worktreePath(dbPath, taskId, title);
  gitTry(repoRoot, ['worktree', 'prune']);
  rmSync(path, { recursive: true, force: true }); // снести незарегистрированный каталог на целевом слоте
  const tail = branchExists(repoRoot, branch) ? [path, branch] : [path, '-b', branch];
  git(repoRoot, ['worktree', 'add', ...tail]);
  return path;
}
