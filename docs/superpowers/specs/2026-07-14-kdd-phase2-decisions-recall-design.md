# KDD Phase 2 — Decisions & Recall: Design Spec

Date: 2026-07-14
Status: approved
Requirements: DEC-01, DEC-02, DEC-03 (.planning/REQUIREMENTS.md)
Depends on: Phase 1 (@kddkit/core, @kddkit/cli — SQLite store, state machine, CLI verbs)

## Goal

Project decisions live as committed markdown in `.planning/decisions/` and are
searchable alongside tasks via FTS5 BM25. The SQLite index is disposable:
`kdd rebuild` restores it from md files + existing task tables alone.

## Global Constraints

- No new runtime dependencies. FTS5 ships inside better-sqlite3.
- All new code in `@kddkit/core` (logic) and `@kddkit/cli` (commands), same
  patterns as Phase 1 (KddError, withDb, --json, fail()).
- Output contract: `kdd recall` output ≤ 4096 bytes, no emoji/banners,
  enforced by test (same style as CLI-05).
- Durable knowledge only in git-md; mutable state only in SQLite. The
  `decisions` table and `search_index` are derived caches, never the source
  of truth.
- Migration is appended to the existing `MIGRATIONS: string[]` array
  (`PRAGMA user_version` mechanism from Phase 1). Never edit migration 1.

## 1. Decision files

Path: `<repo-toplevel>/.planning/decisions/YYYY-MM-DD-<slug>.md` where
repo-toplevel = `git rev-parse --show-toplevel` of the current worktree
(decisions are per-checkout git content, unlike the shared DB).

Slug: from title — lowercase, non-alphanumeric runs → `-`, trimmed, max 60
chars. Collision on same day+slug: append `-2`, `-3`, …

File format:

```markdown
---
created: 2026-07-14
status: active
superseded_by:
---
# <title>

## Decision
<text or ->

## Rationale
<text or ->

## Alternatives
<text or ->

## Supersedes
<slug or ->

## Outcome
<text or ->
```

- `status`: `active` | `superseded`. `superseded_by`: slug of the newer
  decision (empty when active).
- Empty sections are written as `-` — the template is always complete.
- The md directory is self-sufficient: everything rebuild needs (title,
  sections, status, supersedes links) is in the files. GSD compatibility:
  GSD uses no `decisions/` subdirectory, so no collision.

## 2. Schema — migration 2

Appended to `MIGRATIONS`:

```sql
CREATE TABLE decisions (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created TEXT NOT NULL,
  superseded_by TEXT
);
CREATE INDEX idx_decisions_hash ON decisions(content_hash);

CREATE VIRTUAL TABLE search_index USING fts5(
  kind UNINDEXED,   -- 'decision' | 'task'
  ref UNINDEXED,    -- slug | task id as text
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Notes:

- `search_index` is a regular (content-storing) FTS5 table — snippets work,
  rows are managed explicitly by sync code. Not external-content, not
  contentless, no SQL triggers.
- `content_hash` = sha256 hex of the normalized decision content:
  `title + '\n' + the five section bodies` joined with `\n`, CRLF → LF,
  trimmed. Frontmatter and dates are excluded so the same decision written
  on another day still dedupes.
- `meta` table (Phase 1) gains one row: `fts_last_event_id` — the max
  `events.id` already reflected in the task index.

## 3. Sync — one code path

`syncIndex(db, decisionsDir)` in `@kddkit/core`, called by `recall` before
every search and by `rebuild` after reset:

**Decisions** (filesystem is the truth):
1. Read all `*.md` in `decisionsDir` (missing dir = zero decisions, not an
   error). Parse frontmatter, title, sections; compute content_hash.
2. Diff against `decisions` table by slug:
   - new file → insert row + insert `search_index` row
   - changed hash or changed status → delete old index row, reinsert both
   - row in DB without file → delete row + index row
3. Indexed body = Decision + Rationale + Alternatives + Outcome sections.

**Tasks** (events are the change log):
1. `SELECT DISTINCT task_id FROM events WHERE id > $fts_last_event_id`.
2. For each: delete its `search_index` row; if the task is not archived,
   reinsert with title and body = task body + all comment texts joined with
   `\n`. Archived tasks stay out of the index.
3. Update `meta.fts_last_event_id` to `MAX(events.id)`.

Whole sync runs in one transaction. Cost: a directory scan plus incremental
task updates — tens of ms at hundreds of files.

## 4. Core API (`@kddkit/core`, new module `decisions.ts` + `recall.ts`)

```ts
interface DecisionInput {
  title: string;
  decision?: string;
  rationale?: string;
  alternatives?: string;
  outcome?: string;
  supersedes?: string;   // slug
  body?: string;         // full md body; mutually exclusive with sections
}

