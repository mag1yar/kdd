import type Database from 'better-sqlite3';
import { CAPS, capText } from './caps.js';
import { STATUSES, type Status } from './state.js';
import type { Comment, EventRow, Task } from './types.js';
import { mustGetTask } from './ops.js';

const PRIORITY_ORDER =
  `CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

export function boardData(
  db: Database.Database,
  f: { area?: string; status?: Status; archived?: boolean; track_id?: number } = {},
): Record<Status, Task[]> {
  const where: string[] = [f.archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'];
  const params: unknown[] = [];
  if (f.area) { where.push('area = ?'); params.push(f.area); }
  if (f.track_id != null) { where.push('track_id = ?'); params.push(f.track_id); }
  if (f.status) { where.push('status = ?'); params.push(f.status); }
  const rows = db.prepare(
    `SELECT * FROM tasks WHERE ${where.join(' AND ')}
     ORDER BY position, ${PRIORITY_ORDER}, created_at`,
  ).all(...params) as Task[];
  const out = Object.fromEntries(STATUSES.map((s) => [s, [] as Task[]])) as Record<Status, Task[]>;
  for (const r of rows) out[r.status].push(r);
  return out;
}

export function taskDetail(db: Database.Database, id: number): {
  task: Task; comments: Comment[]; events: EventRow[];
  links: { id: number; title: string; kind: string }[];
} {
  const task = mustGetTask(db, id);
  const comments = db.prepare(
    `SELECT * FROM comments WHERE task_id = ? ORDER BY created_at, id`).all(id) as Comment[];
  const events = db.prepare(
    `SELECT * FROM events WHERE task_id = ? ORDER BY created_at, id`).all(id) as EventRow[];
  const links = db.prepare(
    `SELECT t.id, t.title, l.kind FROM task_links l
     JOIN tasks t ON t.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
     WHERE l.from_id = ? OR l.to_id = ?`,
  ).all(id, id, id) as { id: number; title: string; kind: string }[];
  return { task, comments, events, links };
}

export interface TaskDetailCapped {
  task: Task;
  comments: Comment[];
  comments_total: number;
  events: EventRow[];
  events_total: number;
  links: { id: number; title: string; kind: string }[];
}

// Единственный источник trim-политики show/get_task: последние N с честными totals.
export function taskDetailCapped(db: Database.Database, id: number): TaskDetailCapped {
  const d = taskDetail(db, id);
  return {
    task: {
      ...d.task,
      body: d.task.body === null ? null : capText(d.task.body, CAPS.bodyChars),
    },
    comments: d.comments.slice(-CAPS.comments)
      .map((c) => ({ ...c, body: capText(c.body, CAPS.commentChars) })),
    comments_total: d.comments.length,
    events: d.events.slice(-CAPS.events),
    events_total: d.events.length,
    links: d.links,
  };
}

export function statusDigest(db: Database.Database): {
  in_progress: Task[]; review: Task[]; blocked: Task[]; recent: EventRow[];
} {
  const active = `archived_at IS NULL`;
  const q = (w: string) => db.prepare(
    `SELECT * FROM tasks WHERE ${active} AND ${w}
     ORDER BY ${PRIORITY_ORDER}, created_at`).all() as Task[];
  return {
    in_progress: q(`status = 'in_progress'`),
    review: q(`status = 'review'`),
    blocked: q(`blocked = 1`),
    recent: db.prepare(
      `SELECT * FROM events ORDER BY id DESC LIMIT ${CAPS.statusEvents}`).all() as EventRow[],
  };
}

export function exportBoard(db: Database.Database): {
  tasks: Task[]; comments: Comment[]; links: unknown[]; events: EventRow[];
} {
  return {
    tasks: db.prepare(`SELECT * FROM tasks ORDER BY id`).all() as Task[],
    comments: db.prepare(`SELECT * FROM comments ORDER BY id`).all() as Comment[],
    links: db.prepare(`SELECT * FROM task_links`).all(),
    events: db.prepare(`SELECT * FROM events ORDER BY id`).all() as EventRow[],
  };
}
