# KDD Phase 3 — Web Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `kdd ui` поднимает локальный Hono-сервер с React-kanban-доской над той же SQLite-базой, что и CLI: drag-n-drop, создание/редактирование задач, комментарии, поллинг.

**Architecture:** Новый пакет `packages/ui` (`@kddkit/ui`): Hono-сервер (`createApp` — чистая фабрика, тестируется через `app.request()`; `startUi` — сокет + статика) и React SPA (`src/web`, Vite → `dist/public`). Все мутации через существующие `ops.*` из `@kddkit/core` с актором `{type:'user'}`. CLI добавляет команду `kdd ui`.

**Tech Stack:** Hono + @hono/node-server, React 19 + Vite 7 + Tailwind v4 + shadcn (skill `shadcn`), @dnd-kit/core, react-markdown, sonner, vitest 4, tsup, pnpm + turbo (skill `turborepo`).

**Spec:** `docs/superpowers/specs/2026-07-14-kdd-phase3-web-kanban-design.md`

## Global Constraints

- Ветка `phase-3-web-kanban` от master; коммит на задачу; **никакой Claude-атрибуции/трейлеров в коммитах**.
- Вывод CLI без эмодзи/баннеров; `kdd ui` печатает ровно `kdd ui: http://localhost:<port>`; default port **4499**.
- Сервер не содержит бизнес-логики: только маппинг HTTP → `ops.*`/`queries.*` с актором `{ type: 'user' }`.
- Error contract: `KddError` → **400** `{"error": msg}` (текст ядра как есть); кривой JSON → **400** `{"error":"invalid JSON body"}`; неожиданное исключение → **500** `{"error":"internal error"}`; `GET /api/<неизвестное>` → **404**.
- Поллинг версии: **2000 мс**, `GET /api/version` = `COALESCE(MAX(id),0)` из `events`.
- Runtime-зависимости `@kddkit/ui`: только `@kddkit/core`, `hono`, `@hono/node-server`. Всё фронтендовое — devDependencies (Vite бандлит в статику).
- Билд ui строго в порядке: `tsup … --clean && vite build` (tsup чистит `dist`, vite пишет в `dist/public` после). Инвариант: после build существуют `dist/server.js` и `dist/public/index.html`.
- DnD только между колонками; сортировки внутри колонки нет. Archive/block/лента событий в UI не делаются (v2).
- Node >= 22, pnpm@11; turbo-таски уже настроены (`build` dependsOn `^build`, outputs `dist/**`; `test` dependsOn `build`) — `turbo.json` не трогать.
- Команды выполняются из корня репо (Windows, PowerShell-совместимые).

---

### Task 0: Ветка

- [ ] `git checkout -b phase-3-web-kanban` (от master).

---