// Returns { slug, path, created: boolean } — created=false means
// "already recorded" (content_hash matched an existing decision).
addDecision(db, decisionsDir, input, actor): { slug, path, created }

// --supersedes: rewrites old md frontmatter (status: superseded,
// superseded_by: <new-slug>) and updates its DB row. Unknown slug → KddError.

recall(db, decisionsDir, query, opts: { k?: number; kind?: 'decision'|'task' }):
  RecallHit[]
// RecallHit = { kind, ref, title, snippet, superseded: boolean }
// BM25 weights: title 3.0, body 1.0. Superseded hits sort after active ones.
// Query is sanitized: split on whitespace, each token double-quoted, joined
// with spaces (implicit AND) — raw FTS5 syntax cannot crash the CLI.

rebuild(db, decisionsDir): { decisions: number; tasks: number }
// DELETE FROM search_index & decisions, reset fts_last_event_id to 0,
// run syncIndex. Returns counts for display.
```

`addDecision` writes NO event row: the Phase 1 `events.action` CHECK does not
include `'decide'`, and extending a CHECK in SQLite means rebuilding the
table — not justified by any DEC requirement. Decisions are visible via
recall; add a decide event (with the table rebuild) only if a later phase
needs decisions in `kdd status`.

## 5. CLI commands (`@kddkit/cli`)

```
kdd decide "title" [--decision t] [--rationale t] [--alternatives t]
                   [--outcome t] [--supersedes slug]
                   [--body md | --body-file path | --body-file -]
kdd recall "query" [-k N] [--kind decision|task] [--json]
kdd rebuild [--json]
```

- `decide` created → `decided: <slug>` + path; duplicate →
  `already recorded: <slug>` (exit 0 both ways).
- `recall` default k=10, one line per hit:
  - `decision <slug> <title> — <snippet>`
  - `task #<id> [<status>] <title> — <snippet>`
  - superseded: `decision <slug> [superseded by <new-slug>] <title> — …`
  - no hits → `no results` (exit 0). Total output capped at 4096 bytes
    (truncate hits from the end, append `(+N more, use -k)`).
- `rebuild` → `rebuilt: N decisions, M tasks indexed`.
- Errors follow Phase 1 contract: `error: <msg>` on stderr, exit 1,
  `{"error": ...}` with `--json`.

## 6. Testing

Core (vitest, in-memory/tmp dirs):
- decide creates md with all sections + frontmatter; slug collision appends `-2`
- same content twice → created=false, one file, one row
- supersedes: old md frontmatter updated, old hit flagged and sorted last
- recall finds a decision immediately after decide (no explicit rebuild)
- auto-sync: md dropped into the dir by hand is found by next recall;
  deleted md disappears from results
- task events (add/edit/comment) make tasks findable; archive removes them
- query sanitizer: `recall 'AND OR ("'` does not throw
- rebuild after deleting the DB restores every decision from md alone

CLI (spawned dist, same harness as Phase 1):
- decide → recall roundtrip via real processes
- recall output ≤ 4096 bytes on a seeded board (contract test)
- rebuild counts line format

## Out of scope (deferred per REQUIREMENTS v2)

- Embeddings/vector search, MMR/recency ranking (V2-02)
- Editing/deleting decisions via CLI (files are edited by hand; sync picks it up)
- Watching the filesystem; sync is pull-based on recall/rebuild only
