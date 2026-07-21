# Codebase Structure

**Analysis Date:** 2026-07-21

## Directory Layout

```
kddkit/
├── packages/              # Monorepo packages (pnpm workspaces)
│   ├── core/              # Shared business logic, data model, operations
│   │   ├── src/
│   │   │   ├── index.ts               # Export barrel
│   │   │   ├── types.ts               # Task, Track, Criterion, Comment, EventRow, interfaces
│   │   │   ├── state.ts               # Status/Priority constants, transition rules, checkMove validation
│   │   │   ├── db.ts                  # SQLite schema, migrations, openDb, WAL pragmas
│   │   │   ├── ops.ts                 # Task operations: addTask, editTask, moveTask, placeTask, blockTask
│   │   │   ├── criteria.ts            # Acceptance criteria: addCriterion, setCriterionChecked, removeCriterion
│   │   │   ├── tracks.ts              # Task groups: createTrack, editTrack, deleteTrack, listTracks
│   │   │   ├── queries.ts             # Read-only queries: boardData, taskDetail, taskDetailCapped
│   │   │   ├── recall.ts              # FTS5 search: syncIndex, sanitizeQuery, recall
│   │   │   ├── decisions.ts           # Decision parsing/storage: parseDecisionMd, addDecision
│   │   │   ├── paths.ts               # Project resolution: kddHome, resolveDbPath, resolveDecisionsDir, listProjects
│   │   │   ├── caps.ts                # Output capacity limits (text truncation, max results, etc.)
│   │   │   ├── errors.ts              # KddError exception class, logError function
│   │   │   └── index.ts               # Re-export all public APIs
│   │   ├── test/                      # Unit tests for core operations
│   │   ├── dist/                      # Compiled JavaScript (built by turbo)
│   │   ├── tsconfig.json              # TypeScript config
│   │   └── package.json
│   │
│   ├── cli/               # Command-line interface
│   │   ├── src/
│   │   │   ├── index.ts               # Commander CLI: add, decide, board, show, move, edit, comment, block, unblock
│   │   │   │                          #             link, archive, unarchive, recall, rebuild, status, ui
│   │   │   │                          #             criteria (add/check/uncheck/rm/ls), track (add/ls/edit/done/reopen/rm)
│   │   │   ├── context.ts             # DB context: withDb, getActor, parseId, resolveDbPath wrapper
│   │   │   ├── render.ts              # Text rendering: renderBoard, renderShow, renderCriteria, renderRecall, renderTracks
│   │   │   └── (dev script helpers)
│   │   ├── test/                      # CLI integration tests
│   │   ├── dist/                      # Compiled JavaScript
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── ui/                # Web UI + HTTP server
│   │   ├── src/
│   │   │   ├── server.ts              # Hono HTTP server, REST API endpoints, project pool, SPA serving
│   │   │   └── web/                   # React SPA
│   │   │       ├── main.tsx           # React root, vite entry point
│   │   │       ├── App.tsx            # Main component: project select, board, tabs
│   │   │       ├── api.ts             # Fetch client: board, tasks, tracks, criteria
│   │   │       ├── useVersion.ts      # Hook: fetch API version
│   │   │       ├── components/
│   │   │       │   ├── Board.tsx      # Kanban board (drag-drop)
│   │   │       │   ├── TaskDialog.tsx # Task detail view/edit
│   │   │       │   ├── NewTaskDialog.tsx
│   │   │       │   ├── NewTrackDialog.tsx
│   │   │       │   ├── MarkdownEditor.tsx
│   │   │       │   └── reui/          # Re-exported shadcn components (kanban drag-drop)
│   │   │       ├── lib/
│   │   │       │   └── utils.ts       # cn (clsx) utility, format helpers
│   │   │       ├── components/ui/     # shadcn component library (tabs, dialog, input, etc.)
│   │   │       └── index.html         # SPA HTML shell
│   │   ├── dist/                      # Built/bundled by vite
│   │   ├── test/
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── mcp/               # Claude MCP integration
│       ├── src/
│       │   ├── main.ts                # Entry point: startServer()
│       │   ├── server.ts              # MCP server: tool definitions, tool handlers
│       │   └── handlers.ts            # MCP tool implementations: getTask, listTasks, listTracks, recall, updateTask
│       ├── test/
│       ├── dist/
│       ├── tsconfig.json
│       └── package.json
│
├── skills/                # Project-local skills for Claude Code
│   └── kdd/
│       └── SKILL.md
│
├── .claude/               # Claude Code configuration
│   ├── CLAUDE.md          # Project instructions, constraints, conventions
│   ├── settings.json      # Hooks, permissions, env vars
│   └── skills/            # Project-scoped skills
│
├── .planning/             # GSD workflow artifacts & decisions (not committed)
│   ├── codebase/          # Codebase map (ARCHITECTURE.md, STRUCTURE.md, etc.)
│   ├── decisions/         # Decision records (.md files, git-tracked)
│   └── research/          # Research & exploration notes
│
├── docs/                  # Documentation
│   └── superpowers/       # Superpowers workflow plans & specs
│
├── .github/               # GitHub workflows
│   └── workflows/
│
├── hooks/                 # Git hooks (if any)
│
├── scripts/               # Utility scripts (turbo, build, test helpers)
│
├── .turbo/                # Turbo cache
│
├── tsconfig.base.json     # Root TypeScript config
├── package.json           # Monorepo root (pnpm workspace)
├── pnpm-lock.yaml         # Dependency lockfile
└── .gitignore
```

