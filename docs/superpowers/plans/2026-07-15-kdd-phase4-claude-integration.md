# KDD Phase 4 — Claude Integration & Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a thin MCP server over the existing KDD core plus the Claude Code plugin (manifest, MCP, SessionStart hook, skill) so Claude uses the substrate automatically and the whole thing installs on Windows.

**Architecture:** New workspace package `packages/mcp` (`@kddkit/mcp`) exposes 4 tools (`get_task`, `list_tasks`, `recall`, `update_task`) over `@kddkit/core`, always attributing `actor=ai`. Pure handler functions are tested against a `:memory:` DB (mirroring the ui `app.request()` pattern); a thin `server.ts` wires `McpServer` + `StdioServerTransport`. The repo root becomes the plugin (manifest + `.mcp.json` + `hooks/` + `skills/`), the MCP server is launched as a self-contained bundle (core+sdk+zod bundled in, only native `better-sqlite3` external, installed on first SessionStart).

**Tech Stack:** Node >=22, TypeScript, `@modelcontextprotocol/sdk` (1.x), `zod`, `better-sqlite3` (external), tsup, vitest 4, pnpm + turbo.

## Global Constraints

- Node >= 22; one runtime across CLI/MCP/UI.
- MCP is exactly 4 tools: `get_task`, `list_tasks`, `recall`, `update_task`. No create/archive/link/decide/batch via MCP.
- `list_tasks` returns compact rows **without** `body`; `recall` is top-k capped (default k=10).
- MCP actor is always `{ type: 'ai', id: process.env.KDD_SESSION ?? 'mcp' }`.
- Every MCP mutation goes through existing `@kddkit/core` ops, so the `events` trail matches the CLI.
- SessionStart pointer ≤ 3 lines; the hook **always exits 0**; failures are recorded in the `errors` table (source `session-start`), or a fallback file when the DB is unreachable.
- Windows-compatible: `${CLAUDE_PLUGIN_ROOT}`, node scripts (not bash), `npm --prefix` for installs.
- `better-sqlite3` pinned to `^12.11.1` (matches `@kddkit/core`).
- No emoji/banners in machine-facing output. No commit-attribution trailers.
- Distribution: self-contained plugin now (commit `dist` for core/cli/mcp); npm publish deferred.

## File Structure

- `packages/mcp/package.json` — new package `@kddkit/mcp`.
- `packages/mcp/tsconfig.json` — extends base.
- `packages/mcp/tsup.config.ts` — bundles core+sdk+zod, externalizes `better-sqlite3`.
- `packages/mcp/vitest.config.ts` — plain vitest config.
- `packages/mcp/src/handlers.ts` — pure tool logic (`getTask`, `listTasks`, `recallTool`, `updateTask`).
- `packages/mcp/src/server.ts` — `createServer(db, dir, actor)` + `startServer()` (no auto-run).
- `packages/mcp/src/main.ts` — bin entry: calls `startServer()`.
- `packages/mcp/test/handlers.test.ts` — handler tests over `:memory:`.
- `packages/mcp/test/server.test.ts` — in-memory-transport smoke.
- `packages/core/src/errors.ts` — add `logError(db, source, message)`.
- `scripts/smart-install.mjs` — ensures `better-sqlite3` in plugin root.
- `scripts/session-start.mjs` — ≤3-line pointer; logs failures.
- `scripts/test/hooks.test.ts` — spawn tests for the two scripts (lives in `packages/mcp/test/` to reuse its vitest).
- `.claude-plugin/plugin.json` — manifest.
- `.mcp.json` — MCP server registration.
- `hooks/hooks.json` — SessionStart.
- `skills/kdd/SKILL.md` — protocol contract.
- `.gitignore` — un-ignore `packages/{core,cli,mcp}/dist`.
- `.planning/REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md` — mark Phase 4 complete.

---

