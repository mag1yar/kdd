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