## Directory Purposes

**packages/core/**
- Purpose: Shared business logic library used by all clients (CLI, UI, MCP)
- Contains: Data model (types.ts), operations (ops.ts, criteria.ts, tracks.ts), queries, state validation, search
- Key files: `src/ops.ts` (mutations), `src/queries.ts` (reads), `src/state.ts` (validation rules)

**packages/cli/**
- Purpose: Command-line interface for task management, automation, and CI
- Contains: Commander command definitions, argument parsing, text rendering, context resolution
- Key files: `src/index.ts` (main CLI), `src/render.ts` (text formatting), `src/context.ts` (db/actor helpers)

**packages/ui/**
- Purpose: Browser-based kanban board and HTTP server for multi-project access
- Contains: React SPA (kanban, dialogs, forms), Hono HTTP server with REST API, project pool multiplexer
- Key files: `src/server.ts` (HTTP endpoints), `src/web/App.tsx` (main UI), `src/web/api.ts` (fetch client)

**packages/mcp/**
- Purpose: Claude-integrated Model Context Protocol server for AI agents
- Contains: MCP server setup, tool definitions (get_task, list_tasks, recall, update_task), tool handlers
- Key files: `src/server.ts` (MCP setup), `src/handlers.ts` (tool logic)

**skills/kdd/**
- Purpose: Claude Code skill for KDD-specific operations (local helper for .planning/ interaction)
- Contains: Skill metadata, rules, macros

**.planning/codebase/**
- Purpose: Codebase maps written by `/gsd-map-codebase` (ARCHITECTURE.md, STRUCTURE.md, etc.)
- Note: Git-ignored, regenerated as needed

**.planning/decisions/**
- Purpose: Decision records (ADRs) in markdown; indexed by KDD for recall/search
- Note: Committed to git; source of truth for architectural decisions

**docs/superpowers/**
- Purpose: Superpowers workflow documentation: plans, specs, phase notes

## Key File Locations

**Entry Points:**
- CLI: `packages/cli/src/index.ts` (shebang #!/usr/bin/env node)
- Web UI: `packages/ui/src/web/main.tsx` (React root mounted to #root)
- HTTP Server: `packages/ui/src/server.ts:startUi()` or `packages/ui/src/server.ts:createApp()`
- MCP: `packages/mcp/src/main.ts:startServer()` (stdio-based)

**Configuration:**
- TypeScript: `tsconfig.base.json` (root), `packages/*/tsconfig.json` (per-package)
- Build: `turbo.json` (turbo config), `vite.config.ts` (UI build)
- Project: `package.json` (root: pnpm workspaces), `packages/*/package.json` (per-package)

**Core Logic:**
- Data model: `packages/core/src/types.ts` (Task, Track, Criterion, Comment, EventRow interfaces)
- Operations: `packages/core/src/ops.ts` (mutations), `packages/core/src/criteria.ts`, `packages/core/src/tracks.ts`
- Queries: `packages/core/src/queries.ts` (boardData, taskDetail)
- State validation: `packages/core/src/state.ts` (STATUSES, PRIORITIES, TRANSITIONS, checkMove)
- Search: `packages/core/src/recall.ts` (FTS5 sync + query)

**Database:**
- Schema & migrations: `packages/core/src/db.ts` (MIGRATIONS array, openDb function)
- Path resolution: `packages/core/src/paths.ts` (kddHome, resolveDbPath, resolveDecisionsDir, listProjects)

**Testing:**
- Unit tests: `packages/*/test/` (Jest or Vitest)
- Test fixtures: Inline in test files or in `test/fixtures/` if present

## Naming Conventions

**Files:**
- Source: camelCase (index.ts, server.ts, render.ts, context.ts)
- Components: PascalCase (Board.tsx, TaskDialog.tsx, MarkdownEditor.tsx)
- Tests: kebab-case or match source name with `.test.ts` or `.spec.ts` suffix
- Build output: lowercase (dist/, build/)

**Directories:**
- Feature/layer: lowercase, descriptive (core, cli, ui, mcp, web, components, lib)
- Tests: `test/` or `__tests__/` at package root
- Build: `dist/`

**Functions:**
- Operations (mutations): verb-noun pattern (addTask, editTask, moveTask, blockTask)
- Queries: verb-noun pattern (boardData, taskDetail, listTasks, listCriteria)
- Validation: checkX pattern (checkMove, checkPriority, checkStatus)
- Helpers: lowercase_with_underscores or camelCase

**Types:**
- Interfaces: PascalCase (Task, Track, Criterion, Comment, EventRow, Actor)
- Enums: UPPERCASE_WITH_UNDERSCORES for const arrays (STATUSES, PRIORITIES)
- Type aliases: PascalCase (Status, Priority, RecallHit)

**Database:**
- Tables: lowercase (tasks, tracks, criteria, comments, events, decisions, search_index)
- Columns: lowercase_with_underscores (created_at, archived_at, track_id, checked_at)
- Indexes: idx_table_columns (idx_tasks_status, idx_tasks_track, idx_criteria_task)

## Where to Add New Code

**New Task-Related Feature:**
- Primary code: `packages/core/src/ops.ts` (if mutation) or `packages/core/src/queries.ts` (if read)
- CLI: Add command in `packages/cli/src/index.ts`, render function in `packages/cli/src/render.ts`
- UI: Add dialog/component in `packages/ui/src/web/components/`, API call in `packages/ui/src/web/api.ts`, endpoint in `packages/ui/src/server.ts`
- MCP: Add tool in `packages/mcp/src/server.ts`, handler in `packages/mcp/src/handlers.ts`
- Tests: `packages/core/test/` (core logic), `packages/cli/test/` (CLI), `packages/ui/test/` (UI components)

**New Component/Module:**
- Implementation: `packages/core/src/` if core logic; `packages/ui/src/web/components/` if UI component
- Type definition: `packages/core/src/types.ts` if shared model; inline if local
- Export: Re-export from `packages/*/src/index.ts` barrel

**Shared Utilities:**
- Helpers: `packages/core/src/` (e.g., caps.ts for limits, errors.ts for exception class)
- React hooks: `packages/ui/src/web/` (e.g., useVersion.ts)

**Database Changes:**
- Schema: Add migration to `MIGRATIONS` array in `packages/core/src/db.ts`
- Migration includes: CREATE/ALTER statements, index creation, data migrations if needed
- Test: Run migrations in test by calling `openDb(':memory:')` and verifying schema

**Decision Records:**
- Location: `.planning/decisions/` (markdown files with `.md` extension)
- Format: Frontmatter (title, created, status, superseded_by) + markdown body
- Indexing: Automatically picked up by `kdd recall` (FTS5 indexed on demand)

## Special Directories

**node_modules/**
- Purpose: Installed dependencies (pnpm)
- Generated: Yes
- Committed: No (in .gitignore)

**.turbo/cache/**
- Purpose: Turbo build cache
- Generated: Yes
- Committed: No

**packages/*/dist/**
- Purpose: Compiled TypeScript output (JavaScript + .d.ts)
- Generated: Yes (by `turbo run build` or `tsc`)
- Committed: No (in .gitignore)

**.planning/codebase/**
- Purpose: Codebase maps (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md)
- Generated: Yes (by `/gsd-map-codebase`)
- Committed: No (in .gitignore); regenerated as needed

**.planning/decisions/**
- Purpose: Decision records (ADRs) in markdown
- Generated: No (manually created or via `kdd decide`)
- Committed: Yes (git-tracked)

**.planning/research/**
- Purpose: Research notes, spikes, exploration
- Generated: Yes (manually or by research tools)
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-07-21*
