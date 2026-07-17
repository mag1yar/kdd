# Roadmap: KDD

## Overview

Build the "documentation mode" substrate bottom-up: first the central SQLite store with the state machine and the CLI verbs Claude lives on (the substrate everything else uses), then decisions-as-markdown with FTS5 recall, then the minimal web kanban over the same core, and finally the Claude integration layer (thin MCP, skill contract, SessionStart hook) packaged as an installable Claude Code plugin. Each phase ends with a slice the user can actually use.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Store & CLI Core** - Central per-project SQLite store outside git plus the CLI verbs for managing the task board from any worktree
- [x] **Phase 2: Decisions & Recall** - Decisions as committed markdown, FTS5 recall across decisions and tasks, rebuildable index
- [x] **Phase 3: Web Kanban** - Minimal local kanban UI over the same store: drag-n-drop, task create/edit, comments
- [x] **Phase 4: Claude Integration & Packaging** - Thin MCP, skill contract, SessionStart hook, installable Claude Code plugin
- [x] **Phase 5: Task Detail Parity** - Jira/Azure-inspired task view: Details-rail (status dropdown, priority, blocked+reason, related links, dates), Activity tabs (Comments/History), markdown comments (see [research/TASK-DETAIL-PARITY.md](research/TASK-DETAIL-PARITY.md))

## Phase Details

### Phase 1: Store & CLI Core
**Goal**: User and Claude can manage the project's task board from the terminal, with one shared board visible from every worktree
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: STORE-01, STORE-02, STORE-03, STORE-04, CLI-01, CLI-02, CLI-03, CLI-04, CLI-05
**Success Criteria** (what must be TRUE):
  1. From any worktree of the same project, `kdd add "title"` creates a task with a short `#N` ID and `kdd board` shows the identical board (one DB keyed by git-common-dir)
  2. `kdd move #N <status>` succeeds only for valid transitions; an invalid transition is rejected with a clear error and nothing is written
  3. `kdd show #N` displays the full task with comments and an event trail showing which actor (`user`/`ai`, with session_id) did what and when
  4. `kdd status` prints a plain-text project digest of at most 2KB — no emoji, no banners — and a test enforces the size contract
**Plans**: TBD

### Phase 2: Decisions & Recall
**Goal**: Project decisions live as committed markdown in `.planning/` and are searchable alongside tasks; the SQLite index is disposable
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: DEC-01, DEC-02, DEC-03
**Success Criteria** (what must be TRUE):
  1. `kdd decide "title"` creates `.planning/decisions/YYYY-MM-DD-slug.md` with Decision/Rationale/Alternatives/Supersedes/Outcome sections and the decision is immediately findable via recall
  2. `kdd recall "query"` returns relevant capped top-k results across decisions and tasks via FTS5 BM25
  3. Writing the same decision content twice returns success ("already recorded") via content-hash instead of creating a duplicate
  4. After deleting the database, `kdd rebuild` restores the full decisions index from the md files alone (md directory is self-sufficient)
**Plans**: TBD

### Phase 3: Web Kanban
**Goal**: User manages the board visually in a local web UI — the same data and rules Claude touches via CLI
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. `kdd ui` serves a local kanban board with columns by status; dragging a card moves the task through the same state machine, and invalid moves are rejected
  2. User can create and edit a task in the UI: title, markdown body (rendered), priority
  3. User can comment on a task in the UI; comments from `user` and `ai` are visually distinct
  4. A change Claude makes via CLI appears in the open UI without restarting the server (polling/refresh)
**Plans**: TBD
**UI hint**: yes

### Phase 4: Claude Integration & Packaging
**Goal**: Claude discovers and uses the substrate automatically in any session, and the whole thing installs as a Claude Code plugin
**Mode:** mvp
**Depends on**: Phase 1, Phase 2, Phase 3
**Requirements**: INT-01, INT-02, INT-03, INT-04
**Success Criteria** (what must be TRUE):
  1. A thin MCP server exposes 3-4 tools (get_task, list_tasks/board, update_task, recall) over the same core; a mutation via MCP produces the same event trail as the CLI
  2. The skill contract teaches Claude the pull protocol (when to run status/recall, how to comment and decide) including the Iron Law: no mass board edits without a user request
  3. A fresh Claude session shows a ≤3-line SessionStart hook pointer to `kdd status` / `kdd recall`; the hook always exits 0 and its failures land in the `errors` table
  4. The plugin installs as a Claude Code plugin (skills + MCP + CLI via npx) and works on Windows
**Plans**: docs/superpowers/plans/2026-07-15-kdd-phase4-claude-integration.md

### Phase 5: Task Detail Parity
**Goal**: The web task view reaches Jira/Azure-level detail without enterprise cruft — surfacing data already in the store (events, links, blocked, dates) and matching the Details-rail + Activity-tabs pattern
**Mode:** mvp
**Depends on**: Phase 3
**Success Criteria** (what must be TRUE):
  1. Details-rail shows status dropdown (changes state via the same state machine), priority, blocked+reason with Block/Unblock, related links, created/updated dates
  2. Activity has Comments and History tabs; History renders the event trail (created/moved/blocked/linked/commented) with actor
  3. Comment bodies render markdown; composer is a bordered textarea + Send
**Plans**: ad-hoc (surfaced existing store data; no new schema)
**UI hint**: yes
**Research**: research/TASK-DETAIL-PARITY.md (defer-list: parent/subtasks, estimate, dev-links, @/# mentions, autonomy controls)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Store & CLI Core | 1/1 | Complete | 2026-07-14 |
| 2. Decisions & Recall | 1/1 | Complete | 2026-07-14 |
| 3. Web Kanban | 1/1 | Complete | 2026-07-15 |
| 4. Claude Integration & Packaging | 1/1 | Complete | 2026-07-15 |
| 5. Task Detail Parity | 1/1 | Complete | 2026-07-17 |
