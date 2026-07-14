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
