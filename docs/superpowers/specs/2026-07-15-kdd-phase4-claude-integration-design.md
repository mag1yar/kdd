# KDD Phase 4 — Claude Integration & Packaging (Design)

**Status:** approved
**Date:** 2026-07-15
**Requirements:** INT-01, INT-02, INT-03, INT-04

## Goal

Claude discovers and uses the KDD substrate automatically in any session, and
the whole thing installs as a Claude Code plugin (skills + MCP + CLI) that works
on Windows.

## Global Constraints

- Node >= 22, TypeScript, `better-sqlite3`, one runtime across CLI/MCP/UI.
- MCP stays thin: exactly 4 tools. No orchestration, no workflow engine.
- Context budget: MCP output capped (`list_tasks` compact rows without body;
  `recall` top-k capped). SessionStart pointer ≤ 3 lines.
- No emoji / banners in any machine-facing output.
- Windows-compatible: paths via `${CLAUDE_PLUGIN_ROOT}`, node scripts (not bash),
  `npm --prefix` for installs.
- No commit attribution trailers (project-wide rule).
- Distribution: self-contained plugin now; npm publish deferred to a later phase.

## Key Decisions (from brainstorming)

1. **MCP surface = read + point-write.** `get_task`, `list_tasks`, `recall`
   (read); `update_task` (single-task edit/move/comment). No create / archive /
   link / decide / batch via MCP — those stay CLI + user, which enforces the
   Iron Law at the API surface.
2. **MCP is Claude's primary write path**, justified by one concrete win:
   guaranteed `actor=ai` attribution + typed input without shell-quoting. CLI
   remains the human/script interface.
3. **Self-contained plugin** (claude-mem pattern): manifest + `.mcp.json` +
   `hooks/` + `skills/` at repo root; MCP launched as
   `node ${CLAUDE_PLUGIN_ROOT}/packages/mcp/dist/server.js`. No npx.
4. **Native dependency via smart-install**: first SessionStart ensures
   `better-sqlite3` is present in the plugin root, installing it if missing.

## Architecture

### New package: `packages/mcp` (`@kddkit/mcp`)

Same layout as core/cli/ui. Runtime deps: `@kddkit/core` (workspace),
`@modelcontextprotocol/sdk`. Native `better-sqlite3` stays external (not
bundled). Build: `tsup src/server.ts --format esm --clean` → `dist/server.js`.

The server:

- Opens the DB once via `resolveDbPath()` + `openDb(dbPath, projectPath)` and
  reuses it for the process lifetime.
- Actor is always `{ type: 'ai', id: process.env.KDD_SESSION ?? 'mcp' }`.
- Registers 4 tools, connects `StdioServerTransport`.

### Plugin layout (repo root)

```
.claude-plugin/plugin.json     manifest (name: kdd, version, description)
.mcp.json                      { mcpServers.kdd.command: node,
                                 args: [${CLAUDE_PLUGIN_ROOT}/packages/mcp/dist/server.js] }
hooks/hooks.json               SessionStart (matcher startup|clear|compact)
skills/kdd/SKILL.md            protocol contract
scripts/smart-install.mjs      ensures better-sqlite3 in plugin root
scripts/session-start.mjs      ≤3-line pointer, logs failures to errors table
```

`packages/{core,cli,mcp}/dist` are un-ignored and committed so a plugin consumer
runs without a build step. `packages/ui/dist` is **not** required by the plugin
(the UI is launched by a human via `kdd ui` from the installed CLI).

## MCP Tool Surface

All tools call existing `@kddkit/core` functions, so a mutation via MCP produces
the same `events` trail as the CLI (success criterion 1).

| Tool | Core call | Input | Output | Cap |
|------|-----------|-------|--------|-----|
| `get_task` | `taskDetail(db, id)` | `{ id }` | task + comments + events + links | — |
| `list_tasks` | `boardData(db, filter)` | `{ status?, area? }` | rows grouped by status: `{ id, title, status, priority, blocked }` (no body) | grouped columns |
| `recall` | `recall(db, dir, q, {k, kind})` | `{ query, k?, kind? }` | `RecallHit[]` | k (default 10) |
| `update_task` | `editTask` / `moveTask` / `commentTask` | `{ id, edit?, move?, comment? }` | updated task | — |

