---
created: 2026-07-18
status: active
superseded_by:
---
# Decisions are append-only

## Decision
Decision files are never edited or deleted. A change of course is a new decision with --supersedes <old-slug>; the old file gets status: superseded and stays in history.

## Rationale
Mutable memory loses the why-we-changed trail and lets recall return contradicting decisions. Conflict is resolved by retrieval ranking (superseded demoted), not mutation — mem0 dropped LLM UPDATE/DELETE for ADD-only and gained 20+ points on memory benchmarks.

## Alternatives
-

## Supersedes
-

## Outcome
-
