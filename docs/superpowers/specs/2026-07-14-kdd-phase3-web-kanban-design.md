# KDD Phase 3 — Web Kanban: Design Spec

**Date:** 2026-07-14
**Requirements:** UI-01, UI-02, UI-03, UI-04 (`.planning/REQUIREMENTS.md`)
**Depends on:** Phase 1 (`@kddkit/core` store + state machine), Phase 2 не требуется.

## Goal

`kdd ui` поднимает локальный веб-сервер с kanban-доской над той же SQLite-базой,
которую использует CLI. Пользователь двигает карточки drag-n-drop'ом, создаёт и
редактирует задачи, комментирует; изменения Claude через CLI появляются в UI без
перезапуска (поллинг).

## Architecture

Один новый пакет **`packages/ui`** (`@kddkit/ui`), две части:

```
packages/ui/
  src/
    server.ts        # Hono app factory + serve()
    web/             # React SPA (Vite root)
      index.html
      main.tsx
      api.ts         # fetch-обёртки + типы ответов
      components/    # Board, Column, Card, TaskDialog, NewTaskDialog, ...
      ...
  dist/
    server.js        # tsup build of src/server.ts
    public/          # vite build of src/web
  test/
    server.test.ts   # API-тесты через app.request()
  vite.config.ts
  components.json    # shadcn
  package.json
```

- **Сервер** — Hono + `@hono/node-server`. Экспортирует:
  - `createApp(db: Database, opts?: {}): Hono` — чистая фабрика, тестируется без сокетов через `app.request()`.
  - `startUi(db: Database, port: number): Promise<{ url: string; close(): void }>` — serve + статика.
  - Статика: `serveStatic` из `@hono/node-server/serve-static` поверх `dist/public`, fallback на `index.html`.
- **Фронт** — React 19 + Vite + Tailwind v4 + shadcn (skill `shadcn` при имплементации), drag-n-drop через `@dnd-kit/core`, markdown-рендер через `react-markdown`.
- **CLI** — `@kddkit/cli` получает команду `kdd ui [--port <n>]` (default **4499**), импортирует `startUi` из `@kddkit/ui`. Вывод: одна строка `kdd ui: http://localhost:4499` (без эмодзи, без автооткрытия браузера). Ctrl+C останавливает.
- В npm-пакет `@kddkit/ui` попадает `dist/` целиком (собранная статика + сервер) — пользователю билд не нужен.

## Actor model

Все мутации из UI выполняются с актором `{ type: 'user' }` — UI это руки
пользователя. Events и лента задач работают идентично CLI. По решению Phase 1
`checkMove` разрешает `user`-актору любой переход между разными статусами;
отклоняется только drop в тот же статус (`task is already in X`) — сервер всё
равно ходит исключительно через `moveTask`, так что при будущем ужесточении
стейт-машины UI ничего менять не придётся.

## API

Все ответы — JSON. Все мутации через существующие `ops.*` (никакой логики в сервере).

| Method & Route | Body | Core call | Response 200 |
|---|---|---|---|
| `GET /api/board` | — | `boardData(db)` | `Record<Status, Task[]>` |
| `GET /api/tasks/:id` | — | `taskDetail(db, id)` | `{ task, comments, events, links }` |
| `POST /api/tasks` | `{ title, body?, priority? }` | `addTask` | `Task` |
| `PATCH /api/tasks/:id` | `{ title?, body?, priority? }` | `editTask` | `Task` |
| `POST /api/tasks/:id/move` | `{ to: Status }` | `moveTask` | `Task` |
| `POST /api/tasks/:id/comments` | `{ body }` | `commentTask` | `Comment` |
| `GET /api/version` | — | `SELECT MAX(id) FROM events` | `{ version: number }` |

**Error contract:**

