# Requirements — KDD v1 (milestone: "documentation mode")

Scope of this milestone: пользователь вручную ведёт канбан через web-UI, Claude читает/редактирует доску и решения через CLI+MCP. Без автономных агентов.

## v1 Requirements

### Store (STORE)

- [x] **STORE-01**: Центральная SQLite-база на проект живёт вне репо (`~/.kdd/<hash(git-common-dir)>/kdd.db`, WAL); из любого worktree проекта резолвится одна и та же база
- [x] **STORE-02**: Схема содержит `tasks` (seq-ID, title, body md, status, priority, created/updated), append-only `events` (task_id, actor_type, actor_id, action, detail, session_id, ts) и `errors`
- [x] **STORE-03**: Переходы статусов валидируются чистой функцией-стейт-машиной в write-path; недопустимый переход отклоняется с внятной ошибкой и не пишется
- [x] **STORE-04**: Каждая мутация задачи порождает event с actor_type (`user`|`ai`) и session_id; лента задачи выводима одним запросом

### CLI (CLI)

- [x] **CLI-01**: Пользователь/Claude может создать задачу: `kdd add "title" [--body md] [--priority]` → короткий ID `#N`
- [x] **CLI-02**: `kdd board` рендерит доску текстом (колонки → задачи), `kdd show #N` — полную задачу с комментариями и лентой
- [x] **CLI-03**: `kdd move #N <status>` и `kdd edit #N` изменяют задачу через стейт-машину; `kdd comment #N "text"` добавляет комментарий с автором
- [x] **CLI-04**: `kdd status` выдаёт digest проекта ≤2KB (текущие in-progress, blocked, последние события)
- [x] **CLI-05**: Весь вывод CLI капирован и без декора (ноль эмодзи/баннеров); контракт размеров зафиксирован в спеке и проверяется тестом

### Decisions & Recall (DEC)

- [x] **DEC-01**: `kdd decide "title"` создаёт md-решение в `.planning/decisions/YYYY-MM-DD-slug.md` (Decision/Rationale/Alternatives/Supersedes/Outcome) и индексирует его
- [x] **DEC-02**: `kdd recall "query"` ищет по решениям и задачам через FTS5 BM25, top-k с капом; повторная запись того же контента возвращает success «уже записано» (content-hash)
- [x] **DEC-03**: `kdd rebuild` полностью пересобирает индекс из md-файлов и SQLite; md-директория самодостаточна (exit-гарантия)

### Web UI (UI)

- [ ] **UI-01**: `kdd ui` поднимает локальный сервер (Hono) с канбан-доской: колонки по статусам, drag-n-drop двигает задачу через ту же стейт-машину
- [ ] **UI-02**: Пользователь может создать и отредактировать задачу в UI: title, markdown-описание (с рендером), приоритет
- [ ] **UI-03**: Пользователь может комментировать задачу в UI; комментарии от `user` и `ai` визуально различимы
- [ ] **UI-04**: Изменения, сделанные Claude через CLI, видны в UI без перезапуска (поллинг/refresh)

### Claude Integration (INT)

- [ ] **INT-01**: Тонкий MCP-сервер выставляет 3–4 тула поверх того же ядра (get_task, list_tasks/board, update_task, recall) для UI-сервера и не-CLI сценариев
- [ ] **INT-02**: Skill-контракт учит Claude протоколу доски: pull-модель, когда читать status/recall, как писать комментарии и решения, Iron Laws (никаких массовых правок доски без запроса пользователя)
- [ ] **INT-03**: SessionStart-хук ≤3 строк сообщает «субстрат есть: kdd status / kdd recall», всегда exit 0, ошибки — в таблицу errors
- [ ] **INT-04**: Плагин устанавливается как Claude Code plugin (skills + MCP + CLI через npx), работает на Windows

## v2 Requirements (deferred)

- **V2-01**: Staleness-release, DAG зависимостей задач, worktree-привязка задач — v0.5 исследования
- **V2-02**: `acceptance_criteria[]` / `non_goals[]` поля, MMR+recency в recall, handoff-строки сессий
- **V2-03**: claim/lease, per-column гейты для агентов, waiting_on_human + Q&A-поля
- **V2-04**: Telegram outbound-уведомления (notify_target + cursor-доставка), `kdd wait`/`kdd probe`
- **V2-05**: Answer-daemon (ответы из Telegram), эпизодическая память, git-снапшот доски

## Out of Scope

- Push-инъекция памяти в контекст — антипаттерн ruflo; только pull
- Оркестратор/workflow-движок, авто-агенты (BA/planner/tester) — исполнитель делает работу, KDD хранит состояние
- Эмбеддинги/векторный поиск — FTS5 достаточен до доказанного провала
- Multi-user, auth, Jira/ADO-sync — локальный однопользовательский инструмент
- Test-run/readiness-скоринг — отдельный плагин поверх субстрата
- Спринты/фазы как сущности — это вьюхи над одним списком задач (v2 UI)

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STORE-01 | Phase 1 | Complete |
| STORE-02 | Phase 1 | Complete |
| STORE-03 | Phase 1 | Complete |
| STORE-04 | Phase 1 | Complete |
| CLI-01 | Phase 1 | Complete |
| CLI-02 | Phase 1 | Complete |
| CLI-03 | Phase 1 | Complete |
| CLI-04 | Phase 1 | Complete |
| CLI-05 | Phase 1 | Complete |
| DEC-01 | Phase 2 | Complete |
| DEC-02 | Phase 2 | Complete |
| DEC-03 | Phase 2 | Complete |
| UI-01 | Phase 3 | Pending |
| UI-02 | Phase 3 | Pending |
| UI-03 | Phase 3 | Pending |
| UI-04 | Phase 3 | Pending |
| INT-01 | Phase 4 | Pending |
| INT-02 | Phase 4 | Pending |
| INT-03 | Phase 4 | Pending |
| INT-04 | Phase 4 | Pending |

**Coverage:** 20/20 v1 requirements mapped. No orphans, no duplicates.
