# KDD

## What This Is

KDD — плагин-субстрат памяти и документации для Claude Code: kanban-доска задач и бэклога, решения/конвенции проекта и заметки, которые переживают сессии, ветки и worktree. Пользователь ведёт доску вручную через минимальный web-UI, Claude читает и редактирует её через CLI + тонкий MCP. Это слой состояния под любым исполнителем (Superpowers, GSD, голый Claude Code) — не воркфлоу-движок и не оркестратор.

## Core Value

Ничего не забывается и не нарушается: задачи, решения и контекст проекта хранятся вне окна контекста, достаются по запросу (pull) и одинаково видны из любого worktree.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Центральный SQLite-стор задач вне git (ключ = git-common-dir), общий для всех worktree проекта
- [ ] CLI-глаголы для Claude: add / board / status / update / move / comment / decide / recall / rebuild
- [ ] Решения/конвенции как md-файлы в `.planning/` (коммитятся, ревьюятся, edут с веткой); SQLite их индексирует (FTS5), git — канон
- [ ] Минимальный web-канбан: колонки, drag-n-drop, создание/правка задач (markdown-описание, приоритет)
- [ ] Тонкий MCP поверх того же ядра для UI-сервера и ключевых операций
- [ ] Append-only таблица events (actor_type, actor_id, session_id) — аудит с первого дня
- [ ] Стейт-машина переходов статусов в коде (не в промптах), гейт по типу актора
- [ ] Skill-контракт, обучающий Claude протоколу доски (pull, не push)
- [ ] `kdd rebuild` — индекс пересобирается из md-файлов; база никогда не единственный носитель durable-знания

### Out of Scope

- Автономные агенты (BA/planner/tester), claim, cron-петля — v1+; схема закладывается (actor-колонки, events), механика не пишется
- Telegram-уведомления — v1 (outbound), ответы из Telegram — v2; дизайн готов в research
- Эмбеддинги/вектор-поиск — FTS5 BM25 достаточен (бенчмарк ruflo: cosine-only = 0% релевантности); вектор только после доказанного провала FTS5
- Push-инъекция памяти в каждый ход — главный антипаттерн (боль RuFlo); только pull
- Оркестрация/workflow-движок — работу делает исполнитель (Superpowers/GSD), KDD выставляет данные
- Multi-user auth, Jira/ADO-sync — локальный однопользовательский субстрат; в v2 максимум JSON-экспорт
- Test-run/readiness-скоринг — отдельный QA-плагин поверх субстрата, не ядро

## Context

- Автор — solo full-stack разработчик, работает в 2–3 git worktree параллельно (worktree = свой «спринт»), исполнитель — Claude Code + Superpowers.
- Боль: GSD-агенты пишут отсебятину; `.planning` в gitignore ломается на worktree (tracked-файлы не переносятся); коммитимая доска даёт merge-конфликты. Отсюда центральный стор вне git.
- Проведено исследование (июль 2026): 6 референсов (agent-kanban, gsd-core, ruflo, superpowers, ECC, hermes-agent) + 6 персон. Отчёты: `.planning/research/` (KDD-SYNTHESIS.md, HERMES.md). Ключевые заимствования: атомарный claim одним UPDATE, append-only events, decision-md с Outcome-колонкой, FTS5 вместо векторов, дедуп по content-hash, wake-gate для cron.
- hermes-agent независимо сошёлся с той же архитектурой (CAS-claim, events, центральный SQLite) — сильная валидация дизайна.

## Constraints

- **Tech stack**: Node + TypeScript, better-sqlite3, Hono для UI-сервера, без фреймворков — один рантайм на CLI/MCP/UI, ноль барьера установки
- **Хранение**: мутабельное состояние только в SQLite (вне репо); durable-знание только в git-md; не смешивать
- **Контекст-бюджет**: каждый вывод CLI капирован (status ≤2KB, hook ≤3 строк, recall top-k с капом) — цифры в спеку
- **Совместимость**: `.planning/` — структура, совместимая с GSD; KDD не ломает существующие GSD-проекты
- **Дистрибуция**: плагин Claude Code (skills + MCP + CLI через npx)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Центральный SQLite вне git, ключ = git-common-dir | Один стор для всех worktree; нет merge-конфликтов и gitignore-дыр | — Pending |
| CLI-глаголы как основной интерфейс Claude, MCP тонкий | Каждая MCP-схема — налог на контекст каждого хода (антипаттерн ruflo: 300+ тулов) | — Pending |
| Решения в `.planning/` md, коммитятся | Совместимость с GSD-привычками; ревью в PR; edут с веткой | — Pending |
| FTS5 BM25, без эмбеддингов | Бенчмарк ruflo: cosine-only 0% → BM25 70%; вектор = v2+ по доказанной нужде | — Pending |
| Web-UI в v0, но минимальный | Пользователь ведёт доску вручную с первого дня — это и есть режим «документирование» | — Pending |
| Node+TS, better-sqlite3, Hono | Один рантайм, нативная среда Claude Code плагинов | — Pending |
| Схема с actor_type/session_id/events с v0 | Агенты v1+ прикручиваются без миграций; сейчас стоит ноль | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-14 after initialization*