- `KddError` → **400** `{ "error": "<message>" }` (текст ошибки ядра как есть, включая «task is already in X», «task #N not found» и т.п.; not-found из `mustGetTask` — тоже 400, отдельный 404 не выделяем — клиенту всё равно).
- Невалидный JSON / отсутствующие обязательные поля → **400** `{ "error": "…" }`.
- Неожиданное исключение → **500** `{ "error": "internal error" }`.
- Клиент на любой не-2xx при drag откатывает карточку на место и показывает toast (`sonner` из shadcn) с текстом `error`.

## Frontend

**Board (главный и единственный экран):**

- Колонки — `STATUSES` из core (`backlog / new / in_progress / review / done`), в шапке колонки имя + счётчик.
- Карточка: `#N`, title, бейдж приоритета (цвет по semantic-токенам), метка `blocked` если `blocked = 1`. Клик — открывает TaskDialog.
- Drag-n-drop: `@dnd-kit/core` (`DndContext` + `useDraggable`/`useDroppable`, droppable = колонка; сортировка внутри колонки НЕ входит в scope). Оптимистичное перемещение: карточка сразу встаёт в новую колонку, при ошибке сервера — откат + toast.
- Кнопка «New task» → NewTaskDialog.

**TaskDialog** (shadcn `Dialog`):

- Просмотр: title, приоритет, статус, body отрендерен `react-markdown`.
- Режим редактирования: `Input` (title), `Textarea` (markdown body), `Select` (priority) → `PATCH`.
- Комментарии: список снизу; `user` — нейтральный стиль, `ai` — визуально отличим (бейдж `ai` + `muted`-фон карточки комментария; author-строка из `comments.author`, напр. `ai:sess-xyz`). Форма добавления → `POST .../comments`.
- Лента событий НЕ показывается (v2; есть `kdd show`).

**NewTaskDialog:** title (required), body (optional textarea), priority (select, default `medium`) → `POST /api/tasks`.

**Polling (UI-04):** хук `useVersion(intervalMs = 2000)` дёргает `GET /api/version`;
при изменении версии рефетчит доску и — если открыт TaskDialog — детали открытой
задачи. Мутация из UI тоже просто повышает версию: единый путь обновления,
отдельной инвалидации не нужно (свою мутацию клиент и так применил оптимистично).

## Build & distribution

- `packages/ui/package.json`:
  - `build`: `tsup src/server.ts --format esm --dts --clean && vite build --outDir dist/public --emptyOutDir` — именно в этом порядке: `tsup --clean` вычищает `dist`, поэтому идёт первым; vite пишет в `dist/public` после. Инвариант (проверяется тестом на существование файлов): после `build` есть и `dist/server.js`, и `dist/public/index.html`.
  - `test`: `vitest run --passWithNoTests`.
  - `files: ["dist"]`, `main: ./dist/server.js`.
- `turbo.json` не меняется: `build` уже имеет `dependsOn: ["^build"]`, `outputs: ["dist/**"]`; `@kddkit/cli` добавляет `@kddkit/ui` в `dependencies` → turbo сам выстроит порядок core → ui → cli.
- Новые runtime-зависимости пакета ui: `hono`, `@hono/node-server`, `react`, `react-dom`, `react-markdown`, `@dnd-kit/core`, `sonner` + dev: `vite`, `@vitejs/plugin-react`, `tailwindcss` (+ `@tailwindcss/vite`), shadcn-компоненты (копируются в репо). core и cli новых зависимостей не получают (cli — только workspace-ссылку на ui).

## Testing

Серверные API-тесты (`packages/ui/test/server.test.ts`, in-memory db, `app.request()` — без сокетов):

1. `GET /api/board` — пять колонок, задачи в своих статусах.
2. `POST /api/tasks` — создаёт, event записан, `actor_type = 'user'`.
3. `PATCH /api/tasks/:id` — меняет title/body/priority.
4. `POST /move` валидный — 200, статус изменён; в тот же статус — 400 с `already in`.
5. `POST /comments` — 200, `taskDetail` его возвращает.
6. `GET /api/version` — растёт после мутации.
7. Несуществующий id → 400 `{error}`; кривой JSON → 400.
8. Неизвестный `/api/*` путь → 404.

CLI-тест: `kdd ui --port 0`-вариант НЕ тестируем e2e (сокеты + статика — ручной смок); команда тонкая (парсинг флага + вызов `startUi`).

Фронт: без автотестов — вся логика в core (покрыт) и сервере (покрыт выше); UI проверяется ручным смоком по чек-листу success criteria UI-01..04.

## Out of scope (v2)

- Сортировка карточек внутри колонки перетаскиванием (position).
- Archive / block / unblock / links из UI (есть в CLI).
- Просмотр решений и recall в UI.
- Лента событий задачи в UI.
- SSE/WebSocket, auth, multi-user, тёмная тема сверх дефолта shadcn.
