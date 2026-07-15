# kddkit

**A kanban + memory substrate for humans and Claude.** Task board, decisions
and project context that survive sessions, branches and worktrees. You drive the
board by hand through a small web UI; Claude reads and writes it through MCP. It
is the state layer *under* whatever runs on top — bare Claude Code, Superpowers,
GSD — not a workflow engine and not an orchestrator.

Nothing gets forgotten or overwritten: tasks, decisions and context live outside
the context window, are pulled on demand, and look the same from every worktree.

## How it works

kddkit keeps two kinds of memory, deliberately separated:

- **Tasks** — mutable state, kept in a SQLite store *outside* your repo. They
  churn: `backlog → new → in_progress → review → done`, with comments and an
  event trail. This is "what am I doing / what's next."
- **Knowledge** — decisions, conventions and notes, kept as durable markdown in
  your repo under `.planning/decisions/` and indexed for search. This is "what
  we decided / how this is built / why." It outlives any task.

The store is keyed by your git repository, so the board is identical whether you
open the main checkout or a worktree. Claude reaches it over an MCP server
(4 read/point-write tools, every write attributed to `ai`); you reach it with a
CLI and a local web board.

## Install

Two steps, sent as **two separate prompts** in Claude Code:

```
/plugin marketplace add mag1yar/kddkit
```
```
/plugin install kddkit@kddkit
```

Then restart Claude Code. On the first session the plugin fetches its one native
dependency (`better-sqlite3`) into the plugin directory and prints a one-line
pointer confirming the substrate is active.

## Requirements

- **Node.js ≥ 22** on your `PATH` — the SessionStart hook and the MCP server run
  on it. Without it the plugin loads but stays quiet.
- **Claude Code** with plugin support.
- **git** — kddkit resolves its store from the repo you are in, so use it inside a
  git repository.
- **better-sqlite3** — native, *auto-installed* into the plugin on first session.
- macOS, Linux or Windows.

## Using the board (human side)

Claude uses kddkit automatically once the plugin is active. To *see* and edit the
board yourself you need the `kdd` CLI + web UI. It is not published to npm yet,
so build it from source:

```bash
git clone https://github.com/mag1yar/kddkit.git
cd kddkit
pnpm install
pnpm build
pnpm --filter @kddkit/cli link --global   # puts `kdd` on your PATH
```

Then, **from inside the project you are working on** (the store is per-repo):

```bash
kdd ui          # open the board at http://localhost:4499
kdd status      # in-progress / blocked digest
kdd add "Wire up auth"        --priority high
kdd move 12 in_progress
kdd decide "Use FTS5 for recall" --rationale "no extra dep, good enough"
kdd recall "recall ranking"   # search decisions + tasks
```

Full command set: `add`, `board`, `show`, `move`, `edit`, `comment`,
`block` / `unblock`, `link`, `archive` / `unarchive`, `decide`, `recall`,
`status`, `rebuild`, `projects`, `export`, `ui`. Add `--json` to most for
machine-readable output.

Prefer not to link globally? Run it directly: `node /path/to/kddkit/packages/cli/dist/index.js ui`.

## What Claude does with it

The bundled skill teaches a **pull** protocol: at the start of a task Claude
pulls what it needs (`list_tasks`, `recall "<topic>"`) instead of holding the
whole board in context, records progress as it goes (`update_task`), and never
makes mass or destructive board edits without you asking. Recording a decision
is human-gated — Claude proposes it; it lands via `kdd decide`.

MCP tools: `get_task`, `list_tasks`, `recall`, `update_task`. Creating,
archiving, linking and deciding are intentionally CLI-only, so those stay with
you.

## Where things live

- **Store:** `~/.kdd/<repo-hash>/kdd.db` (override the root with `KDD_HOME`).
- **Decisions:** `.planning/decisions/` in your repo, versioned with your code.

## Layout

```
.claude-plugin/    plugin + marketplace manifests
.mcp.json          MCP server wiring (${CLAUDE_PLUGIN_ROOT})
hooks/             SessionStart: smart-install + pointer
skills/kdd/        the pull-protocol contract
scripts/           smart-install.mjs, session-start.mjs
packages/
  core/            store, state machine, recall (better-sqlite3, FTS5)
  cli/             the `kdd` command
  mcp/             thin MCP server over core (committed self-contained bundle)
  ui/              Hono API + React board
```

## Development

```bash
pnpm install
pnpm build         # turbo, builds every package
pnpm test          # vitest across core / cli / mcp / ui
```

The plugin ships committed `dist/` for `core`, `cli` and `mcp` so it runs with no
build step on install. Rebuild before committing if you change their source.

## License

MIT — see [LICENSE](LICENSE).
