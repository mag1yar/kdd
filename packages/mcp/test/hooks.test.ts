import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb } from '@kddkit/core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sessionStart = join(root, 'scripts', 'session-start.mjs');
const smartInstall = join(root, 'scripts', 'smart-install.mjs');

const runNode = (script: string, env: Record<string, string>) =>
  execFileSync(process.execPath, [script], {
    env: { ...process.env, ...env }, encoding: 'utf8',
  });

describe('session-start.mjs', () => {
  it('prints a short pointer and exits 0 on a healthy db', () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'kdd-hook-')), 'kdd.db');
    openDb(dbPath, 'x').close();
    const out = runNode(sessionStart, { KDD_DB: dbPath });
    expect(out).toMatch(/KDD substrate active/);
    expect(out.trim().split('\n').length).toBeLessThanOrEqual(3);
  });

  it('exits 0 even when the db path is unusable', () => {
    // a directory as the db path makes better-sqlite3 throw
    const dir = mkdtempSync(join(tmpdir(), 'kdd-hook-'));
    const out = runNode(sessionStart, { KDD_DB: dir });
    expect(out).toMatch(/KDD substrate active/); // bare pointer still printed
  });
});

describe('smart-install.mjs', () => {
  it('is a no-op and exits 0 when better-sqlite3 already resolves', () => {
    // resolved from the workspace; must not throw and must print nothing noisy
    expect(() => runNode(smartInstall, {})).not.toThrow();
  });
});