### Task 1: Пакет @kddkit/ui + createApp (read-роуты)

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/server.ts`
- Test: `packages/ui/test/server.test.ts`

**Interfaces:**
- Consumes: `openDb`, `boardData`, `taskDetail`, `addTask`, `KddError` из `@kddkit/core`.
- Produces: `createApp(db: Database.Database): Hono` — JSON API; хелперы `taskId(c)`, `jsonBody(c)` (внутренние). Задачи 2–3 дописывают роуты в этот же файл.

- [ ] **Step 1: Создать package.json и tsconfig**

`packages/ui/package.json`:

```json
{
  "name": "@kddkit/ui",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/server.js",
  "types": "./dist/server.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/server.ts --format esm --dts --clean",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@kddkit/core": "workspace:*",
    "@hono/node-server": "^1.19.0",
    "hono": "^4.9.0"
  },
  "devDependencies": {
    "@types/node": "^22.18.0",
    "tsup": "^8.5.1",
    "vitest": "^4.1.10"
  }
}
```

`packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/web/*"] }
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

Run: `pnpm install`
Expected: lockfile обновлён, `@kddkit/ui` в workspace.

- [ ] **Step 2: Failing test — read-роуты**

`packages/ui/test/server.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { addTask, openDb } from '@kddkit/core';
import { createApp } from '../src/server.js';

const user = { type: 'user' } as const;
const mk = () => {
  const db = openDb(':memory:', 'x');
  return { db, app: createApp(db) };
};

describe('GET /api/board', () => {
  it('returns five columns with tasks grouped by status', async () => {
    const { db, app } = mk();
    addTask(db, { title: 'hello board' }, user);
    const res = await app.request('/api/board');
    expect(res.status).toBe(200);
    const b = (await res.json()) as Record<string, { title: string }[]>;
    expect(Object.keys(b)).toEqual(['backlog', 'new', 'in_progress', 'review', 'done']);
    expect(b.new.map((t) => t.title)).toEqual(['hello board']);
  });
});

describe('GET /api/version', () => {
  it('is 0 on empty db and grows after a mutation', async () => {
    const { db, app } = mk();
    expect(await (await app.request('/api/version')).json()).toEqual({ version: 0 });
    addTask(db, { title: 'x' }, user);
    const { version } = (await (await app.request('/api/version')).json()) as { version: number };
    expect(version).toBeGreaterThan(0);
  });
});

describe('GET /api/tasks/:id', () => {
  it('returns task detail with comments and events', async () => {
    const { db, app } = mk();
    const t = addTask(db, { title: 'detail me' }, user);
    const res = await app.request(`/api/tasks/${t.id}`);
    expect(res.status).toBe(200);
    const d = (await res.json()) as { task: { title: string }; comments: unknown[]; events: unknown[] };
    expect(d.task.title).toBe('detail me');
    expect(Array.isArray(d.comments)).toBe(true);
    expect(d.events.length).toBe(1);
  });

  it('unknown id → 400 with error text', async () => {
    const { app } = mk();
    const res = await app.request('/api/tasks/999');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/not found/);
  });

  it('non-numeric id → 400', async () => {
    const { app } = mk();
    expect((await app.request('/api/tasks/abc')).status).toBe(400);
  });
});
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `pnpm --filter @kddkit/ui exec vitest run`
Expected: FAIL — `Cannot find module '../src/server.js'` (или equivalent).

- [ ] **Step 4: Реализовать createApp**

`packages/ui/src/server.ts`:

```ts
import type Database from 'better-sqlite3';
import { Hono, type Context } from 'hono';
import { KddError, boardData, taskDetail } from '@kddkit/core';

const USER = { type: 'user' } as const;

function taskId(c: Context): number {
  const raw = c.req.param('id');
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new KddError(`invalid task id '${raw}'`);
  return n;
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    throw new KddError('invalid JSON body');
  }
}

export function createApp(db: Database.Database): Hono {
  const app = new Hono();

  app.onError((e, c) => {
    if (e instanceof KddError) return c.json({ error: e.message }, 400);
    console.error(e);
    return c.json({ error: 'internal error' }, 500);
  });

  app.get('/api/board', (c) => c.json(boardData(db)));

  app.get('/api/version', (c) => c.json({
    version: (db.prepare(`SELECT COALESCE(MAX(id), 0) AS v FROM events`).get() as { v: number }).v,
  }));

  app.get('/api/tasks/:id', (c) => c.json(taskDetail(db, taskId(c))));

  return app;
}
```

Примечание: `USER`, `jsonBody` пока не используются — их подключит Task 2 (если линтер/tsc ругается на unused, добавить их в Task 2, а не здесь; tsc с `noUnusedLocals` в базовом конфиге не включён — оставить).

- [ ] **Step 5: Тесты зелёные**

Run: `pnpm --filter @kddkit/ui exec vitest run`
Expected: PASS (5 тестов).

- [ ] **Step 6: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): scaffold @kddkit/ui with read-only json api"
```

---

### Task 2: Мутационные роуты + error contract

**Files:**
- Modify: `packages/ui/src/server.ts` (добавить роуты внутрь `createApp` перед `return app`)
- Test: `packages/ui/test/server.test.ts` (дописать)

**Interfaces:**
- Consumes: `addTask`, `editTask`, `moveTask`, `commentTask` из `@kddkit/core`; `taskId`, `jsonBody`, `USER` из Task 1.
- Produces: `POST /api/tasks`, `PATCH /api/tasks/:id`, `POST /api/tasks/:id/move`, `POST /api/tasks/:id/comments`.

- [ ] **Step 1: Failing tests — дописать в `test/server.test.ts`**

```ts
describe('POST /api/tasks', () => {
  it('creates a task with actor user', async () => {
    const { db, app } = mk();
    const res = await app.request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'from ui', priority: 'high' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const t = (await res.json()) as { id: number; priority: string };
    expect(t.priority).toBe('high');
    const ev = db.prepare(`SELECT actor_type, action FROM events WHERE task_id = ?`).all(t.id);
    expect(ev).toEqual([{ actor_type: 'user', action: 'created' }]);
  });

  it('empty title → 400', async () => {
    const { app } = mk();
    const res = await app.request('/api/tasks', {
      method: 'POST', body: JSON.stringify({ title: '  ' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/title/);
  });

  it('invalid JSON body → 400', async () => {
    const { app } = mk();
    const res = await app.request('/api/tasks', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid JSON body');
  });
});

describe('PATCH /api/tasks/:id', () => {
  it('edits title, body and priority', async () => {
    const { db, app } = mk();
    const t = addTask(db, { title: 'old' }, user);
    const res = await app.request(`/api/tasks/${t.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'new', body: '# md', priority: 'urgent' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const u = (await res.json()) as { title: string; body: string; priority: string };
    expect([u.title, u.body, u.priority]).toEqual(['new', '# md', 'urgent']);
  });
});

describe('POST /api/tasks/:id/move', () => {
  it('moves through the state machine', async () => {
    const { db, app } = mk();
    const t = addTask(db, { title: 'm' }, user);
    const res = await app.request(`/api/tasks/${t.id}/move`, {
      method: 'POST', body: JSON.stringify({ to: 'in_progress' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(((await res.json()) as { status: string }).status).toBe('in_progress');
  });

  it('same-status move → 400 already in', async () => {
    const { db, app } = mk();
    const t = addTask(db, { title: 'm' }, user);
    const res = await app.request(`/api/tasks/${t.id}/move`, {
      method: 'POST', body: JSON.stringify({ to: 'new' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/already in/);
  });
});

describe('POST /api/tasks/:id/comments', () => {
  it('adds a user comment visible in detail', async () => {
    const { db, app } = mk();
    const t = addTask(db, { title: 'c' }, user);
    const res = await app.request(`/api/tasks/${t.id}/comments`, {
      method: 'POST', body: JSON.stringify({ body: 'hi from ui' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { author: string }).author).toBe('user');
    const d = (await (await app.request(`/api/tasks/${t.id}`)).json()) as
      { comments: { body: string }[] };
    expect(d.comments.map((x) => x.body)).toEqual(['hi from ui']);
  });
});

describe('unknown api route', () => {
  it('GET /api/nope → 404', async () => {
    const { app } = mk();
    expect((await app.request('/api/nope')).status).toBe(404);
  });
});
```

- [ ] **Step 2: Убедиться, что новые тесты падают**

Run: `pnpm --filter @kddkit/ui exec vitest run`
Expected: FAIL — 404 вместо 200 на POST/PATCH (роутов нет).

- [ ] **Step 3: Добавить роуты в `createApp`** (перед `return app`; расширить импорт core)

```ts
import {
  KddError, addTask, boardData, commentTask, editTask, moveTask, taskDetail,
  type Priority,
} from '@kddkit/core';
```

```ts
  app.post('/api/tasks', async (c) => {
    const b = await jsonBody(c);
    return c.json(addTask(db, {
      title: String(b.title ?? ''),
      body: b.body as string | undefined,
      priority: b.priority as Priority | undefined,
    }, USER));
  });

  app.patch('/api/tasks/:id', async (c) => {
    const b = await jsonBody(c);
    return c.json(editTask(db, taskId(c), {
      title: b.title as string | undefined,
      body: b.body as string | undefined,
      priority: b.priority as Priority | undefined,
    }, USER));
  });

  app.post('/api/tasks/:id/move', async (c) => {
    const b = await jsonBody(c);
    return c.json(moveTask(db, taskId(c), String(b.to ?? ''), USER));
  });

  app.post('/api/tasks/:id/comments', async (c) => {
    const b = await jsonBody(c);
    return c.json(commentTask(db, taskId(c), String(b.body ?? ''), USER));
  });
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @kddkit/ui exec vitest run`
Expected: PASS (13 тестов).

- [ ] **Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): mutation routes over core ops with user actor"
```

---

### Task 3: startUi (сокет + статика) и команда `kdd ui`

**Files:**
- Modify: `packages/ui/src/server.ts` (добавить `mountStatic`, `startUi`)
- Modify: `packages/cli/package.json` (dep `@kddkit/ui`)
- Modify: `packages/cli/src/index.ts` (команда `ui`, импорты)
- Test: `packages/ui/test/startui.test.ts`

**Interfaces:**
- Consumes: `createApp` из Task 1.
- Produces: `startUi(db: Database.Database, port: number): Promise<{ url: string; close: () => void }>` — CLI зовёт её в команде `ui`.

- [ ] **Step 1: Failing test**

`packages/ui/test/startui.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '@kddkit/core';
import { startUi } from '../src/server.js';

describe('startUi', () => {
  it('serves the api on a real socket (port 0 = ephemeral)', async () => {
    const db = openDb(':memory:', 'x');
    const { url, close } = await startUi(db, 0);
    try {
      expect(url).toMatch(/^http:\/\/localhost:\d+$/);
      const res = await fetch(`${url}/api/version`);
      expect(await res.json()).toEqual({ version: 0 });
    } finally { close(); }
  });

  it('GET / without built frontend → 404 ui not built', async () => {
    const db = openDb(':memory:', 'x');
    const { url, close } = await startUi(db, 0);
    try {
      const res = await fetch(url + '/');
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('ui not built');
    } finally { close(); }
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run: `pnpm --filter @kddkit/ui exec vitest run test/startui.test.ts`
Expected: FAIL — `startUi` не экспортирован.

- [ ] **Step 3: Реализовать `mountStatic` и `startUi`** (в конец `src/server.ts`)

```ts
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
```

```ts
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json',
  '.woff2': 'font/woff2',
};

// ponytail: свой static-хендлер ~20 строк — serveStatic из @hono/node-server
// требует root относительно cwd, что ломается при запуске из чужой директории
function mountStatic(app: Hono, publicDir: string): void {
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    const rel = c.req.path === '/' ? 'index.html' : c.req.path.slice(1);
    const file = resolve(publicDir, rel);
    if (!file.startsWith(resolve(publicDir))) return c.notFound();
    for (const p of [file, join(publicDir, 'index.html')]) {
      try {
        const data = await readFile(p);
        return c.body(new Uint8Array(data), 200,
          { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      } catch { /* следующий кандидат */ }
    }
    return c.text('ui not built', 404);
  });
}

