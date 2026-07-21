# Testing Patterns

**Analysis Date:** 2026-07-21

## Test Framework

**Runner:**
- Vitest 4.1.10
- Config: `packages/*/vitest.config.ts` (minimal, inherits defaults)

**Assertion Library:**
- Vitest built-in `expect()`

**Run Commands:**
```bash
pnpm test              # Run all tests (via turbo)
pnpm -r test           # Same as above
cd packages/core && pnpm test  # Single package
```

## Test File Organization

**Location:**
- Co-located within each package: `packages/{core,cli,mcp,ui}/test/`
- NOT in a root `test/` or `__tests__/` directory

**Naming Convention:**
- Suffix: `.test.ts` (e.g., `db.test.ts`, `ops.test.ts`, `server.test.ts`)

**Directory Structure:**
```
packages/core/
├── src/
│   ├── db.ts
│   ├── ops.ts
│   └── recall.ts
├── test/
│   ├── db.test.ts
│   ├── ops.test.ts
│   └── recall.test.ts
└── vitest.config.ts (optional, uses default)
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('featureName', () => {
  let db: Database.Database;
  
  beforeEach(() => {
    db = openDb(':memory:', 'project-path');
  });

  it('does something specific', () => {
    const result = someFunction(db, input);
    expect(result).toMatchObject({ expectedProp: value });
  });

  it('handles error case', () => {
    expect(() => someFunction(db, badInput)).toThrow(/expected message/);
  });
});
```

**Setup/Teardown Patterns:**
- `beforeEach()` for test isolation (e.g., fresh database per test)
- No `afterEach()` used (Node cleanup is handled by temp dir cleanup or in-memory fixtures)
- No global test setup files

**Common Assertion Patterns:**
- `.toMatchObject()` - partial object matching (most common)
- `.toEqual()` - exact equality for simple values and arrays
- `.toThrow(/regex/)` - error message validation
- `.toBe()` - strict equality
- `.toContain()` - string/array membership
- `.toHaveLength()` - collection length

## Mocking

**Framework:** None used

**Pattern:**
Tests use real implementations and real dependencies instead of mocks:
- `openDb(':memory:', ...)` creates real in-memory SQLite databases
- `execFileSync()` runs the real compiled CLI binary
- Real filesystem operations with `mkdtempSync()` for isolation

**What to Mock:**
- Nothing — tests prefer real fixtures over mocks. This simplifies test maintenance and catches integration bugs.

**What NOT to Mock:**
- Database operations (use `:memory:` instead)
- CLI invocations (use `execFileSync` with a real built binary)
- Filesystem reads/writes (use `mkdtempSync()` for isolation)

## Fixtures and Factories

**Test Data:**
```typescript
// In-memory database per test
const db = openDb(':memory:', 'x');

// Temp directory creation for file-based tests
const tmp = () => mkdtempSync(join(tmpdir(), 'kdd-rec-'));
const dir = tmp();

// Helper functions for common setup
const user = { type: 'user' as const };
const ai = { type: 'ai' as const, id: 's1' };
```

**Helper Pattern (from `packages/cli/test/run.ts`):**
```typescript
export function makeEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), 'kdd-cli-'));
  return {
    ...process.env,
    KDD_DB: join(dir, 'kdd.db'),
    KDD_DECISIONS_DIR: join(dir, 'decisions'),
    KDD_ACTOR: '',
  };
}

export function kdd(env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('node', [BIN, ...args], { env, encoding: 'utf8' });
}
```

**Location:**
- `packages/cli/test/run.ts` — CLI test helpers
- Helper functions defined inline in test files when simple

## Coverage

**Requirements:** None enforced

**Current State:** No coverage tool configured (no c8, nyc, or coverage option in vitest configs)

## Test Types

**Unit Tests:**
- Single function or module behavior
- Examples: `db.test.ts` (schema validation), `ops.test.ts` (task CRUD), `errors.test.ts` (logging)
- Use in-memory SQLite: `openDb(':memory:', 'x')`
- Scope: input validation, state changes, error cases

**Integration Tests:**
- Cross-module behavior (e.g., CLI → Core → Database)
- Examples: `cli.test.ts` (CLI commands), `server.test.ts` (MCP server)
- Scope: command output, multi-step workflows, environment variable handling

**E2E Tests:**
- Not present. CLI integration tests (`packages/cli/test/cli.test.ts`) serve this role.

## Common Patterns

**Database Testing:**
```typescript
const db = openDb(':memory:', 'C:/proj');
const tables = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
).all().map((r: any) => r.name);
expect(tables).toEqual(expect.arrayContaining(['tasks', 'comments', 'events']));
```

**CLI Testing (with real execution):**
```typescript
const env = makeEnv();
expect(kdd(env, 'add', 'Task title', '--priority', 'high'))
  .toContain('#1 created');
const board = kdd(env, 'board');
expect(board).toContain('new (1)');
```

**Error Testing:**
```typescript
expect(() => addTask(db, { title: 't', priority: 'nope' as any }, user))
  .toThrow(/invalid priority/);
// Verify state unchanged on error:
expect(db.prepare(`SELECT COUNT(*) c FROM tasks`).get()).toEqual({ c: 0 });
```

**Filesystem Testing:**
```typescript
const dir = mkdtempSync(join(tmpdir(), 'kdd-rec-'));
writeFileSync(join(dir, 'decision.md'), '---\n...\n---\n# title\n\nbody');
syncIndex(db, dir);
expect(idxCount(db, 'decision')).toBe(1);
```

**Async Testing:**
```typescript
it('async operation', async () => {
  const client = await connect(db);
  const res = await client.callTool({ name: 'list_tasks', arguments: {} });
  expect(res).toBeDefined();
});
```

**JSON Output Testing:**
```typescript
kdd(env, 'add', 'x');
const out = JSON.parse(kdd(env, 'show', '1', '--json'));
expect(out.task).toMatchObject({ id: 1, title: 'x' });
```

## CI/CD

**Location:** `.github/workflows/test.yml`

**Trigger:** On every push to master and all pull requests

**Environment:**
- Node 22 (the minimum `engines.node` floor)
- pnpm with frozen lockfile
- Ubuntu latest

**Pipeline:**
```yaml
- pnpm install --frozen-lockfile
- pnpm turbo build test  # Runs all package builds + tests via turbo
```

## Test Coverage Gaps

**Not Tested:**
- React component rendering (UI package has no component tests, only build artifact checks)
- MCP plugin hook lifecycle (only basic server and tool invocation tested)
- Database migration edge cases beyond schema validation

**Why:**
- Ponytail principle: no fixtures/harnesses added speculatively. Tests cover execution paths that integrate components end-to-end instead.
- Build output validation (`.test.ts` verifying dist/ exists) is preferred over mock rendering.

---

*Testing analysis: 2026-07-21*