### Task 1: Scaffold `@kddkit/mcp` and read handlers (`get_task`, `list_tasks`)

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/tsup.config.ts`
- Create: `packages/mcp/vitest.config.ts`
- Create: `packages/mcp/src/handlers.ts`
- Test: `packages/mcp/test/handlers.test.ts`

**Interfaces:**
- Consumes from `@kddkit/core`: `boardData(db, {status?, area?})`, `taskDetail(db, id)`, `mustGetTask(db, id)`, types `Status`, `Priority`, `Actor`.
- Produces: `getTask(db, id): TaskDetail`, `listTasks(db, filter): Record<string, TaskRow[]>`, where `TaskRow = { id: number; title: string; status: string; priority: string; blocked: boolean }`.

- [ ] **Step 1: Create the package manifest**

`packages/mcp/package.json`:

```json
{
  "name": "@kddkit/mcp",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/main.js",
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@kddkit/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.18.0",
    "better-sqlite3": "^12.11.1",
    "tsup": "^8.5.1",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Create tsconfig, tsup config, vitest config**

`packages/mcp/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`packages/mcp/tsup.config.ts` (bundle everything except the native binary so the plugin runs without workspace `node_modules`):

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  clean: true,
  noExternal: ['@kddkit/core', '@modelcontextprotocol/sdk', 'zod'],
  external: ['better-sqlite3'], // native .node — installed by smart-install
});
```

`packages/mcp/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: {} });
```

- [ ] **Step 3: Install dependencies and build core**

Run:

```
pnpm install
pnpm --filter @kddkit/core build
```

Expected: install completes; `packages/core/dist/index.js` exists (mcp tests import `@kddkit/core` via its built `main`).

- [ ] **Step 4: Write the failing test**

`packages/mcp/test/handlers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addTask, openDb } from '@kddkit/core';
import { getTask, listTasks } from '../src/handlers.js';

const user = { type: 'user' } as const;
const mk = () => openDb(':memory:', 'x');

describe('getTask', () => {
  it('returns detail with comments and events', () => {
    const db = mk();
    const t = addTask(db, { title: 'detail me' }, user);
    const d = getTask(db, t.id);
    expect(d.task.title).toBe('detail me');
    expect(Array.isArray(d.comments)).toBe(true);
    expect(d.events.length).toBe(1);
  });

  it('unknown id throws not found', () => {
    const db = mk();
    expect(() => getTask(db, 999)).toThrow(/not found/);
  });
});

describe('listTasks', () => {
  it('groups compact rows by status and omits body', () => {
    const db = mk();
    addTask(db, { title: 'a', body: 'secret body', priority: 'high' }, user);
    const board = listTasks(db);
    expect(Object.keys(board)).toEqual(['backlog', 'new', 'in_progress', 'review', 'done']);
    expect(board.new).toEqual([
      { id: 1, title: 'a', status: 'new', priority: 'high', blocked: false },
    ]);
    expect(JSON.stringify(board)).not.toContain('secret body');
  });

  it('filters by status', () => {
    const db = mk();
    addTask(db, { title: 'a' }, user);
    expect(listTasks(db, { status: 'in_progress' }).in_progress).toEqual([]);
    expect(listTasks(db, { status: 'new' }).new.length).toBe(1);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm --filter @kddkit/mcp exec vitest run`
Expected: FAIL — `../src/handlers.js` cannot be resolved (module missing).

- [ ] **Step 6: Implement the read handlers**

`packages/mcp/src/handlers.ts`:

```ts
import type Database from 'better-sqlite3';
import { boardData, taskDetail, type Status } from '@kddkit/core';

export interface TaskRow {
  id: number;
  title: string;
  status: string;
  priority: string;
  blocked: boolean;
}

export function getTask(db: Database.Database, id: number) {
  return taskDetail(db, id);
}

export function listTasks(
  db: Database.Database,
  filter: { status?: Status; area?: string } = {},
): Record<string, TaskRow[]> {
  const board = boardData(db, filter);
  const out: Record<string, TaskRow[]> = {};
  for (const [status, tasks] of Object.entries(board)) {
    out[status] = tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status,
      priority: t.priority, blocked: !!t.blocked,
    }));
  }
  return out;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @kddkit/mcp exec vitest run`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/mcp pnpm-lock.yaml
git commit -m "feat: @kddkit/mcp package with get_task/list_tasks handlers"
```

---

### Task 2: Write handlers (`recall`, `update_task`)

**Files:**
- Modify: `packages/mcp/src/handlers.ts`
- Test: `packages/mcp/test/handlers.test.ts`

**Interfaces:**
- Consumes from `@kddkit/core`: `recall(db, dir, query, {k?, kind?})`, `editTask`, `moveTask`, `commentTask`, `mustGetTask`, `KddError`, types `Actor`, `Priority`, `Status`.
- Produces:
  - `recallTool(db, dir, query, opts): RecallHit[]`
  - `updateTask(db, input: UpdateInput, actor): Task`, where
    `UpdateInput = { id: number; edit?: { title?; body?; priority?: Priority; area? }; move?: { to: string; reason?: string }; comment?: string }`.

- [ ] **Step 1: Write the failing test (append to `handlers.test.ts`)**

```ts
import { recallTool, updateTask } from '../src/handlers.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ai = { type: 'ai', id: 'sess-1' } as const;
const emptyDir = () => mkdtempSync(join(tmpdir(), 'kdd-mcp-'));

describe('recallTool', () => {
  it('finds a task by title', () => {
    const db = openDb(':memory:', 'x');
    addTask(db, { title: 'quantum widget' }, { type: 'user' });
    const hits = recallTool(db, emptyDir(), 'quantum', {});
    expect(hits.some((h) => h.kind === 'task' && /quantum/.test(h.title))).toBe(true);
  });
});

describe('updateTask', () => {
  it('edit records an ai event', () => {
    const db = openDb(':memory:', 'x');
    const t = addTask(db, { title: 'old' }, { type: 'user' });
    const u = updateTask(db, { id: t.id, edit: { title: 'new', priority: 'urgent' } }, ai);
    expect([u.title, u.priority]).toEqual(['new', 'urgent']);
    const ev = db.prepare(`SELECT actor_type, action FROM events WHERE task_id=? ORDER BY id`).all(t.id);
    expect(ev).toEqual([
      { actor_type: 'user', action: 'created' },
      { actor_type: 'ai', action: 'edited' },
    ]);
  });

  it('move follows the state machine and records ai event', () => {
    const db = openDb(':memory:', 'x');
    const t = addTask(db, { title: 'm' }, { type: 'user' });
    const u = updateTask(db, { id: t.id, move: { to: 'in_progress' } }, ai);
    expect(u.status).toBe('in_progress');
  });

  it('comment is attributed to ai session', () => {
    const db = openDb(':memory:', 'x');
    const t = addTask(db, { title: 'c' }, { type: 'user' });
    updateTask(db, { id: t.id, comment: 'progress note' }, ai);
    const c = db.prepare(`SELECT author, body FROM comments WHERE task_id=?`).get(t.id);
    expect(c).toEqual({ author: 'ai:sess-1', body: 'progress note' });
  });

  it('applies edit, move and comment together', () => {
    const db = openDb(':memory:', 'x');
    const t = addTask(db, { title: 'x' }, { type: 'user' });
    const u = updateTask(db,
      { id: t.id, edit: { body: 'b' }, move: { to: 'in_progress' }, comment: 'go' }, ai);
    expect(u.status).toBe('in_progress');
    expect(u.body).toBe('b');
  });

  it('empty update throws', () => {
    const db = openDb(':memory:', 'x');
    const t = addTask(db, { title: 'x' }, { type: 'user' });
    expect(() => updateTask(db, { id: t.id }, ai)).toThrow(/nothing to update/);
  });

  it('invalid move surfaces the state-machine error', () => {
    const db = openDb(':memory:', 'x');
    const t = addTask(db, { title: 'x' }, { type: 'user' });
    expect(() => updateTask(db, { id: t.id, move: { to: 'done' } }, ai)).toThrow(/invalid transition/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kddkit/mcp exec vitest run`
Expected: FAIL — `recallTool` / `updateTask` are not exported.

- [ ] **Step 3: Implement the write handlers (append to `handlers.ts`)**

Add imports at the top of `handlers.ts` (merge with the existing import line):

```ts
import {
  boardData, taskDetail, recall, editTask, moveTask, commentTask, mustGetTask,
  KddError, type Actor, type Priority, type Status,
} from '@kddkit/core';
```

Append:

```ts
export function recallTool(
  db: Database.Database, dir: string, query: string,
  opts: { k?: number; kind?: 'decision' | 'task' } = {},
) {
  return recall(db, dir, query, opts);
}

export interface UpdateInput {
  id: number;
  edit?: { title?: string; body?: string; priority?: Priority; area?: string };
  move?: { to: string; reason?: string };
  comment?: string;
}

export function updateTask(db: Database.Database, input: UpdateInput, actor: Actor) {
  if (!input.edit && !input.move && !input.comment) {
    throw new KddError('nothing to update');
  }
  let task = mustGetTask(db, input.id); // validates existence up front
  if (input.edit) task = editTask(db, input.id, input.edit, actor);
  if (input.move) task = moveTask(db, input.id, input.move.to, actor, input.move.reason);
  if (input.comment) commentTask(db, input.id, input.comment, actor);
  return mustGetTask(db, input.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @kddkit/mcp exec vitest run`
Expected: PASS (all handler tests).

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/handlers.ts packages/mcp/test/handlers.test.ts
git commit -m "feat: recall and update_task handlers"
```

---

### Task 3: `logError` in core + MCP server wiring + transport smoke

**Files:**
- Modify: `packages/core/src/errors.ts`
- Test: `packages/core/test/errors.test.ts` (create)
- Create: `packages/mcp/src/server.ts`
- Create: `packages/mcp/src/main.ts`
- Test: `packages/mcp/test/server.test.ts`

**Interfaces:**
- Produces from core: `logError(db, source: string, message: string): void` — inserts one row into `errors`.
- Produces from mcp: `createServer(db, dir, actor): McpServer`, `startServer(): Promise<void>`.

- [ ] **Step 1: Write the failing test for `logError`**

`packages/core/test/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb, logError } from '../src/index.js';

describe('logError', () => {
  it('records a row in the errors table', () => {
    const db = openDb(':memory:', 'x');
    logError(db, 'mcp', 'boom');
    const row = db.prepare(`SELECT source, message FROM errors`).get();
    expect(row).toEqual({ source: 'mcp', message: 'boom' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kddkit/core exec vitest run test/errors.test.ts`
Expected: FAIL — `logError` is not exported.

- [ ] **Step 3: Implement `logError`**

`packages/core/src/errors.ts` (full new content):

```ts
import type Database from 'better-sqlite3';
import { now } from './db.js';

export class KddError extends Error {}

export function logError(db: Database.Database, source: string, message: string): void {
  db.prepare(`INSERT INTO errors (source, message, created_at) VALUES (?, ?, ?)`)
    .run(source, message, now());
}
```

- [ ] **Step 4: Run it, rebuild core, verify pass**

Run:

```
pnpm --filter @kddkit/core exec vitest run test/errors.test.ts
pnpm --filter @kddkit/core build
```

Expected: test PASS; core rebuilt so `@kddkit/mcp` sees `logError`.

- [ ] **Step 5: Write the failing smoke test**

`packages/mcp/test/server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addTask, openDb } from '@kddkit/core';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';

const ai = { type: 'ai', id: 'smoke' } as const;

async function connect(db: ReturnType<typeof openDb>) {
  const dir = mkdtempSync(join(tmpdir(), 'kdd-mcp-'));
  const server = createServer(db, dir, ai);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientT);
  return client;
}

const textOf = (res: any) => JSON.parse(res.content[0].text);

describe('mcp server over a real transport', () => {
  it('lists the four tools', async () => {
    const client = await connect(openDb(':memory:', 'x'));
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['get_task', 'list_tasks', 'recall', 'update_task']);
  });

  it('list_tasks returns grouped rows', async () => {
    const db = openDb(':memory:', 'x');
    addTask(db, { title: 'hello' }, { type: 'user' });
    const client = await connect(db);
    const res = await client.callTool({ name: 'list_tasks', arguments: {} });
    expect(textOf(res).new[0].title).toBe('hello');
  });

  it('update_task mutates and reports isError on bad input', async () => {
    const db = openDb(':memory:', 'x');
    const t = addTask(db, { title: 'm' }, { type: 'user' });
    const client = await connect(db);
    const ok = await client.callTool({
      name: 'update_task', arguments: { id: t.id, move: { to: 'in_progress' } },
    });
    expect(textOf(ok).status).toBe('in_progress');
    const bad = await client.callTool({
      name: 'update_task', arguments: { id: t.id, move: { to: 'done' } },
    });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/invalid transition/);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @kddkit/mcp exec vitest run test/server.test.ts`
Expected: FAIL — `../src/server.js` missing.

- [ ] **Step 7: Implement the server**

`packages/mcp/src/server.ts`:

```ts
import type Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  KddError, logError, openDb, resolveDbPath, resolveDecisionsDir,
  PRIORITIES, STATUSES, type Actor, type Status,
} from '@kddkit/core';
import * as h from './handlers.js';

type Result = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (data: unknown): Result => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });

function guard(db: Database.Database, fn: () => unknown): Result {
  try {
    return ok(fn());
  } catch (e) {
    if (e instanceof KddError) {
      return { content: [{ type: 'text', text: e.message }], isError: true };
    }
    logError(db, 'mcp', String(e));
    return { content: [{ type: 'text', text: 'internal error' }], isError: true };
  }
}

// zod's z.enum needs a non-empty tuple; the core arrays are validated at runtime.
const statusEnum = z.enum(STATUSES as [Status, ...Status[]]);
const priorityEnum = z.enum(PRIORITIES as [string, ...string[]]);

export function createServer(db: Database.Database, dir: string, actor: Actor): McpServer {
  const server = new McpServer({ name: 'kdd', version: '0.1.0' });

  server.registerTool('get_task',
    {
      description: 'Full task with comments, events and links',
      inputSchema: { id: z.number().int().positive() },
    },
    async ({ id }) => guard(db, () => h.getTask(db, id)));

  server.registerTool('list_tasks',
    {
      description: 'Compact board rows grouped by status (no body)',
      inputSchema: { status: statusEnum.optional(), area: z.string().optional() },
    },
    async (a) => guard(db, () => h.listTasks(db, a)));

  server.registerTool('recall',
    {
      description: 'FTS5 search over decisions and tasks, top-k',
      inputSchema: {
        query: z.string(),
        k: z.number().int().positive().optional(),
        kind: z.enum(['decision', 'task']).optional(),
      },
    },
    async ({ query, k, kind }) => guard(db, () => h.recallTool(db, dir, query, { k, kind })));

  server.registerTool('update_task',
    {
      description: 'Edit, move and/or comment a single task (actor=ai)',
      inputSchema: {
        id: z.number().int().positive(),
        edit: z.object({
          title: z.string().optional(), body: z.string().optional(),
          priority: priorityEnum.optional(), area: z.string().optional(),
        }).optional(),
        move: z.object({ to: statusEnum, reason: z.string().optional() }).optional(),
        comment: z.string().optional(),
      },
    },
    async (a) => guard(db, () => h.updateTask(db, a as h.UpdateInput, actor)));

  return server;
}

export async function startServer(): Promise<void> {
  const { dbPath, projectPath } = resolveDbPath();
  const db = openDb(dbPath, projectPath);
  const dir = resolveDecisionsDir();
  const actor: Actor = { type: 'ai', id: process.env.KDD_SESSION ?? 'mcp' };
  await createServer(db, dir, actor).connect(new StdioServerTransport());
}
```

`packages/mcp/src/main.ts`:

```ts
import { startServer } from './server.js';

startServer().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
```

- [ ] **Step 8: Run the smoke test to verify it passes**

Run: `pnpm --filter @kddkit/mcp exec vitest run`
Expected: PASS (handlers + server smoke). If the SDK's `registerTool` shape differs from the installed version, adjust to the installed types — the smoke test is the gate.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/errors.ts packages/core/test/errors.test.ts packages/mcp/src
git add packages/mcp/test/server.test.ts
git commit -m "feat: mcp server wiring, error mapping, logError, transport smoke"
```

---

### Task 4: SessionStart scripts (`smart-install`, `session-start`)

**Files:**
- Create: `scripts/smart-install.mjs`
- Create: `scripts/session-start.mjs`
- Test: `packages/mcp/test/hooks.test.ts`

**Interfaces:**
- `session-start.mjs`: reads `KDD_DB` (or resolves via git), prints ≤3 lines, always exits 0; on a reachable DB logs failures to `errors` (source `session-start`).
- `smart-install.mjs`: exits 0; installs `better-sqlite3` only when it does not resolve.

- [ ] **Step 1: Write the failing test**

`packages/mcp/test/hooks.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kddkit/mcp exec vitest run test/hooks.test.ts`
Expected: FAIL — scripts do not exist (`execFileSync` throws ENOENT).

- [ ] **Step 3: Implement `session-start.mjs`**

`scripts/session-start.mjs`:

```js
// SessionStart pointer for KDD. Never throws; always exits 0.
// Prints <=3 lines; records failures in the errors table when the db is reachable.
import { createRequire } from 'node:module';

const POINTER = 'KDD substrate active. Tools: list_tasks, recall (MCP). Board UI: kdd ui.';

async function main() {
  let core;
  try {
    const require = createRequire(import.meta.url);
    // resolve @kddkit/core relative to this plugin root
    core = await import(require.resolve('@kddkit/core'));
  } catch {
    console.log(POINTER); // core not installed yet — bare pointer
    return;
  }

  let db;
  try {
    const { dbPath, projectPath } = core.resolveDbPath();
    db = core.openDb(dbPath, projectPath);
  } catch {
    console.log(POINTER); // no db (not a git repo / unusable path)
    return;
  }

  try {
    const d = core.statusDigest(db);
    const parts = [];
    if (d.in_progress.length) parts.push(`${d.in_progress.length} in progress`);
    if (d.blocked.length) parts.push(`${d.blocked.length} blocked`);
    console.log(POINTER);
    if (parts.length) console.log(parts.join(', ') + '. Run kdd status for detail.');
  } catch (e) {
    try { core.logError(db, 'session-start', String(e)); } catch { /* ignore */ }
    console.log(POINTER);
  }
}

main().finally(() => process.exit(0));
```

- [ ] **Step 4: Implement `smart-install.mjs`**

`scripts/smart-install.mjs`:

```js
// Ensures the native better-sqlite3 binary is present in the plugin root.
// Idempotent; exits 0 even on failure (failure logged to a fallback file).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const VERSION = '^12.11.1'; // must match @kddkit/core
const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function resolves() {
  try {
    createRequire(import.meta.url).resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}

if (!resolves()) {
  try {
    execFileSync('npm', ['install', `better-sqlite3@${VERSION}`, '--prefix', pluginRoot],
      { stdio: 'ignore', shell: process.platform === 'win32' });
  } catch (e) {
    try {
      appendFileSync(join(pluginRoot, '.kdd-install-error.log'),
        `${new Date().toISOString()} ${String(e)}\n`);
    } catch { /* ignore */ }
  }
}
process.exit(0);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @kddkit/mcp exec vitest run test/hooks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/smart-install.mjs scripts/session-start.mjs packages/mcp/test/hooks.test.ts
git commit -m "feat: SessionStart smart-install and pointer scripts"
```

---

### Task 5: Plugin files (manifest, `.mcp.json`, hooks, skill)

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.mcp.json`
- Create: `hooks/hooks.json`
- Create: `skills/kdd/SKILL.md`
- Test: `packages/mcp/test/plugin.test.ts`

**Interfaces:** none (static config + docs). The test asserts the files exist and parse.

- [ ] **Step 1: Write the failing test**

`packages/mcp/test/plugin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('plugin files', () => {
  it('manifest names the plugin kdd', () => {
    expect(JSON.parse(read('.claude-plugin/plugin.json')).name).toBe('kdd');
  });

  it('.mcp.json registers the kdd server via CLAUDE_PLUGIN_ROOT', () => {
    const mcp = JSON.parse(read('.mcp.json'));
    const kdd = mcp.mcpServers.kdd;
    expect(kdd.command).toBe('node');
    expect(kdd.args.join(' ')).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(kdd.args.join(' ')).toContain('packages/mcp/dist/main.js');
  });

  it('hooks.json wires SessionStart to both scripts', () => {
    const hooks = JSON.parse(read('hooks/hooks.json'));
    const cmd = hooks.hooks.SessionStart[0].hooks[0].command;
    expect(cmd).toContain('smart-install.mjs');
    expect(cmd).toContain('session-start.mjs');
  });

  it('skill declares the kdd contract with an Iron Law', () => {
    const skill = read('skills/kdd/SKILL.md');
    expect(skill).toMatch(/^name:\s*kdd/m);
    expect(skill).toMatch(/Iron Law/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @kddkit/mcp exec vitest run test/plugin.test.ts`
Expected: FAIL — files do not exist.

- [ ] **Step 3: Create the manifest**

`.claude-plugin/plugin.json`:

```json
{
  "name": "kdd",
  "version": "0.1.0",
  "description": "Kanban + memory substrate for humans and Claude: task board, decisions and project context that survive sessions, branches and worktrees.",
  "author": { "name": "kddkit" },
  "license": "MIT",
  "keywords": ["kanban", "memory", "tasks", "decisions", "mcp", "substrate"]
}
```

- [ ] **Step 4: Create `.mcp.json`**

`.mcp.json`:

```json
{
  "mcpServers": {
    "kdd": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/packages/mcp/dist/main.js"]
    }
  }
}
```

- [ ] **Step 5: Create `hooks/hooks.json`**

`hooks/hooks.json`:

```json
{
  "description": "KDD substrate SessionStart pointer and native-dep install",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/smart-install.mjs\" && node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs\"",
            "timeout": 300
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: Create the skill**

`skills/kdd/SKILL.md`:

```markdown
---
name: kdd
description: Use when working in a project that has a KDD board — to check current tasks, record progress, move tasks through the board, or recall past decisions. KDD is the substrate that stores tasks, decisions and project context outside the context window, pulled on demand and shared across every worktree.
---

# KDD — task & memory substrate

KDD keeps the project's task board, decisions and context in a store outside the
context window. You reach it through MCP tools (writes are attributed to you,
`ai`, automatically) and, for the human, a CLI and web board.

## Pull protocol

- At the start of a task, **pull** what you need: `list_tasks` for the board,
  `recall "<topic>"` for past decisions and related tasks. Do not try to hold the
  whole board in context — fetch on demand.
- Before proposing an approach that touches an earlier decision, `recall` it
  first so you do not contradict what was already decided.

## Writing to the board

- Record progress as you go: `update_task { id, comment: "<what happened>" }`.
- Move a task when its state changes: `update_task { id, move: { to: "<status>" } }`.
  Valid statuses: backlog, new, in_progress, review, done. A move that skips the
  normal flow needs `move.reason` explaining that the user asked for it.
- Edit a task's fields with `update_task { id, edit: { ... } }`.
- `get_task { id }` returns the full task with its comments and event trail.

## Decisions

Recording a project decision is deliberate and human-gated: propose the
decision to the user; it is written with `kdd decide` (by the user, or by you via
the CLI only when the user asked). Decisions are **not** an MCP tool.

## Iron Law

**Never make mass or destructive board edits without an explicit user request.**
Creating, archiving, linking and bulk changes are intentionally not available as
MCP tools — they stay with the human via the CLI. Touch one task at a time, in
response to a real request, and record what you did.
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @kddkit/mcp exec vitest run test/plugin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add .claude-plugin/plugin.json .mcp.json hooks/hooks.json skills/kdd/SKILL.md
git add packages/mcp/test/plugin.test.ts
git commit -m "feat: claude code plugin manifest, mcp registration, SessionStart hook, kdd skill"
```

---

### Task 6: Distribution wiring (commit dist) + planning docs

**Files:**
- Modify: `.gitignore`
- Modify: `.planning/REQUIREMENTS.md`
- Modify: `.planning/ROADMAP.md`
- Modify: `.planning/STATE.md`
- Build artifacts: `packages/{core,cli,mcp}/dist/**`

- [ ] **Step 1: Un-ignore the shipped dist directories**

`.gitignore` (full new content):

```
.claude-flow/
node_modules/
dist/
.turbo/
.superpowers/
!packages/core/dist/
!packages/cli/dist/
!packages/mcp/dist/
```

- [ ] **Step 2: Build everything and verify the MCP bundle**

Run:

```
pnpm build
```

Expected: turbo builds all packages. Confirm the bundle exists and keeps `better-sqlite3` external:

```
node -e "const fs=require('fs');const s=fs.readFileSync('packages/mcp/dist/main.js','utf8');if(!/better-sqlite3/.test(s))throw new Error('better-sqlite3 should stay an external import');console.log('mcp bundle ok')"
```

Expected: prints `mcp bundle ok`.

- [ ] **Step 3: Verify the dist files are no longer ignored**

Run: `git check-ignore packages/mcp/dist/main.js || echo "not ignored"`
Expected: prints `not ignored`.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: all packages green (core, cli, ui, mcp).

- [ ] **Step 5: Update `.planning/REQUIREMENTS.md`**

Change the four INT rows in the checklist from `[ ]` to `[x]` (lines for INT-01..04), and in the Traceability table change the four `Phase 4 | Pending` rows to `Phase 4 | Complete`.

- [ ] **Step 6: Update `.planning/ROADMAP.md`**

- Change `- [ ] **Phase 4: Claude Integration & Packaging**` to `- [x] ...`.
- In the Progress table, change the Phase 4 row to `| 4. Claude Integration & Packaging | 1/1 | Complete | 2026-07-15 |`.

- [ ] **Step 7: Update `.planning/STATE.md`**

- Frontmatter: `completed_phases: 4`, `total_plans: 4`, `completed_plans: 4`, `percent: 100`.
- Current Position: `Phase: 4 of 4 (Claude Integration & Packaging) — DONE`, status line noting all v1 requirements complete.

- [ ] **Step 8: Commit**

```bash
git add .gitignore packages/core/dist packages/cli/dist packages/mcp/dist .planning
git commit -m "chore: ship built dist for plugin distribution; mark phase 4 complete"
```

---

## Self-Review

**Spec coverage:**
- INT-01 (thin MCP, 4 tools, same event trail) → Tasks 1–3 (handlers + server + smoke; ai events asserted).
- INT-02 (skill contract: pull protocol, comment/decide, Iron Law) → Task 5 `SKILL.md`.
- INT-03 (SessionStart ≤3 lines, exits 0, failures→errors) → Task 4 scripts + tests; `logError` in Task 3.
- INT-04 (installs as plugin, Windows) → Tasks 5 (manifest/.mcp.json/hooks) + 6 (committed dist, bundle verification); `npm --prefix` + `${CLAUDE_PLUGIN_ROOT}` for Windows.
- Self-contained bundle / native dep via smart-install → Task 1 `tsup.config.ts` (external better-sqlite3) + Task 4 `smart-install.mjs`.

**Placeholder scan:** no TBD/TODO; every code step has full file content or a full append with its merge point stated.

**Type consistency:** `TaskRow`, `UpdateInput` defined in Task 1/2 and reused in Task 3's server via `h.UpdateInput`. `logError(db, source, message)` defined in Task 3 and reused by `session-start.mjs` (Task 4). `createServer(db, dir, actor)` signature identical in Task 3 implementation and the Task 3 smoke test. `statusEnum`/`priorityEnum` cast documented (zod tuple requirement).

**Known assumption:** the MCP server resolves its store from `process.cwd()` via git (same as the CLI), i.e. Claude Code launches the project MCP server with the project as cwd. `KDD_DB` overrides if that assumption ever fails.
