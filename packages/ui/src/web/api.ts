// Типы продублированы из @kddkit/core: ядро тянет better-sqlite3 и в браузер не импортируется.
export const STATUSES = ['backlog', 'new', 'in_progress', 'review', 'done'] as const;
export type Status = (typeof STATUSES)[number];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Task {
  id: number; title: string; body: string | null; status: Status;
  blocked: 0 | 1; block_reason: string | null; priority: Priority; area: string | null;
  track_id: number | null;
  created_at: number; updated_at: number;
}
export interface Track {
  id: number; name: string; description: string | null;
  status: 'active' | 'done'; open_tasks: number;
}
export interface Comment { id: number; author: string; body: string; created_at: number; }
export interface EventRow {
  id: number; actor_type: 'user' | 'ai'; actor_id: string | null;
  action: string; detail: string | null; created_at: number;
}
export interface Link { id: number; title: string; kind: string; }
export type Board = Record<Status, Task[]>;
export interface TaskDetail {
  task: Task; comments: Comment[]; events: EventRow[]; links: Link[];
}

// ?project=<hash> из URL пробрасывается во все запросы — сервер отдаёт нужную базу.
function withProject(path: string): string {
  const p = new URLSearchParams(location.search).get('project');
  if (!p) return path;
  return `${path}${path.includes('?') ? '&' : '?'}project=${encodeURIComponent(p)}`;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withProject(path),
    init ? { ...init, headers: { 'content-type': 'application/json' } } : undefined);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export interface Project { id: string; path: string; }
export const getProjects = () => req<Project[]>('/api/projects');
export const getPing = () => req<{ kdd: boolean; default: string }>('/api/ping');
export const getTracks = () => req<Track[]>('/api/tracks');
export const createTrack = (b: { name: string; description?: string }) =>
  req<Track>('/api/tracks', { method: 'POST', body: JSON.stringify(b) });
export const setTrackDone = (id: number) =>
  req<Track>(`/api/tracks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
export const deleteTrack = (id: number) =>
  req<{ ok: true }>(`/api/tracks/${id}`, { method: 'DELETE' });
export const getBoard = (trackId?: number) =>
  req<Board>(trackId ? `/api/board?track=${trackId}` : '/api/board');
export const getVersion = () => req<{ version: number }>('/api/version');
export const getTask = (id: number) => req<TaskDetail>(`/api/tasks/${id}`);
export const createTask =
  (b: { title: string; body?: string; priority?: Priority; track_id?: number }) =>
    req<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(b) });
export const editTask = (id: number,
  b: { title?: string; body?: string; priority?: Priority; track_id?: number | null }) =>
  req<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(b) });
export const moveTask = (id: number, to: Status, order?: number[]) =>
  req<Task>(`/api/tasks/${id}/move`, { method: 'POST', body: JSON.stringify({ to, order }) });
export const addComment = (id: number, body: string) =>
  req<Comment>(`/api/tasks/${id}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
export const blockTask = (id: number, reason: string) =>
  req<Task>(`/api/tasks/${id}/block`, { method: 'POST', body: JSON.stringify({ reason }) });
export const unblockTask = (id: number) =>
  req<Task>(`/api/tasks/${id}/unblock`, { method: 'POST' });
