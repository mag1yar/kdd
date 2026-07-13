# KDD Phase 1 — Store & CLI Core: Design

Дата: 2026-07-14. Статус: согласовано в брейншторме.
Покрывает требования: STORE-01..04, CLI-01..05 (без DEC — это Phase 2).

## Цель

Центральный SQLite-стор задач вне git (один на проект, общий для всех worktree) + стейт-машина статусов в коде + CLI-глаголы как основной интерфейс Claude. После фазы доска полностью живёт в терминале.

## Контекст и решения

- v1 — «режим документирования»: пользователь ведёт доску (позже через web-UI), Claude читает/редактирует по команде пользователя. Никакой автономности.
- Референсы: hermes-agent (файл-на-проект, task_comments, task_events, капы контекста), agent-kanban (CHECK-констрейнты, priority enum, position, закрытый словарь действий аудита). Схема ниже — их пересечение минус агентская механика.
- Будущее (v2: агенты, конфигурируемые колонки, гейты по актору) закладывается схемой (actor-поля, events, сигнатуры), механика не пишется.

## Архитектура

Монорепо (pnpm workspaces + turborepo):

```
kdd/
  packages/core   — открытие БД, схема, стейт-машина, операции (better-sqlite3, WAL)
  packages/cli    — бинарь kdd: тонкий argv-парсер, зовёт core напрямую
  apps/web        — Phase 3: React + Vite + shadcn (Base UI), здесь НЕ создаётся
  turbo.json
```