`update_task` semantics:

- `edit?: { title?, body?, priority?, area? }` → `editTask`
- `move?: { to, reason? }` → `moveTask`
- `comment?: string` → `commentTask`
- Fields applied in the order edit → move → comment, each producing its own
  event through the existing op.
- If none of `edit`/`move`/`comment` is present → error (`nothing to update`).

### Error contract

Each tool handler wraps its core call:

- `KddError` → tool result marked as error, `message` returned verbatim
  (includes not-found and invalid-transition text).
- Unexpected error → insert `{ source: 'mcp', message }` into the `errors` table,
  return a generic `internal error` to the client.

## Skill Contract (`skills/kdd/SKILL.md`)

Frontmatter `name: kdd` + a `description` that makes it discoverable by
relevance. Teaches:

- **Pull model:** at the start of a task, run `list_tasks` / `recall` scoped to
  the topic. Do not hold the whole board in context; pull on demand.
- **How to write progress:** progress notes via `update_task { comment }`; status
  changes via `update_task { move }`.
- **Decisions:** propose the decision; recording is `kdd decide`, confirmed by a
  human (or run by Claude via CLI when `kdd` is on PATH). Not an MCP tool —
  decisions are deliberate and human-gated by design.
- **Iron Law:** no mass board edits without an explicit user request. The MCP
  surface already enforces this (no batch/create/archive tools); the skill
  states it in words.
- **Actor:** via MCP everything is attributed `ai` automatically — nothing to
  configure.

## SessionStart Hook

`hooks/hooks.json`, matcher `startup|clear|compact`, single command:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/smart-install.mjs" && node "${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs"
```

### `session-start.mjs`

- Prints a ≤3-line pointer, e.g.:
  `KDD substrate active. Tools: list_tasks, recall (MCP). Board UI: kdd ui.`
  Optionally appends counts from `statusDigest` (in_progress / blocked).
- Any failure → write one row to the `errors` table (`source: 'session-start'`).
- **Always exits 0** (success criterion 3).

### `smart-install.mjs`

- Checks whether `better-sqlite3` resolves from the plugin root.
- If missing → `npm i better-sqlite3@<pinned> --prefix ${CLAUDE_PLUGIN_ROOT}`.
- Idempotent; exits 0 even on failure.
- Because sqlite may be absent, install failures are logged to a **fallback
  file** (`${CLAUDE_PLUGIN_ROOT}/.kdd-install-error.log`), not the DB.
  Once sqlite is present, `session-start.mjs` logs to the `errors` table.

## Packaging & Build

- `.claude-plugin/plugin.json`: `{ name, version, description, author, license,
  keywords }`.
- Turbo picks up `packages/mcp` in the shared `build` / `test` pipeline
  (build `dependsOn ^build`, outputs `dist/**`).
- Committed `dist` for core/cli/mcp so the plugin runs without a build step.
- CLI `bin` unchanged; UI still launched via `kdd ui`.

## Testing

- **MCP handlers:** exercise tool handlers against a `:memory:` DB (mirrors the
  ui `app.request()` style — no real socket):
  - `get_task` returns detail; unknown id → error text.
  - `list_tasks` returns compact rows grouped by status, no body field.
  - `recall` returns capped hits.
  - `update_task`: edit / move / comment each recorded with `actor_type = 'ai'`
    in `events`; empty update → error; invalid move → `KddError` text; unknown
    id → error.
- **One stdio smoke:** start the server on a real transport, call `list_tasks`,
  assert a response (mirrors the ui `startui.test.ts` smoke).
- **`session-start.mjs`:** exits 0 with a broken/absent DB and records the
  failure in the `errors` table when the DB is reachable.
- **`smart-install.mjs`:** idempotent — a second run with `better-sqlite3`
  already present is a no-op and exits 0.

## Out of Scope

- npm publish and standalone install on a clean machine beyond smart-install.
- `add` / `archive` / `link` / `decide` via MCP.
- Any orchestration, auto-agents, or push-injection of memory (pull only).
