import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import {
  KddError, addTask, boardData, commentTask, editTask, moveTask, taskDetail,
  type Priority,
} from '@kddkit/core';

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

  return app;
}

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