- Ноль демонов: каждый вызов `kdd ...` открывает SQLite, работает, выходит. Конкуренцию worktree разруливает WAL + busy_timeout 5s.
- MCP (Phase 4) и UI-сервер Hono (Phase 3) импортируют тот же core. UI-стек Phase 3: React + Vite + shadcn на Base UI-примитивах (док: https://base-ui.com/llms.txt), Hono = API + статика; dnd зовёт ту же `move()`.
- Дистрибуция: публикуется один пакет (cli), core бандлится (tsup). Windows — first-class.
- Нейминг: npm-скоуп `@kddkit` (org создан), пакеты `@kddkit/cli` (bin `kdd`, установка `npx @kddkit/cli`) и `@kddkit/core`; GitHub — `mag1yar/kdd`. Пакет `kdd` на npm занят чужим — поэтому scoped.

## Резолв базы

Ключ проекта = `git rev-parse --path-format=absolute --git-common-dir` → одна база для всех worktree.
Путь: `~/.kdd/<sha256(git-common-dir).slice(0,16)>/kdd.db`. Создаётся лениво при первой записи.
Вне git-репо: `error: not in a git repository (kdd resolves its store via git)`, exit 1.
Env-override `KDD_DB` — прямой путь к базе (тесты, нестандартные сценарии).

Мульти-проект: каждый репо на машине автоматически получает свою базу при первой записи (ноль конфигурации, в отличие от ручных boards у hermes). Worktree одного репо делят одну базу (git-common-dir общий). Зоны и задачи живут внутри проекта, кросс-проектного ничего нет. `kdd projects` перечисляет все базы в `~/.kdd` с путями проектов (из таблицы meta) — это же спасает доску при переезде папки проекта (hash меняется, но старая база находится по project_path).

Миграции: `PRAGMA user_version` + упорядоченный массив миграций в core, прогоняются при открытии базы (подход agent-kanban с нумерованными миграциями; НЕ идемпотентные ALTER-повторы hermes). База переживает обновления плагина.

## Схема БД

```sql
CREATE TABLE tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,     -- отображается как #42
  title        TEXT NOT NULL,
  body         TEXT,                                  -- markdown
  status       TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('backlog','new','in_progress','review','done')),
  blocked      INTEGER NOT NULL DEFAULT 0,
  block_reason TEXT,
  priority     TEXT NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low','medium','high','urgent')),
  area         TEXT,                                  -- зона (справочники/договор/клиент)
  position     INTEGER NOT NULL DEFAULT 0,            -- ручной порядок в колонке (dnd, Phase 3)
  archived_at  INTEGER,                               -- мягкое удаление; NULL = активна
  created_at   INTEGER NOT NULL,                      -- unix epoch seconds
  updated_at   INTEGER NOT NULL
);

CREATE TABLE meta (                                   -- k/v: project_path, created_at
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id),
  author     TEXT NOT NULL,                           -- 'user' | 'ai:<session_id>'
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE task_links (
  from_id INTEGER NOT NULL REFERENCES tasks(id),
  to_id   INTEGER NOT NULL REFERENCES tasks(id),
  kind    TEXT NOT NULL DEFAULT 'relates_to',
  PRIMARY KEY (from_id, to_id, kind)
);

CREATE TABLE events (                                 -- append-only аудит
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER REFERENCES tasks(id),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','ai')),
  actor_id   TEXT,                                    -- session_id для ai
  action     TEXT NOT NULL CHECK (action IN
             ('created','moved','edited','commented','blocked','unblocked','linked','archived','unarchived')),
  detail     TEXT,                                    -- JSON, напр. {"from":"new","to":"done"}
  created_at INTEGER NOT NULL
);

CREATE TABLE errors (                                 -- сюда пишут хуки (всегда exit 0)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT, message TEXT, created_at INTEGER NOT NULL
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_comments_task ON comments(task_id, created_at);
CREATE INDEX idx_events_task ON events(task_id, created_at);
```

Решения: comments отдельно от events (разговор ≠ аудит); blocked — флаг, не статус (задача не теряет колонку); удаление только мягкое — `archived_at` (тоже флаг, не статус: задача помнит свою колонку; hard delete в v1 нет вовсе, данные не теряются); position в схеме сразу, чтобы Phase 3 обошлась без миграции; FTS5-таблицы появятся в Phase 2 рядом, эту схему не трогают. Каждая мутация задачи = ровно одно событие в events, в одной транзакции с мутацией.

Семантика статусов: `backlog` = отложено до лучших времён (icebox); `new` = надо делать (дефолт при создании; анализ задачи происходит, пока она в new); `in_progress` = взято в работу; `review` = пользователь проверяет (код-ревю + дизайн); `done` = смержено и прибрано (worktree удалён). Конвенция: done двигает тот, кто закончил финальную работу — обычно Claude после squash/push/cleanup, по слову пользователя «принято».

Зоны: `area` — одно текстовое поле, без справочника зон; список зон = `SELECT DISTINCT area`. UI (Phase 3) даёт селект-фильтр как в Azure DevOps; CLI — `--area`.

## Стейт-машина

Единственная точка записи статуса — `move(taskId, to, actor, reason?)` в core.

```ts
type Status = 'backlog' | 'new' | 'in_progress' | 'review' | 'done';

const TRANSITIONS: Record<Status, Status[]> = {
  backlog:     ['new'],
  new:         ['backlog', 'in_progress'],
  in_progress: ['new', 'review'],
  review:      ['in_progress', 'done'],   // «не принято» → назад в работу
  done:        ['review'],                // переоткрытие — осознанное
};
```

Правила по актору:
- **user**: любой переход разрешён; событие `moved {"from","to"}` фиксирует это — Claude видит и не спорит с доской.
- **ai**: по матрице — свободно; прыжок мимо матрицы — только с `reason` (`kdd move #7 done --reason "пропустили review по просьбе пользователя"`). Reason автоматически пишется комментарием + событием. Без reason — отказ: `invalid transition new → done for ai; adjacent: backlog, in_progress; pass --reason if user requested a skip`.
- `block`/`unblock` — не переходы: меняют флаг при любом статусе, пишут событие.

Актор определяется env: `KDD_ACTOR=ai` ставит skill/хук Claude; без переменной = `user`. Гейты «кому какой переход можно» сверх этого — v2 (один if в move()).

## CLI-глаголы

CLI — интерфейс и для Claude, и для пользователя (терминал — равноправная альтернатива web-UI). Парсер: `commander` (как в agent-kanban) — даёт `--help` по каждой команде, внятные ошибки и подсказки опечаток. Runtime-зависимости Phase 1: `better-sqlite3` + `commander`, всё.

SQLite-драйвер: `node:sqlite` проверен 2026-07-14 на Node 22 — работает, но experimental: печатает warning в stderr при каждом запуске (ломает контракт чистого вывода) и отсутствует на Node 20. Решение: better-sqlite3; пересмотреть, когда полом станет Node 24.

```
kdd add "title" [--body md] [--priority low|medium|high|urgent] [--area X]   → "#42 created"
kdd board [--area X] [--status S]        текстовая доска: колонки → задачи
kdd show #42                             поля, body, связи, комментарии, лента событий
kdd move #42 <status> [--reason "..."]   через стейт-машину
kdd edit #42 [--title X] [--body X] [--priority X] [--area X]
kdd comment #42 "text"
kdd block #42 "reason" | kdd unblock #42
kdd link #42 #17 [--kind relates_to]
kdd archive #42 | kdd unarchive #42      мягкое удаление/восстановление
kdd status                               digest проекта ≤2KB
kdd projects                             все доски на машине (путь проекта → база)
kdd export                               полный JSON-дамп доски в stdout (бэкап)
```

Длинный markdown: `--body-file <path>` и `--body -` (stdin) у add/edit — многострочный md в аргументе PowerShell неюзабелен. Доска, status и board показывают только неархивные задачи (`archived_at IS NULL`); `board --archived` — посмотреть архив.

Порядок в списках: `ORDER BY priority DESC, position, created_at` (внутри колонки).

### Контракты вывода (проверяются тестами — требование CLI-05)

- Ноль эмодзи, баннеров, ASCII-арта.
- `status` ≤2KB: in_progress, blocked, review, последние события.
- `board` ≤4KB: заголовки обрезаются с видимым счётчиком `… [+N chars]` (приём hermes).
- `show`: body кап 8KB, комментарии — последние N с пометкой `(N earlier omitted)`.
- У каждой команды `--json`: тот же результат объектом (для MCP, UI, скриптов).

## Ошибки

- Одна строка в stderr + exit 1; с `--json` — `{"error":"..."}`. Стектрейсы наружу не летят.
- Несуществующий #id, кривой статус/приоритет — валидация в core до записи; CHECK в БД — страховка.
- Параллельные вызовы (два worktree сразу): WAL + busy_timeout ждут, не падают.

## Тестирование (TDD, vitest)

1. **Стейт-машина** — табличный тест всей матрицы: 25 пар × 2 актора, reason-обход, user-свобода.
2. **Контракты размеров** — доска из 100 задач: `status` ≤2KB, `board` ≤4KB, нет эмодзи.
3. **Core-операции** — реальная better-sqlite3 `:memory:`, без моков: add/move/comment/link пишут событие, лента задачи читается одним запросом, транзакционность мутация+событие.
4. **CLI smoke** — прогон бинаря на временной базе (KDD_DB): add → board → move → show → status.

## Вне скоупа Phase 1

- decide/recall/rebuild, FTS5 — Phase 2.
- Web-UI, Hono, drag-n-drop — Phase 3 (схема уже готова: position, area).
- MCP, skill-контракт, SessionStart-хук, npx-плагин — Phase 4.
- Claim/lease, гейты по актору, Telegram, cron — v2 (см. REQUIREMENTS.md V2-01..05).
- Hard delete задач — v2, если архив докажет нехватку.
- Привязка задачи к конкретному worktree — V2-01.
