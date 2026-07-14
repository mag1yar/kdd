# KDD Phase 2 — Decisions & Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decisions as committed markdown in `.planning/decisions/` with FTS5 BM25 recall across decisions and tasks, plus a fully rebuildable index.

**Architecture:** Migration 2 adds a `decisions` mirror table and one content-storing FTS5 table `search_index(kind, ref, title, body)`. One sync code path (`syncIndex`) runs before every recall: decisions by content-hash diff against the filesystem, tasks incrementally via `events.id > meta.fts_last_event_id`. No SQL triggers. `rebuild` = wipe + sync.

**Tech Stack:** TypeScript ESM, better-sqlite3 (FTS5 built in), commander, vitest, tsup. Existing monorepo `packages/core` (@kddkit/core) + `packages/cli` (@kddkit/cli).

**Spec:** `docs/superpowers/specs/2026-07-14-kdd-phase2-decisions-recall-design.md`

## Global Constraints

- No new runtime dependencies. FTS5 ships inside better-sqlite3.
- `kdd recall` text output ≤ 4096 bytes, enforced by a test (style of Phase 1 CLI-05).
- Error contract (Phase 1): `error: <msg>` on stderr exit 1; `{"error": ...}` on stdout with `--json`.
- Never edit `MIGRATIONS[0]`; migration 2 is appended to the array.
- SQLite tables are derived caches; `.planning/decisions/*.md` is the source of truth for decisions.
- No emoji/banners in any CLI output.
- Conventional commits. NEVER add Claude attribution/trailers to commit messages.
- Run commands from repo root `C:\My\Projects\Claude plugins\my\docit`. Full check: `pnpm test` (turbo builds then tests). Per-package: `pnpm --filter @kddkit/core exec vitest run <file>`.
- CLI tests spawn the built `packages/cli/dist/index.js`; after changing cli/core sources run `pnpm --filter @kddkit/cli... build` (builds core dependency too) before running cli tests.

## File Structure

- `packages/core/src/db.ts` — append `MIGRATIONS[1]`
- `packages/core/src/decisions.ts` (new) — slugify, contentHash, render/parse decision md, `addDecision`
- `packages/core/src/recall.ts` (new) — `syncIndex`, `sanitizeQuery`, `recall`, `rebuild`, `RecallHit`
- `packages/core/src/paths.ts` — add `resolveDecisionsDir`
- `packages/core/src/index.ts` — export new modules
- `packages/cli/src/index.ts` — commands `decide`, `recall`, `rebuild`
- `packages/cli/src/render.ts` — `renderRecall` with 4096-byte cap
- `packages/cli/test/run.ts` — `makeEnv` gains `KDD_DECISIONS_DIR`
- Tests: `packages/core/test/decisions.test.ts`, `packages/core/test/recall.test.ts`, `packages/cli/test/recall-cli.test.ts`, contract additions in `packages/cli/test/contracts.test.ts`

---

### Task 1: Migration 2 — decisions table + FTS5 search_index

**Files:**
- Modify: `packages/core/src/db.ts` (append to `MIGRATIONS`)
- Test: `packages/core/test/db.test.ts` (add cases)

**Interfaces:**
- Consumes: `openDb`, `MIGRATIONS` from Phase 1.
- Produces: tables `decisions(slug, title, path, content_hash, created, superseded_by)`, `search_index` FTS5 `(kind UNINDEXED, ref UNINDEXED, title, body)` tokenize unicode61, meta row `fts_last_event_id = '0'`. `user_version` becomes 2.

- [ ] **Step 1: Write the failing tests** — append to `packages/core/test/db.test.ts` inside `describe('openDb', ...)`:

```ts
  it('migration 2 adds decisions, search_index and fts_last_event_id', () => {
    const db = openDb(':memory:', 'x');
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all().map((r: any) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['decisions', 'search_index']));
    expect(db.prepare(`SELECT value FROM meta WHERE key='fts_last_event_id'`).get())
      .toEqual({ value: '0' });
    // FTS5 actually works
    db.prepare(`INSERT INTO search_index (kind, ref, title, body)
                VALUES ('decision', 's', 'hello world', 'greeting text')`).run();
    const hit = db.prepare(`SELECT ref FROM search_index WHERE search_index MATCH '"hello"'`).get();
    expect(hit).toEqual({ ref: 's' });
  });

  it('migrates an existing v1 database in place', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const Database = (await import('better-sqlite3')).default;
    const p = join(mkdtempSync(join(tmpdir(), 'kdd-')), 'kdd.db');
    // build a v1 db by hand: run only MIGRATIONS[0]
    const { MIGRATIONS } = await import('../src/db.js');
    const raw = new Database(p);
    raw.exec(MIGRATIONS[0]);
    raw.pragma('user_version = 1');
    raw.close();
    const db = openDb(p, 'x');
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    expect(() => db.prepare(`SELECT COUNT(*) FROM decisions`).get()).not.toThrow();
    db.close();
  });
```

Note: the existing first test asserts `user_version` is 1 — update that assertion to `MIGRATIONS.length` (import it) so it stays true for future migrations:

```ts
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @kddkit/core exec vitest run test/db.test.ts`
Expected: FAIL — `user_version` is 1, no `decisions` table.

- [ ] **Step 3: Append migration 2** in `packages/core/src/db.ts` — add a second element to `MIGRATIONS` (do not touch element 0):