export function startUi(
  db: Database.Database, port: number,
): Promise<{ url: string; close: () => void }> {
  const app = createApp(db);
  mountStatic(app, join(dirname(fileURLToPath(import.meta.url)), 'public'));
  return new Promise((res) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      res({ url: `http://localhost:${info.port}`, close: () => server.close() });
    });
  });
}
```

- [ ] **Step 4: Тесты зелёные**

Run: `pnpm --filter @kddkit/ui exec vitest run`
Expected: PASS (15 тестов).

- [ ] **Step 5: Команда `kdd ui`**

`packages/cli/package.json` — dependencies:

```json
"dependencies": { "@kddkit/core": "workspace:*", "@kddkit/ui": "workspace:*", "commander": "^15.0.0" },
```

`packages/cli/src/index.ts` — добавить import и команду (после команды `status`):

```ts
import { startUi } from '@kddkit/ui';
```

в списке импортов из `@kddkit/core` добавить `openDb, resolveDbPath`:

```ts
program.command('ui')
  .option('--port <n>', 'port', '4499')
  .action((o) => run(false, () => {
    const { dbPath, projectPath } = resolveDbPath();
    const db = openDb(dbPath, projectPath); // живёт, пока жив сервер
    void startUi(db, Number(o.port)).then(({ url }) => console.log(`kdd ui: ${url}`));
  }));
