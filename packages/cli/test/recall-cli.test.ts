import { describe, it, expect } from 'vitest';
import { readdirSync, rmSync } from 'node:fs';
import { makeEnv, kdd } from './run.js';

describe('kdd decide', () => {
  it('creates a decision and prints the slug', { timeout: 60_000 }, () => {
    const env = makeEnv();
    const out = kdd(env, 'decide', 'use fts5', '--decision', 'BM25', '--rationale', 'zero deps');
    expect(out).toMatch(/^decided: \d{4}-\d{2}-\d{2}-use-fts5/);
    expect(readdirSync(env.KDD_DECISIONS_DIR!).length).toBe(1);
  });

  it('same content twice prints already recorded', { timeout: 60_000 }, () => {
    const env = makeEnv();
    kdd(env, 'decide', 'use fts5', '--decision', 'BM25');
    const out = kdd(env, 'decide', 'use fts5', '--decision', 'BM25');
    expect(out).toMatch(/^already recorded: /);
    expect(readdirSync(env.KDD_DECISIONS_DIR!).length).toBe(1);
  });

  it('--json returns slug and created flag', { timeout: 60_000 }, () => {
    const env = makeEnv();
    const r = JSON.parse(kdd(env, 'decide', 't', '--decision', 'd', '--json'));
    expect(r.created).toBe(true);
    expect(r.slug).toContain('-t');
  });
});

describe('kdd recall / rebuild', () => {
  it('decide then recall roundtrip', { timeout: 60_000 }, () => {
    const env = makeEnv();
    kdd(env, 'decide', 'use fts5 everywhere', '--decision', 'BM25 ranking wins');
    const out = kdd(env, 'recall', 'fts5');
    expect(out).toMatch(/^decision \S+ use fts5 everywhere — /m);
  });

  it('recall finds tasks with status', { timeout: 60_000 }, () => {
    const env = makeEnv();
    kdd(env, 'add', 'fix flux capacitor');
    const out = kdd(env, 'recall', 'capacitor');
    expect(out).toMatch(/^task #1 \[new\] fix flux capacitor — /m);
  });

  it('no hits prints no results with exit 0', { timeout: 60_000 }, () => {
    const env = makeEnv();
    expect(kdd(env, 'recall', 'zanzibar').trim()).toBe('no results');
  });

  it('rebuild restores decisions after db deletion', { timeout: 60_000 }, () => {
    const env = makeEnv();
    kdd(env, 'decide', 'survives loss', '--decision', 'md is the truth');
    rmSync(env.KDD_DB!);
    const out = kdd(env, 'rebuild');
    expect(out.trim()).toBe('rebuilt: 1 decisions, 0 tasks indexed');
    expect(kdd(env, 'recall', 'survives')).toContain('survives loss');
  });
});