```ts
export const MIGRATIONS: string[] = [
  ` /* ...existing migration 1 unchanged... */ `,
  `
  CREATE TABLE decisions (
    slug          TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    path          TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    created       TEXT,
    superseded_by TEXT
  );
  CREATE INDEX idx_decisions_hash ON decisions(content_hash);
  CREATE VIRTUAL TABLE search_index USING fts5(
    kind UNINDEXED,
    ref UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  INSERT OR IGNORE INTO meta (key, value) VALUES ('fts_last_event_id', '0');
  `,
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @kddkit/core exec vitest run test/db.test.ts`
Expected: PASS (all, including updated version assertion).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db.ts packages/core/test/db.test.ts
git commit -m "feat(core): migration 2 - decisions table and FTS5 search_index"
```

---

### Task 2: Decision md format — slugify, contentHash, render, parse

**Files:**
- Create: `packages/core/src/decisions.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './decisions.js';`)
- Test: `packages/core/test/decisions.test.ts`

**Interfaces:**
- Produces (used by Tasks 3–4):
  - `slugify(title: string): string`
  - `contentHash(title: string, body: string): string` — sha256 hex, CRLF→LF, trimmed
  - `renderDecisionBody(input: DecisionInput): string`
  - `renderDecisionMd(input: DecisionInput, created: string): string`
  - `parseDecisionMd(raw: string): ParsedDecision` where `ParsedDecision = { title, created, status, supersededBy, indexBody, hash }`
  - `interface DecisionInput { title; decision?; rationale?; alternatives?; outcome?; supersedes?; body? }` (all strings)

- [ ] **Step 1: Write the failing tests** — `packages/core/test/decisions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  slugify, contentHash, renderDecisionMd, parseDecisionMd,
} from '../src/decisions.js';

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('Use FTS5, not embeddings!')).toBe('use-fts5-not-embeddings');
  });
  it('keeps unicode letters (russian titles)', () => {
    expect(slugify('Использовать FTS5')).toBe('использовать-fts5');
  });
  it('falls back to untitled', () => {
    expect(slugify('!!!')).toBe('untitled');
  });
  it('caps at 60 chars', () => {
    expect(slugify('a'.repeat(100)).length).toBe(60);
  });
});

describe('contentHash', () => {
  it('is stable across CRLF and trailing whitespace', () => {
    expect(contentHash('t', 'a\r\nb\n')).toBe(contentHash('t', 'a\nb'));
  });
  it('differs on content change', () => {
    expect(contentHash('t', 'a')).not.toBe(contentHash('t', 'b'));
  });
});