```

Run: `pnpm install`, затем `pnpm build`
Expected: build зелёный (turbo: core → ui → cli).

- [ ] **Step 6: Полный прогон + commit**

Run: `pnpm test`
Expected: PASS везде.

```bash
git add packages/ui packages/cli pnpm-lock.yaml
git commit -m "feat(ui,cli): startUi server with static hosting and kdd ui command"
```

---

### Task 4: Фронтенд-скаффолд + read-only доска

**Files:**
- Create: `packages/ui/vite.config.ts`
- Create: `packages/ui/components.json`
- Create: `packages/ui/src/web/index.html`
- Create: `packages/ui/src/web/index.css`
- Create: `packages/ui/src/web/main.tsx`
- Create: `packages/ui/src/web/api.ts`
- Create: `packages/ui/src/web/App.tsx`
- Create: `packages/ui/src/web/components/Board.tsx`
- Modify: `packages/ui/package.json` (devDeps, build script)
- shadcn CLI создаст: `src/web/lib/utils.ts`, `src/web/components/ui/*`

**Interfaces:**
- Consumes: JSON API из Task 1–2.
- Produces: `api.ts` — типы (`STATUSES`, `Status`, `PRIORITIES`, `Priority`, `Task`, `Comment`, `Board`, `TaskDetail`) и функции (`getBoard`, `getVersion`, `getTask`, `createTask`, `editTask`, `moveTask`, `addComment`) — их используют Task 5–6. `Board({ board, onOpen })` — Task 5 перепишет с dnd.

- [ ] **Step 1: Установить фронтенд-зависимости (всё dev)**

Run из корня:

```bash
pnpm --filter @kddkit/ui add -D react react-dom @types/react @types/react-dom vite @vitejs/plugin-react tailwindcss @tailwindcss/vite @tailwindcss/typography tw-animate-css
```

- [ ] **Step 2: vite.config.ts и components.json**

`packages/ui/vite.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/web', import.meta.url)) } },
  build: { outDir: '../../dist/public', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:4499' } }, // dev: vite + kdd ui параллельно
});
```

`packages/ui/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/web/index.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 3: index.css (Tailwind v4 + shadcn-токены, светлая тема)**

`packages/ui/src/web/index.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";
@plugin "@tailwindcss/typography";

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
}
```

(Тёмная тема — out of scope; `.dark`-блок не нужен.)

- [ ] **Step 4: Добавить shadcn-компоненты** (skill `shadcn`; CLI создаст `lib/utils.ts` и `components/ui/*`, поставит radix/cva/clsx/tailwind-merge/lucide)

Run: `cd packages/ui; pnpm dlx shadcn@latest add button badge dialog input label textarea select; cd ../..`
Expected: файлы в `src/web/components/ui/`, `src/web/lib/utils.ts`.

Затем перенести добавленные shadcn'ом prod-зависимости в devDependencies (vite всё бандлит; runtime-deps пакета — только core/hono/@hono/node-server). Открыть `packages/ui/package.json` и перенести всё, что установил shadcn (например `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `radix-ui`/`@radix-ui/*`), из `dependencies` в `devDependencies`. Затем `pnpm install`.

- [ ] **Step 5: index.html, main.tsx, api.ts**

`packages/ui/src/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>kdd</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

`packages/ui/src/web/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
```

`packages/ui/src/web/api.ts`:

```ts
// Типы продублированы из @kddkit/core: ядро тянет better-sqlite3 и в браузер не импортируется.
export const STATUSES = ['backlog', 'new', 'in_progress', 'review', 'done'] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Task {
  id: number; title: string; body: string | null; status: Status;
  blocked: 0 | 1; priority: Priority;
}
export interface Comment { id: number; author: string; body: string; created_at: number; }
export type Board = Record<Status, Task[]>;
export interface TaskDetail { task: Task; comments: Comment[]; }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path,
    init ? { ...init, headers: { 'content-type': 'application/json' } } : undefined);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const getBoard = () => req<Board>('/api/board');
export const getVersion = () => req<{ version: number }>('/api/version');
export const getTask = (id: number) => req<TaskDetail>(`/api/tasks/${id}`);
export const createTask = (b: { title: string; body?: string; priority?: Priority }) =>
  req<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(b) });
export const editTask = (id: number, b: { title?: string; body?: string; priority?: Priority }) =>
  req<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(b) });
export const moveTask = (id: number, to: Status) =>
  req<Task>(`/api/tasks/${id}/move`, { method: 'POST', body: JSON.stringify({ to }) });
export const addComment = (id: number, body: string) =>
  req<Comment>(`/api/tasks/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
```

- [ ] **Step 6: App.tsx и Board.tsx (read-only)**

`packages/ui/src/web/App.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { getBoard, type Board as BoardData } from './api';
import { Board } from './components/Board';

export default function App() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const refetch = useCallback(() => {
    getBoard().then(setBoard).catch(console.error);
  }, []);
  useEffect(() => { refetch(); }, [refetch]);

  if (!board) return null;
  return (
    <div className="flex h-screen flex-col">
      <header className="border-b px-4 py-2">
        <h1 className="text-sm font-semibold">kdd</h1>
      </header>
      <main className="flex-1 overflow-auto">
        <Board board={board} onOpen={() => {}} />
      </main>
    </div>
  );
}
```

`packages/ui/src/web/components/Board.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { STATUSES, type Board as BoardData, type Priority, type Status, type Task } from '../api';

const PRIORITY_VARIANT: Record<Priority, 'default' | 'secondary' | 'destructive' | 'outline'> =
  { urgent: 'destructive', high: 'default', medium: 'secondary', low: 'outline' };

export function Board({ board, onOpen }: {
  board: BoardData; onOpen: (id: number) => void;
}) {
  return (
    <div className="flex items-start gap-4 p-4">
      {STATUSES.map((s) => <Column key={s} status={s} tasks={board[s]} onOpen={onOpen} />)}
    </div>
  );
}

function Column({ status, tasks, onOpen }: {
  status: Status; tasks: Task[]; onOpen: (id: number) => void;
}) {
  return (
    <div className="w-64 shrink-0 rounded-lg bg-muted/50 p-2">
      <div className="flex items-center justify-between px-1 pb-2 text-sm font-medium">
        <span>{status}</span>
        <span className="text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (id: number) => void }) {
  return (
    <div
      className="cursor-pointer rounded-md border bg-card p-2 text-sm shadow-sm"
      onClick={() => onOpen(task.id)}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">#{task.id}</span>
        <Badge variant={PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
        {task.blocked === 1 && <Badge variant="destructive">blocked</Badge>}
      </div>
      <div className="pt-1">{task.title}</div>
    </div>
  );
}
```

- [ ] **Step 7: Обновить build script**

`packages/ui/package.json` scripts:

```json
"build": "tsup src/server.ts --format esm --dts --clean && vite build",
```

- [ ] **Step 8: Проверить сборку**

Run: `pnpm --filter @kddkit/ui build`
Expected: `dist/server.js` и `dist/public/index.html` существуют; `pnpm test` зелёный (тест `ui not built` работает — он импортирует `src/server.js`, где `public` рядом с `src/` нет).

- [ ] **Step 9: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): react board scaffold with vite, tailwind v4 and shadcn"
```

---

### Task 5: Drag-n-drop с оптимистичным move

**Files:**
- Modify: `packages/ui/src/web/components/Board.tsx` (полная замена)
- Modify: `packages/ui/src/web/App.tsx` (полная замена)
- Modify: `packages/ui/package.json` (devDeps)

**Interfaces:**
- Consumes: `moveTask`, `STATUSES` из `api.ts`.
- Produces: `Board({ board, onMove, onOpen })`; в `App` — `onMove(taskId, to)` (оптимистичный) и `refetch`. Task 6 добавит в App диалоги и поллинг.

- [ ] **Step 1: Зависимости**

Run: `pnpm --filter @kddkit/ui add -D @dnd-kit/core sonner`

- [ ] **Step 2: Board.tsx с dnd (полная замена файла)**

```tsx
import {
  DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATUSES, type Board as BoardData, type Priority, type Status, type Task } from '../api';

const PRIORITY_VARIANT: Record<Priority, 'default' | 'secondary' | 'destructive' | 'outline'> =
  { urgent: 'destructive', high: 'default', medium: 'secondary', low: 'outline' };

export function Board({ board, onMove, onOpen }: {
  board: BoardData;
  onMove: (taskId: number, to: Status) => void;
  onOpen: (id: number) => void;
}) {
  // distance 5px: иначе клик по карточке считается драгом и onClick не срабатывает
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id as Status | undefined;
    if (to) onMove(Number(e.active.id), to);
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex items-start gap-4 p-4">
        {STATUSES.map((s) => <Column key={s} status={s} tasks={board[s]} onOpen={onOpen} />)}
      </div>
    </DndContext>
  );
}

function Column({ status, tasks, onOpen }: {
  status: Status; tasks: Task[]; onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn('w-64 shrink-0 rounded-lg bg-muted/50 p-2', isOver && 'ring-2 ring-ring')}
    >
      <div className="flex items-center justify-between px-1 pb-2 text-sm font-medium">
        <span>{status}</span>
        <span className="text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex min-h-8 flex-col gap-2">
        {tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (id: number) => void }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } =
    useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn(
        'cursor-grab rounded-md border bg-card p-2 text-sm shadow-sm',
        isDragging && 'relative z-10 opacity-70',
      )}
      onClick={() => onOpen(task.id)}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">#{task.id}</span>
        <Badge variant={PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
        {task.blocked === 1 && <Badge variant="destructive">blocked</Badge>}
      </div>
      <div className="pt-1">{task.title}</div>
    </div>
  );
}
```

- [ ] **Step 3: App.tsx с оптимистичным move и Toaster (полная замена файла)**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { STATUSES, getBoard, moveTask, type Board as BoardData, type Status } from './api';
import { Board } from './components/Board';

export default function App() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const refetch = useCallback(() => {
    getBoard().then(setBoard).catch((e: Error) => toast.error(e.message));
  }, []);
  useEffect(() => { refetch(); }, [refetch]);

  const onMove = (taskId: number, to: Status) => {
    setBoard((b) => { // оптимистично: карточка сразу в новой колонке
      if (!b) return b;
      const task = STATUSES.flatMap((s) => b[s]).find((t) => t.id === taskId);
      if (!task || task.status === to) return b;
      const next = Object.fromEntries(
        STATUSES.map((s) => [s, b[s].filter((t) => t.id !== taskId)]),
      ) as BoardData;
      next[to] = [...next[to], { ...task, status: to }];
      return next;
    });
    moveTask(taskId, to)
      .catch((e: Error) => toast.error(e.message)) // refetch в finally откатит
      .finally(refetch);
  };

  if (!board) return null;
  return (
    <div className="flex h-screen flex-col">
      <header className="border-b px-4 py-2">
        <h1 className="text-sm font-semibold">kdd</h1>
      </header>
      <main className="flex-1 overflow-auto">
        <Board board={board} onMove={onMove} onOpen={() => {}} />
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
```

- [ ] **Step 4: Сборка зелёная**

Run: `pnpm --filter @kddkit/ui build`
Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): dnd-kit drag between columns with optimistic move"
```

---

### Task 6: TaskDialog, NewTaskDialog, поллинг

**Files:**
- Create: `packages/ui/src/web/components/TaskDialog.tsx`
- Create: `packages/ui/src/web/components/NewTaskDialog.tsx`
- Create: `packages/ui/src/web/useVersion.ts`
- Modify: `packages/ui/src/web/App.tsx` (полная замена — финальная версия)
- Modify: `packages/ui/package.json` (devDep react-markdown)

**Interfaces:**
- Consumes: `getTask`, `editTask`, `createTask`, `addComment`, `getVersion` из `api.ts`; shadcn `dialog/input/label/textarea/select/button/badge`.
- Produces: финальный App — UI-02, UI-03, UI-04 закрыты.

- [ ] **Step 1: Зависимость**

Run: `pnpm --filter @kddkit/ui add -D react-markdown`

- [ ] **Step 2: useVersion.ts**

`packages/ui/src/web/useVersion.ts`:

```ts
import { useEffect, useState } from 'react';
import { getVersion } from './api';

// Поллинг раз в 2с: version = MAX(id) из events; смена значения триггерит эффекты.
export function useVersion(intervalMs = 2000): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = () => getVersion()
      .then(({ version: v }) => { if (alive) setVersion(v); })
      .catch(() => { /* сервер перезапускается — продолжаем поллить */ });
    tick();
    const t = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);
  return version;
}
```

- [ ] **Step 3: TaskDialog.tsx**

`packages/ui/src/web/components/TaskDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  PRIORITIES, addComment, editTask, getTask,
  type Priority, type Task, type TaskDetail,
} from '../api';

