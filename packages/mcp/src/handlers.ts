import type Database from 'better-sqlite3';
import {
  boardData, taskDetail, recall, editTask, moveTask, commentTask, mustGetTask,
  listTracks, KddError, type Actor, type Priority, type Status,
} from '@kddkit/core';

export interface TaskRow {
  id: number;
  title: string;
  status: string;
  priority: string;
  blocked: boolean;
}

export function getTask(db: Database.Database, id: number) {
  return taskDetail(db, id);
}

export function listTracksTool(db: Database.Database) {
  // все track-и, включая done: routing → active; done = завершённый пласт работы (контекст)
  return listTracks(db, {}).map((t) => ({
    id: t.id, name: t.name, description: t.description,
    status: t.status, open_tasks: t.open_tasks,
  }));
}

export function listTasks(
  db: Database.Database,
  filter: { status?: Status; area?: string; track_id?: number } = {},
): Record<string, TaskRow[]> {
  const board = boardData(db, filter);
  const out: Record<string, TaskRow[]> = {};
  for (const [status, tasks] of Object.entries(board)) {
    out[status] = tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status,
      priority: t.priority, blocked: !!t.blocked,
    }));
  }
  return out;
}

export function recallTool(
  db: Database.Database, dir: string, query: string,
  opts: { k?: number; kind?: 'decision' | 'task' } = {},
) {
  return recall(db, dir, query, opts);
}

export interface UpdateInput {
  id: number;
  edit?: { title?: string; body?: string; priority?: Priority; area?: string; track_id?: number | null };
  move?: { to: string; reason?: string };
  comment?: string;
}

export function updateTask(db: Database.Database, input: UpdateInput, actor: Actor) {
  if (!input.edit && !input.move && !input.comment) {
    throw new KddError('nothing to update');
  }
  return db.transaction(() => {
    mustGetTask(db, input.id); // validates existence up front
    if (input.edit) editTask(db, input.id, input.edit, actor);
    if (input.move) moveTask(db, input.id, input.move.to, actor, input.move.reason);
    if (input.comment) commentTask(db, input.id, input.comment, actor);
    return mustGetTask(db, input.id);
  })();
}