describe('render + parse roundtrip', () => {
  it('renders all five sections with - for empty ones', () => {
    const md = renderDecisionMd(
      { title: 'use fts5', decision: 'FTS5 BM25', rationale: 'zero deps' }, '2026-07-14');
    expect(md).toContain('---\ncreated: 2026-07-14\nstatus: active\nsuperseded_by:\n---');
    expect(md).toContain('# use fts5');
    expect(md).toContain('## Decision\nFTS5 BM25');
    expect(md).toContain('## Rationale\nzero deps');
    expect(md).toContain('## Alternatives\n-');
    expect(md).toContain('## Supersedes\n-');
    expect(md).toContain('## Outcome\n-');
  });

  it('parse extracts frontmatter, title and index body; hash matches render input', () => {
    const md = renderDecisionMd({ title: 'use fts5', decision: 'FTS5' }, '2026-07-14');
    const doc = parseDecisionMd(md);
    expect(doc.title).toBe('use fts5');
    expect(doc.created).toBe('2026-07-14');
    expect(doc.status).toBe('active');
    expect(doc.supersededBy).toBe('');
    expect(doc.indexBody).toContain('FTS5');
    // hash is frontmatter-independent: same content, different date => same hash
    const md2 = renderDecisionMd({ title: 'use fts5', decision: 'FTS5' }, '2027-01-01');
    expect(parseDecisionMd(md2).hash).toBe(doc.hash);
  });

  it('parses a hand-written file without frontmatter', () => {
    const doc = parseDecisionMd('# manual note\n\nsome context here');
    expect(doc.title).toBe('manual note');
    expect(doc.status).toBe('active');
    expect(doc.indexBody).toBe('some context here');
  });

  it('uses body verbatim when DecisionInput.body is set', () => {
    const md = renderDecisionMd({ title: 't', body: 'free-form **md**' }, '2026-07-14');
    expect(md).toContain('free-form **md**');
    expect(md).not.toContain('## Decision');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @kddkit/core exec vitest run test/decisions.test.ts`
Expected: FAIL — module `../src/decisions.js` not found.

- [ ] **Step 3: Implement** — `packages/core/src/decisions.ts`:

```ts
import { createHash } from 'node:crypto';

export interface DecisionInput {
  title: string;
  decision?: string;
  rationale?: string;
  alternatives?: string;
  outcome?: string;
  supersedes?: string; // slug of the decision being superseded
  body?: string;       // full md body; mutually exclusive with section flags
}

export interface ParsedDecision {
  title: string;
  created: string;
  status: string;        // 'active' | 'superseded' (unknown values pass through)
  supersededBy: string;  // '' when active
  indexBody: string;     // everything below the "# title" line
  hash: string;
}

export function slugify(title: string): string {
  const s = title.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'untitled';
}

const normalize = (s: string): string => s.replace(/\r\n/g, '\n').trim();

export function contentHash(title: string, body: string): string {
  return createHash('sha256')
    .update(`${normalize(title)}\n${normalize(body)}`)
    .digest('hex');
}

export function renderDecisionBody(input: DecisionInput): string {
  if (input.body !== undefined) return normalize(input.body);
  const sec = (name: string, v?: string) => `## ${name}\n${normalize(v ?? '') || '-'}`;
  return [
    sec('Decision', input.decision),
    sec('Rationale', input.rationale),
    sec('Alternatives', input.alternatives),
    sec('Supersedes', input.supersedes),
    sec('Outcome', input.outcome),
  ].join('\n\n');
}

export function renderDecisionMd(input: DecisionInput, created: string): string {
  return `---\ncreated: ${created}\nstatus: active\nsuperseded_by:\n---\n` +
    `# ${input.title.trim()}\n\n${renderDecisionBody(input)}\n`;
}

export function parseDecisionMd(raw: string): ParsedDecision {
  const text = raw.replace(/\r\n/g, '\n');
  const fm: Record<string, string> = {};
  let rest = text;
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4);
    if (end !== -1) {
      for (const line of text.slice(4, end).split('\n')) {
        const m = line.match(/^(\w+):\s*(.*)$/);
        if (m) fm[m[1]] = m[2].trim();
      }
      rest = text.slice(end + 5);
    }
  }
  const tm = rest.match(/^# (.+)$/m);
  const title = tm ? tm[1].trim() : '';
  const indexBody = tm
    ? rest.slice(rest.indexOf(tm[0]) + tm[0].length).trim()
    : rest.trim();
  return {
    title,
    created: fm.created ?? '',
    status: fm.status || 'active',
    supersededBy: fm.superseded_by ?? '',
    indexBody,
    hash: contentHash(title, indexBody),
  };
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from './decisions.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @kddkit/core exec vitest run test/decisions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/decisions.ts packages/core/src/index.ts packages/core/test/decisions.test.ts
git commit -m "feat(core): decision md format - slugify, content hash, render, parse"
```

---

### Task 3: addDecision — write md + rows, dedup, collision, supersedes

**Files:**
- Modify: `packages/core/src/decisions.ts`
- Test: `packages/core/test/decisions.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 tables, Task 2 helpers, `KddError` from `./errors.js`.
- Produces (used by CLI Task 6): `addDecision(db: Database.Database, decisionsDir: string, input: DecisionInput): { slug: string; path: string; created: boolean }`

- [ ] **Step 1: Write the failing tests** — append to `packages/core/test/decisions.test.ts`:

```ts
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { addDecision } from '../src/decisions.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'kdd-dec-'));

describe('addDecision', () => {
  it('creates a dated md file and a decisions row', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    const r = addDecision(db, dir, { title: 'use fts5', decision: 'FTS5', rationale: 'deps' });
    expect(r.created).toBe(true);
    expect(r.slug).toMatch(/^\d{4}-\d{2}-\d{2}-use-fts5$/);
    expect(existsSync(r.path)).toBe(true);
    expect(readFileSync(r.path, 'utf8')).toContain('## Decision\nFTS5');
    const row = db.prepare(`SELECT * FROM decisions WHERE slug = ?`).get(r.slug) as any;
    expect(row.title).toBe('use fts5');
    const idx = db.prepare(
      `SELECT * FROM search_index WHERE kind='decision' AND ref = ?`).get(r.slug);
    expect(idx).toBeTruthy();
  });

  it('same content twice returns created=false and writes nothing new', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    const a = addDecision(db, dir, { title: 'use fts5', decision: 'FTS5' });
    const b = addDecision(db, dir, { title: 'use fts5', decision: 'FTS5' });
    expect(b.created).toBe(false);
    expect(b.slug).toBe(a.slug);
    expect(readdirSync(dir).length).toBe(1);
  });

  it('same title different content appends -2', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    const a = addDecision(db, dir, { title: 'use fts5', decision: 'one' });
    const b = addDecision(db, dir, { title: 'use fts5', decision: 'two' });
    expect(b.created).toBe(true);
    expect(b.slug).toBe(`${a.slug}-2`);
  });

  it('supersedes rewrites the old file frontmatter and db row', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    const old = addDecision(db, dir, { title: 'old way', decision: 'x' });
    const neu = addDecision(db, dir, { title: 'new way', decision: 'y', supersedes: old.slug });
    const oldRaw = readFileSync(old.path, 'utf8');
    expect(oldRaw).toContain('status: superseded');
    expect(oldRaw).toContain(`superseded_by: ${neu.slug}`);
    const row = db.prepare(`SELECT superseded_by FROM decisions WHERE slug = ?`)
      .get(old.slug) as any;
    expect(row.superseded_by).toBe(neu.slug);
  });

  it('supersedes with unknown slug throws and creates nothing', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    expect(() => addDecision(db, dir, { title: 't', decision: 'd', supersedes: 'nope' }))
      .toThrow(/not found/);
    expect(existsSync(dir) ? readdirSync(dir).length : 0).toBe(0);
  });

  it('body and section flags are mutually exclusive', () => {
    const db = openDb(':memory:', 'x');
    expect(() => addDecision(db, tmp(), { title: 't', body: 'b', decision: 'd' }))
      .toThrow(/mutually exclusive/);
  });

  it('empty title throws', () => {
    const db = openDb(':memory:', 'x');
    expect(() => addDecision(db, tmp(), { title: '  ' })).toThrow(/title/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @kddkit/core exec vitest run test/decisions.test.ts`
Expected: FAIL — `addDecision` is not exported.

- [ ] **Step 3: Implement** — append to `packages/core/src/decisions.ts` (new imports at top):

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { KddError } from './errors.js';
```

```ts
function supersede(db: Database.Database, dir: string, oldSlug: string, newSlug: string): void {
  const p = join(dir, `${oldSlug}.md`);
  if (!existsSync(p)) throw new KddError(`decision '${oldSlug}' not found`);
  let raw = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  if (raw.startsWith('---\n') && /^status:/m.test(raw)) {
    raw = raw
      .replace(/^status:.*$/m, 'status: superseded')
      .replace(/^superseded_by:.*$/m, `superseded_by: ${newSlug}`);
  } else {
    // hand-written file without frontmatter — prepend it so sync keeps the flag
    const doc = parseDecisionMd(raw);
    raw = `---\ncreated: ${doc.created}\nstatus: superseded\nsuperseded_by: ${newSlug}\n---\n${raw}`;
  }
  writeFileSync(p, raw);
  db.prepare(`UPDATE decisions SET superseded_by = ? WHERE slug = ?`).run(newSlug, oldSlug);
}

export function addDecision(
  db: Database.Database, decisionsDir: string, input: DecisionInput,
): { slug: string; path: string; created: boolean } {
  if (!input.title.trim()) throw new KddError('title must not be empty');
  if (input.body !== undefined &&
      [input.decision, input.rationale, input.alternatives, input.outcome]
        .some((v) => v !== undefined)) {
    throw new KddError('--body is mutually exclusive with section flags');
  }
  const body = renderDecisionBody(input);
  const hash = contentHash(input.title, body);
  const dup = db.prepare(`SELECT slug, path FROM decisions WHERE content_hash = ?`)
    .get(hash) as { slug: string; path: string } | undefined;
  if (dup) return { slug: dup.slug, path: dup.path, created: false };

  const date = new Date().toISOString().slice(0, 10);
  const base = `${date}-${slugify(input.title)}`;
  let slug = base;
  const taken = (s: string): boolean =>
    existsSync(join(decisionsDir, `${s}.md`)) ||
    !!db.prepare(`SELECT 1 FROM decisions WHERE slug = ?`).get(s);
  for (let i = 2; taken(slug); i++) slug = `${base}-${i}`;
  const path = join(decisionsDir, `${slug}.md`);

  return db.transaction(() => {
    if (input.supersedes) supersede(db, decisionsDir, input.supersedes, slug);
    mkdirSync(decisionsDir, { recursive: true });
    writeFileSync(path, renderDecisionMd(input, date));
    db.prepare(
      `INSERT INTO decisions (slug, title, path, content_hash, created, superseded_by)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(slug, input.title.trim(), path, hash, date);
    db.prepare(
      `INSERT INTO search_index (kind, ref, title, body) VALUES ('decision', ?, ?, ?)`,
    ).run(slug, input.title.trim(), body);
    return { slug, path, created: true };
  })();
}
```

Note: the file write sits inside the transaction — if the DB insert fails the file remains, but the next `syncIndex` picks it up from disk anyway (filesystem is the truth), so no cleanup logic is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @kddkit/core exec vitest run test/decisions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/decisions.ts packages/core/test/decisions.test.ts
git commit -m "feat(core): addDecision - md file, dedup by content hash, supersedes"
```

---

### Task 4: syncIndex — decisions from filesystem, tasks from events

**Files:**
- Create: `packages/core/src/recall.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './recall.js';`)
- Test: `packages/core/test/recall.test.ts`

**Interfaces:**
- Consumes: `parseDecisionMd` (Task 2), tables (Task 1), `addTask`/`commentTask`/`archiveTask` (Phase 1 ops).
- Produces: `syncIndex(db: Database.Database, decisionsDir: string): void` (used by Task 5 `recall` and Task 5 `rebuild`).

- [ ] **Step 1: Write the failing tests** — `packages/core/test/recall.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { addDecision } from '../src/decisions.js';
import { syncIndex } from '../src/recall.js';
import { addTask, commentTask, archiveTask } from '../src/ops.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'kdd-rec-'));
const user = { type: 'user' } as const;

const idxCount = (db: any, kind: string) =>
  (db.prepare(`SELECT COUNT(*) c FROM search_index WHERE kind = ?`).get(kind) as any).c;

describe('syncIndex — decisions', () => {
  it('indexes an md file dropped into the dir by hand', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    writeFileSync(join(dir, '2026-07-14-manual.md'),
      '---\ncreated: 2026-07-14\nstatus: active\nsuperseded_by:\n---\n# manual note\n\nponytail wisdom');
    syncIndex(db, dir);
    expect(idxCount(db, 'decision')).toBe(1);
    const row = db.prepare(`SELECT title FROM decisions WHERE slug='2026-07-14-manual'`).get() as any;
    expect(row.title).toBe('manual note');
  });

  it('removes deleted files from the index', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    const r = addDecision(db, dir, { title: 'temp', decision: 'x' });
    syncIndex(db, dir);
    rmSync(r.path);
    syncIndex(db, dir);
    expect(idxCount(db, 'decision')).toBe(0);
    expect(db.prepare(`SELECT COUNT(*) c FROM decisions`).get()).toEqual({ c: 0 });
  });

  it('reindexes a file edited by hand (hash change)', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    const r = addDecision(db, dir, { title: 'evolve', decision: 'v1' });
    writeFileSync(r.path,
      '---\ncreated: 2026-07-14\nstatus: active\nsuperseded_by:\n---\n# evolve\n\n## Decision\nv2-zanzibar');
    syncIndex(db, dir);
    const hit = db.prepare(
      `SELECT ref FROM search_index WHERE search_index MATCH '"zanzibar"'`).get() as any;
    expect(hit.ref).toBe(r.slug);
  });

  it('missing decisions dir is fine (zero decisions)', () => {
    const db = openDb(':memory:', 'x');
    expect(() => syncIndex(db, join(tmp(), 'nope'))).not.toThrow();
    expect(idxCount(db, 'decision')).toBe(0);
  });
});

describe('syncIndex — tasks via events', () => {
  it('indexes task title, body and comments incrementally', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    const t = addTask(db, { title: 'wire the flux capacitor', body: 'needs plutonium' }, user);
    syncIndex(db, dir);
    expect(idxCount(db, 'task')).toBe(1);
    commentTask(db, t.id, 'gigawatts confirmed', user);
    syncIndex(db, dir);
    const row = db.prepare(
      `SELECT body FROM search_index WHERE kind='task' AND ref = ?`).get(String(t.id)) as any;
    expect(row.body).toContain('plutonium');
    expect(row.body).toContain('gigawatts');
  });

  it('archived tasks drop out of the index', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    const t = addTask(db, { title: 'obsolete' }, user);
    syncIndex(db, dir);
    archiveTask(db, t.id, user);
    syncIndex(db, dir);
    expect(idxCount(db, 'task')).toBe(0);
  });

  it('is incremental: second sync with no new events touches nothing', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    addTask(db, { title: 'once' }, user);
    syncIndex(db, dir);
    const before = db.prepare(`SELECT value FROM meta WHERE key='fts_last_event_id'`).get();
    syncIndex(db, dir);
    expect(db.prepare(`SELECT value FROM meta WHERE key='fts_last_event_id'`).get())
      .toEqual(before);
    expect(idxCount(db, 'task')).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @kddkit/core exec vitest run test/recall.test.ts`
Expected: FAIL — module `../src/recall.js` not found.

- [ ] **Step 3: Implement** — `packages/core/src/recall.ts`:

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { parseDecisionMd } from './decisions.js';

export function syncIndex(db: Database.Database, decisionsDir: string): void {
  db.transaction(() => {
    // decisions: filesystem is the truth
    const files = existsSync(decisionsDir)
      ? readdirSync(decisionsDir).filter((f) => f.endsWith('.md'))
      : [];
    const inDb = new Map(
      (db.prepare(`SELECT slug, content_hash, superseded_by FROM decisions`).all() as
        { slug: string; content_hash: string; superseded_by: string | null }[])
        .map((r) => [r.slug, r]),
    );
    const seen = new Set<string>();
    for (const f of files) {
      const slug = f.slice(0, -3);
      seen.add(slug);
      const path = join(decisionsDir, f);
      const doc = parseDecisionMd(readFileSync(path, 'utf8'));
      const title = doc.title || slug;
      const supersededBy =
        doc.status === 'superseded' ? (doc.supersededBy || '?') : (doc.supersededBy || null);
      const row = inDb.get(slug);
      if (row && row.content_hash === doc.hash &&
          (row.superseded_by ?? null) === (supersededBy ?? null)) continue;
      db.prepare(`DELETE FROM search_index WHERE kind='decision' AND ref = ?`).run(slug);
      db.prepare(
        `INSERT OR REPLACE INTO decisions (slug, title, path, content_hash, created, superseded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(slug, title, path, doc.hash, doc.created || null, supersededBy);
      db.prepare(
        `INSERT INTO search_index (kind, ref, title, body) VALUES ('decision', ?, ?, ?)`,
      ).run(slug, title, doc.indexBody);
    }
    for (const slug of inDb.keys()) {
      if (seen.has(slug)) continue;
      db.prepare(`DELETE FROM decisions WHERE slug = ?`).run(slug);
      db.prepare(`DELETE FROM search_index WHERE kind='decision' AND ref = ?`).run(slug);
    }

    // tasks: events are the change log
    const last = Number(
      (db.prepare(`SELECT value FROM meta WHERE key='fts_last_event_id'`).get() as
        { value: string } | undefined)?.value ?? '0',
    );
    const max = (db.prepare(`SELECT MAX(id) AS m FROM events`).get() as { m: number | null }).m ?? 0;
    if (max <= last) return;
    const ids = db.prepare(
      `SELECT DISTINCT task_id AS id FROM events WHERE id > ? AND task_id IS NOT NULL`,
    ).all(last) as { id: number }[];
    const getTask = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
    const getComments = db.prepare(`SELECT body FROM comments WHERE task_id = ? ORDER BY id`);
    for (const { id } of ids) {
      db.prepare(`DELETE FROM search_index WHERE kind='task' AND ref = ?`).run(String(id));
      const t = getTask.get(id) as { title: string; body: string | null; archived_at: number | null } | undefined;
      if (!t || t.archived_at) continue;
      const body = [t.body ?? '', ...(getComments.all(id) as { body: string }[]).map((c) => c.body)]
        .filter(Boolean).join('\n');
      db.prepare(
        `INSERT INTO search_index (kind, ref, title, body) VALUES ('task', ?, ?, ?)`,
      ).run(String(id), t.title, body);
    }
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('fts_last_event_id', ?)`)
      .run(String(max));
  })();
}
```

Add to `packages/core/src/index.ts`:

```ts
export * from './recall.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @kddkit/core exec vitest run test/recall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recall.ts packages/core/src/index.ts packages/core/test/recall.test.ts
git commit -m "feat(core): syncIndex - decisions by hash scan, tasks by event cursor"
```

---

### Task 5: recall + rebuild

**Files:**
- Modify: `packages/core/src/recall.ts`
- Test: `packages/core/test/recall.test.ts` (append)

**Interfaces:**
- Consumes: `syncIndex` (Task 4), `KddError`.
- Produces (used by CLI Tasks 6–7):
  - `interface RecallHit { kind: 'decision' | 'task'; ref: string; title: string; snippet: string; superseded_by: string; status: string | null }`
  - `recall(db, decisionsDir, query: string, opts?: { k?: number; kind?: 'decision' | 'task' }): RecallHit[]`
  - `rebuild(db, decisionsDir): { decisions: number; tasks: number }`
  - `sanitizeQuery(q: string): string` (exported for tests)

- [ ] **Step 1: Write the failing tests** — append to `packages/core/test/recall.test.ts` (extend the import from `../src/recall.js` with `recall, rebuild, sanitizeQuery`):

```ts
describe('recall', () => {
  it('finds a decision immediately after decide, ranked by BM25', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    addDecision(db, dir, { title: 'use fts5 for recall', decision: 'BM25 wins' });
    addTask(db, { title: 'unrelated chore' }, user);
    const hits = recall(db, dir, 'fts5');
    expect(hits.length).toBe(1);
    expect(hits[0].kind).toBe('decision');
    expect(hits[0].title).toBe('use fts5 for recall');
    expect(hits[0].snippet.length).toBeGreaterThan(0);
  });

  it('finds tasks and reports their status', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    addTask(db, { title: 'fix flux capacitor' }, user);
    const hits = recall(db, dir, 'capacitor');
    expect(hits[0].kind).toBe('task');
    expect(hits[0].status).toBe('new');
  });

  it('superseded decisions sort after active ones and carry the flag', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    const old = addDecision(db, dir, { title: 'polling approach', decision: 'poll the api' });
    addDecision(db, dir,
      { title: 'websocket approach', decision: 'poll no more, stream the api', supersedes: old.slug });
    const hits = recall(db, dir, 'api');
    expect(hits.length).toBe(2);
    expect(hits[0].superseded_by).toBe('');
    expect(hits[1].superseded_by).not.toBe('');
  });

  it('kind filter limits results', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    addDecision(db, dir, { title: 'shared word alpha', decision: 'alpha' });
    addTask(db, { title: 'alpha task' }, user);
    expect(recall(db, dir, 'alpha', { kind: 'decision' }).every((h) => h.kind === 'decision')).toBe(true);
    expect(recall(db, dir, 'alpha', { kind: 'task' }).every((h) => h.kind === 'task')).toBe(true);
  });

  it('k caps the result count', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    for (let i = 0; i < 5; i++) addTask(db, { title: `omega item ${i}` }, user);
    expect(recall(db, dir, 'omega', { k: 3 }).length).toBe(3);
  });

  it('raw FTS syntax cannot crash recall', () => {
    const db = openDb(':memory:', 'x');
    const dir = tmp();
    expect(() => recall(db, dir, 'AND OR ("* NEAR')).not.toThrow();
  });

  it('empty query throws KddError', () => {
    const db = openDb(':memory:', 'x');
    expect(() => recall(db, tmp(), '   ')).toThrow(/empty query/);
  });

  it('invalid kind throws KddError', () => {
    const db = openDb(':memory:', 'x');
    expect(() => recall(db, tmp(), 'q', { kind: 'bogus' as any })).toThrow(/kind/);
  });
});

describe('rebuild', () => {
  it('restores the full index from md files after db loss', () => {
    const db1 = openDb(':memory:', 'x');
    const dir = tmp();
    addDecision(db1, dir, { title: 'survives db loss', decision: 'md is truth' });
    addDecision(db1, dir, { title: 'second decision', decision: 'also survives' });
    db1.close();
    const db2 = openDb(':memory:', 'x'); // "deleted" db: brand new empty one
    addTask(db2, { title: 'a task too' }, user);
    const counts = rebuild(db2, dir);
    expect(counts).toEqual({ decisions: 2, tasks: 1 });
    expect(recall(db2, dir, 'survives').length).toBe(2);
  });
});

describe('sanitizeQuery', () => {
  it('quotes every token', () => {
    expect(sanitizeQuery('hello world')).toBe('"hello" "world"');
    expect(sanitizeQuery('say "hi"')).toBe('"say" """hi"""');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @kddkit/core exec vitest run test/recall.test.ts`
Expected: FAIL — `recall`/`rebuild`/`sanitizeQuery` not exported.

- [ ] **Step 3: Implement** — append to `packages/core/src/recall.ts` (add `import { KddError } from './errors.js';` at top):

```ts
export interface RecallHit {
  kind: 'decision' | 'task';
  ref: string;
  title: string;
  snippet: string;
  superseded_by: string; // '' when active
  status: string | null; // task status, null for decisions
}

export function sanitizeQuery(q: string): string {
  const tokens = q.split(/\s+/).filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`);
  if (tokens.length === 0) throw new KddError('empty query');
  return tokens.join(' ');
}

export function recall(
  db: Database.Database, decisionsDir: string, query: string,
  opts: { k?: number; kind?: 'decision' | 'task' } = {},
): RecallHit[] {
  if (opts.kind && opts.kind !== 'decision' && opts.kind !== 'task') {
    throw new KddError(`invalid kind '${opts.kind}'; allowed: decision, task`);
  }
  syncIndex(db, decisionsDir);
  return db.prepare(`
    SELECT search_index.kind AS kind, search_index.ref AS ref,
      search_index.title AS title,
      snippet(search_index, 3, '', '', '...', 12) AS snippet,
      COALESCE(d.superseded_by, '') AS superseded_by,
      t.status AS status
    FROM search_index
    LEFT JOIN decisions d ON search_index.kind = 'decision' AND d.slug = search_index.ref
    LEFT JOIN tasks t ON search_index.kind = 'task' AND t.id = CAST(search_index.ref AS INTEGER)
    WHERE search_index MATCH @q
      AND (@kind IS NULL OR search_index.kind = @kind)
    ORDER BY (COALESCE(d.superseded_by, '') <> ''),
      bm25(search_index, 0, 0, 3.0, 1.0)
    LIMIT @k
  `).all({ q: sanitizeQuery(query), kind: opts.kind ?? null, k: opts.k ?? 10 }) as RecallHit[];
}

export function rebuild(
  db: Database.Database, decisionsDir: string,
): { decisions: number; tasks: number } {
  db.transaction(() => {
    db.exec(`DELETE FROM search_index; DELETE FROM decisions;`);
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('fts_last_event_id', '0')`).run();
  })();
  syncIndex(db, decisionsDir);
  return {
    decisions: (db.prepare(`SELECT COUNT(*) c FROM decisions`).get() as { c: number }).c,
    tasks: (db.prepare(`SELECT COUNT(*) c FROM search_index WHERE kind='task'`).get() as
      { c: number }).c,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @kddkit/core exec vitest run test/recall.test.ts`
Expected: PASS. Then run the whole core suite: `pnpm --filter @kddkit/core exec vitest run`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/recall.ts packages/core/test/recall.test.ts
git commit -m "feat(core): recall with BM25 and sanitized queries; rebuild from md"
```

---

### Task 6: resolveDecisionsDir + CLI `kdd decide`

**Files:**
- Modify: `packages/core/src/paths.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/test/run.ts`
- Test: `packages/cli/test/recall-cli.test.ts`

**Interfaces:**
- Consumes: `addDecision` (Task 3).
- Produces: `resolveDecisionsDir(cwd?: string): string` in core (env `KDD_DECISIONS_DIR` override, else `<git toplevel>/.planning/decisions`); CLI command `kdd decide`.

- [ ] **Step 1: Update the CLI test env helper** — in `packages/cli/test/run.ts` replace `makeEnv`:

```ts
export function makeEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'kdd-cli-'));
  return {
    ...process.env,
    KDD_DB: join(dir, 'kdd.db'),
    KDD_DECISIONS_DIR: join(dir, 'decisions'),
    KDD_ACTOR: '',
  };
}
```

- [ ] **Step 2: Write the failing tests** — `packages/cli/test/recall-cli.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @kddkit/cli... build && pnpm --filter @kddkit/cli exec vitest run test/recall-cli.test.ts`
Expected: FAIL — `error: unknown command 'decide'`.

- [ ] **Step 4: Implement.** Append to `packages/core/src/paths.ts`:

```ts
export function resolveDecisionsDir(cwd: string = process.cwd()): string {
  if (process.env.KDD_DECISIONS_DIR) return process.env.KDD_DECISIONS_DIR;
  let top: string;
  try {
    top = execFileSync('git', ['rev-parse', '--show-toplevel'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    throw new KddError('not in a git repository (kdd resolves .planning via git)');
  }
  return join(top, '.planning', 'decisions');
}
```

In `packages/cli/src/index.ts`: extend the `@kddkit/core` import with `addDecision, resolveDecisionsDir` and add after the `add` command:

```ts
program.command('decide')
  .argument('<title>')
  .option('--decision <t>').option('--rationale <t>').option('--alternatives <t>')
  .option('--outcome <t>').option('--supersedes <slug>')
  .option('--body <md>', 'full md body, or "-" for stdin')
  .option('--body-file <path>')
  .option('--json')
  .action((title, o) => run(o.json, () => {
    const r = withDb((db) => addDecision(db, resolveDecisionsDir(), {
      title, decision: o.decision, rationale: o.rationale,
      alternatives: o.alternatives, outcome: o.outcome,
      supersedes: o.supersedes, body: readBody(o),
    }));
    out(o.json, r, () =>
      r.created ? `decided: ${r.slug}\n${r.path}` : `already recorded: ${r.slug}`);
  }));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @kddkit/cli... build && pnpm --filter @kddkit/cli exec vitest run test/recall-cli.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/paths.ts packages/cli/src/index.ts packages/cli/test/run.ts packages/cli/test/recall-cli.test.ts
git commit -m "feat(cli): kdd decide + resolveDecisionsDir"
```

---

### Task 7: CLI `kdd recall` + `kdd rebuild` + renderRecall with 4KB cap

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/render.ts`
- Test: `packages/cli/test/recall-cli.test.ts` (append)
- Test: `packages/cli/test/contracts.test.ts` (append)

**Interfaces:**
- Consumes: `recall`, `rebuild`, `RecallHit` (Task 5), `resolveDecisionsDir` (Task 6), `cap` from render.ts.
- Produces: `renderRecall(hits: RecallHit[]): string`; commands `kdd recall <query> [-k, --limit <n>] [--kind d|t] [--json]`, `kdd rebuild [--json]`.

- [ ] **Step 1: Write the failing tests.** Append to `packages/cli/test/recall-cli.test.ts`:

```ts
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
    const { rmSync } = require('node:fs') as typeof import('node:fs');
    rmSync(env.KDD_DB!);
    const out = kdd(env, 'rebuild');
    expect(out.trim()).toBe('rebuilt: 1 decisions, 0 tasks indexed');
    expect(kdd(env, 'recall', 'survives')).toContain('survives loss');
  });
});
```

Note: `recall-cli.test.ts` is ESM — instead of `require`, add `rmSync` to the top import: `import { readdirSync, rmSync } from 'node:fs';` and call it directly.

Append to `packages/cli/test/contracts.test.ts` (uses the same seeded-board helpers as existing contract tests — follow the file's existing pattern for creating many tasks):

```ts
  it('recall output stays under 4KB even with many fat hits', { timeout: 60_000 }, () => {
    const env = makeEnv();
    for (let i = 0; i < 30; i++) {
      kdd(env, 'add', `omega search target ${i} ${'lorem ipsum dolor '.repeat(10)}`);
    }
    const out = kdd(env, 'recall', 'omega', '-k', '30');
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(4096);
    expect(out).toMatch(/\(\+\d+ more, use -k\)/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @kddkit/cli... build && pnpm --filter @kddkit/cli exec vitest run`
Expected: FAIL — `unknown command 'recall'`.

- [ ] **Step 3: Implement.** Append to `packages/cli/src/render.ts` (extend the `@kddkit/core` type import with `RecallHit`):

```ts
const MAX_RECALL = 4096;

export function renderRecall(hits: RecallHit[]): string {
  if (hits.length === 0) return 'no results';
  const line = (h: RecallHit): string => {
    const snip = h.snippet.replace(/\s+/g, ' ').trim();
    if (h.kind === 'decision') {
      const tag = h.superseded_by ? ` [superseded by ${h.superseded_by}]` : '';
      return `decision ${h.ref}${tag} ${cap(h.title, 60)} — ${snip}`;
    }
    return `task #${h.ref} [${h.status ?? '?'}] ${cap(h.title, 60)} — ${snip}`;
  };
  const all = hits.map(line);
  const shown = [...all];
  while (shown.length > 1 &&
         Buffer.byteLength(shown.join('\n'), 'utf8') > MAX_RECALL - 32) {
    shown.pop();
  }
  if (shown.length < all.length) shown.push(`(+${all.length - shown.length} more, use -k)`);
  return shown.join('\n');
}
```

In `packages/cli/src/index.ts` extend the core import with `recall, rebuild` and the render import with `renderRecall`, then add:

```ts
program.command('recall')
  .argument('<query>')
  .option('-k, --limit <n>', 'max results', '10')
  .option('--kind <kind>', 'decision|task')
  .option('--json')
  .action((query, o) => run(o.json, () => {
    const hits = withDb((db) => recall(db, resolveDecisionsDir(), query,
      { k: Number(o.limit), kind: o.kind }));
    out(o.json, hits, () => renderRecall(hits));
  }));

program.command('rebuild')
  .option('--json')
  .action((o) => run(o.json, () => {
    const r = withDb((db) => rebuild(db, resolveDecisionsDir()));
    out(o.json, r, () => `rebuilt: ${r.decisions} decisions, ${r.tasks} tasks indexed`);
  }));
```

- [ ] **Step 4: Run the full suite**

Run: `pnpm --filter @kddkit/cli... build && pnpm --filter @kddkit/cli exec vitest run`
Expected: PASS (new tests + all Phase 1 CLI tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/index.ts packages/cli/src/render.ts packages/cli/test/recall-cli.test.ts packages/cli/test/contracts.test.ts
git commit -m "feat(cli): kdd recall and kdd rebuild with 4KB output contract"
```

---

### Task 8: Full verification + planning docs

**Files:**
- Modify: `.planning/REQUIREMENTS.md` (DEC checkboxes + traceability rows)
- Modify: `.planning/ROADMAP.md` (phase checkboxes + progress table)
- Modify: `.planning/STATE.md` (status lines)

- [ ] **Step 1: Full monorepo check**

Run from repo root: `pnpm test`
Expected: turbo builds core+cli, all test suites PASS.

- [ ] **Step 2: Manual smoke on the real repo**

```bash
node packages/cli/dist/index.js decide "smoke: phase 2 works" --decision "yes" --rationale "manual smoke"
node packages/cli/dist/index.js recall "smoke"
node packages/cli/dist/index.js rebuild
```

Expected: decision file appears in `.planning/decisions/`, recall finds it, rebuild prints counts. Then delete the smoke decision file and run `node packages/cli/dist/index.js rebuild` again (index drops it).

- [ ] **Step 3: Update planning docs**

- `.planning/REQUIREMENTS.md`: check `[x]` DEC-01, DEC-02, DEC-03; traceability rows DEC-01..03 → `Complete`.
- `.planning/ROADMAP.md`: mark `- [x]` Phase 1 AND Phase 2 in the phase list; progress table rows 1 and 2 → `Complete` with date 2026-07-14.
- `.planning/STATE.md`: completed_phases 2, percent 50, note "Phase 2 complete; ready to plan Phase 3 (web kanban)".

- [ ] **Step 4: Commit**

```bash
git add .planning
git commit -m "docs: mark phase 2 (decisions & recall) complete"
```

---

## Self-Review Notes

- Spec coverage: DEC-01 → Tasks 2, 3, 6; DEC-02 → Tasks 1, 4, 5, 7 (dedup in Task 3); DEC-03 → Tasks 5, 7 (rebuild core + CLI), md self-sufficiency tested in Task 5 rebuild test.
- Hash definition: `contentHash(title, body-below-title-line)` — frontmatter- and date-independent, matches the spec's intent (title + section bodies) since the rendered body IS the sections.
- Type consistency: `RecallHit` defined once in core (Task 5), consumed by render (Task 7). `DecisionInput` defined Task 2, consumed Tasks 3, 6.
- Windows: all paths via `node:path.join`; CLI tests use env overrides (`KDD_DB`, `KDD_DECISIONS_DIR`), no long argv (bodies are short).