export function TaskDialog({ id, version, onClose, onChanged }: {
  id: number | null; version: number; onClose: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (id === null) { setDetail(null); setEditing(false); return; }
    getTask(id).then(setDetail).catch((e: Error) => toast.error(e.message));
  }, [id, version]); // version: изменения из CLI подтягиваются в открытый диалог

  if (id === null || !detail) return null;
  const { task, comments } = detail;

  const submitComment = () => {
    if (!comment.trim()) return;
    addComment(task.id, comment)
      .then(() => { setComment(''); onChanged(); return getTask(task.id).then(setDetail); })
      .catch((e: Error) => toast.error(e.message));
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-muted-foreground">#{task.id}</span>
            <span className="truncate">{task.title}</span>
            <Badge variant="secondary">{task.status}</Badge>
          </DialogTitle>
        </DialogHeader>

        {editing ? (
          <EditForm
            task={task}
            onSaved={() => { setEditing(false); onChanged(); getTask(task.id).then(setDetail); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="prose prose-sm max-w-none">
              <Markdown>{task.body ?? ''}</Markdown>
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-3">
          {comments.map((c) => (
            <div
              key={c.id}
              className={cn('rounded-md border p-2 text-sm', c.author !== 'user' && 'bg-muted')}
            >
              <div className="flex items-center gap-2 pb-1 text-xs text-muted-foreground">
                {c.author !== 'user' && <Badge variant="outline">ai</Badge>}
                <span>{c.author}</span>
                <span>{new Date(c.created_at * 1000).toLocaleString()}</span>
              </div>
              <div className="whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Comment..."
              onKeyDown={(e) => { if (e.key === 'Enter') submitComment(); }}
            />
            <Button size="sm" onClick={submitComment}>Send</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ task, onSaved, onCancel }: {
  task: Task; onSaved: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? '');
  const [priority, setPriority] = useState<Priority>(task.priority);
  const save = () => {
    editTask(task.id, { title, body, priority })
      .then(onSaved)
      .catch((e: Error) => toast.error(e.message));
  };
  return (
    <div className="flex flex-col gap-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea
        rows={8} value={body} placeholder="markdown body"
        onChange={(e) => setBody(e.target.value)}
      />
      <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button size="sm" onClick={save}>Save</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: NewTaskDialog.tsx**

`packages/ui/src/web/components/NewTaskDialog.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PRIORITIES, createTask, type Priority } from '../api';

export function NewTaskDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');

  const create = () => {
    createTask({ title, body: body || undefined, priority })
      .then(() => {
        setTitle(''); setBody(''); setPriority('medium');
        onCreated(); onClose();
      })
      .catch((e: Error) => toast.error(e.message));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-2">
          <Input value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
          <Textarea
            rows={6} value={body} placeholder="markdown body (optional)"
            onChange={(e) => setBody(e.target.value)}
          />
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div>
            <Button size="sm" onClick={create}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: App.tsx — финальная версия (полная замена файла)**

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { STATUSES, getBoard, moveTask, type Board as BoardData, type Status } from './api';
import { Board } from './components/Board';
import { NewTaskDialog } from './components/NewTaskDialog';
import { TaskDialog } from './components/TaskDialog';
import { useVersion } from './useVersion';

export default function App() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const version = useVersion();

  const refetch = useCallback(() => {
    getBoard().then(setBoard).catch((e: Error) => toast.error(e.message));
  }, []);
  useEffect(() => { refetch(); }, [refetch, version]); // поллинг: version растёт → рефетч (UI-04)

  const onMove = (taskId: number, to: Status) => {
    setBoard((b) => { // оптимистично: карточка сразу в новой колонке
      if (!b) return b;
      const task = STATUSES.flatMap((s) => b[s]).find((t) => t.id === taskId);
      if (!task || task.status === to) return b;
      const next = Object.fromEntries(
        STATUSES.map((s) => [s, b[s].filter((t) => t.id !== taskId)]),
      ) as BoardData;
      next[to] = [...next[to], { ...task, status: to }];
      return next;
    });
    moveTask(taskId, to)
      .catch((e: Error) => toast.error(e.message)) // refetch в finally откатит
      .finally(refetch);
  };

  if (!board) return null;
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-semibold">kdd</h1>
        <Button size="sm" onClick={() => setCreating(true)}>New task</Button>
      </header>
      <main className="flex-1 overflow-auto">
        <Board board={board} onMove={onMove} onOpen={setOpenId} />
      </main>
      <TaskDialog
        id={openId} version={version}
        onClose={() => setOpenId(null)} onChanged={refetch}
      />
      <NewTaskDialog
        open={creating} onClose={() => setCreating(false)} onCreated={refetch}
      />
      <Toaster position="bottom-right" />
    </div>
  );
}
```

- [ ] **Step 6: Сборка зелёная**

Run: `pnpm --filter @kddkit/ui build`
Expected: без ошибок; `dist/public/` обновился.

- [ ] **Step 7: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): task dialog with markdown and comments, new task dialog, version polling"
```

---

### Task 7: Build-инвариант тестом + полный прогон + ручной смок

**Files:**
- Test: `packages/ui/test/build.test.ts`

- [ ] **Step 1: Тест инварианта** (`test` в turbo зависит от `build`, поэтому dist существует к моменту прогона)

`packages/ui/test/build.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('build output', () => {
  const dist = join(import.meta.dirname, '..', 'dist');
  it('ships the server bundle', () => {
    expect(existsSync(join(dist, 'server.js'))).toBe(true);
  });
  it('ships the built frontend', () => {
    expect(existsSync(join(dist, 'public', 'index.html'))).toBe(true);
  });
});
```

- [ ] **Step 2: Полный прогон**

Run: `pnpm build; pnpm test`
Expected: все пакеты зелёные (core 66 + cli 18 + ui 17).

- [ ] **Step 3: Ручной смок по success criteria** (реальный репо, `kdd ui` в фоне)

Из корня: `node packages/cli/dist/index.js ui` → открыть `http://localhost:4499`, проверить:

1. **UI-01**: доска с 5 колонками; перетащить карточку — статус меняется (проверить `kdd show #N`: event `moved`, `actor_type user`).
2. **UI-02**: New task → задача появляется; открыть → Edit → markdown-body рендерится.
3. **UI-03**: комментарий из UI (нейтральный) и `$env:KDD_ACTOR='ai'; node packages/cli/dist/index.js comment #N "ai note"` → в диалоге отличим (бейдж `ai`, muted-фон).
4. **UI-04**: `kdd add "from cli"` в соседнем терминале → карточка появляется в UI ≤2с без перезагрузки.

Остановить сервер (Ctrl+C), при смоке созданный мусор прибрать (`kdd archive`).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/test/build.test.ts
git commit -m "test(ui): build invariant for server and static bundle"
```

---

### Task 8: Обновить planning-документы

**Files:**
- Modify: `.planning/REQUIREMENTS.md` — UI-01..04 `[x]`; traceability UI-01..04 → `Complete`
- Modify: `.planning/ROADMAP.md` — Phase 3 `[x]`; Progress row `1/1 | Complete | 2026-07-14`
- Modify: `.planning/STATE.md` — completed_phases 3, percent 75, «Phase 3 complete; ready to plan Phase 4 (Claude integration & packaging)», stopped-at

- [ ] **Step 1: Внести правки** (по образцу Phase 2 — только отметки статуса, ничего не переписывать)

- [ ] **Step 2: Commit**

```bash
git add .planning
git commit -m "docs: mark phase 3 complete (UI-01..04)"
```

---

## Self-Review (выполнен)

- **Spec coverage:** UI-01 (Task 1–5), UI-02 (Task 6), UI-03 (Task 6), UI-04 (Task 6 поллинг), error contract (Task 2), static+CLI (Task 3), build-инвариант (Task 7), docs (Task 8). Пробелов нет.
- **Placeholder scan:** чисто; единственные «неполные» шаги — `shadcn add` (генерирует стандартные файлы CLI-ой) и Task 8 (механические отметки по образцу Phase 2).
- **Type consistency:** `createApp(db)`, `startUi(db, port) → Promise<{url, close}>`, `Board({board, onMove, onOpen})`, `api.ts`-сигнатуры сверены между задачами; `version` проброшен App → TaskDialog.
