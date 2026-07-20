import type { Status, Priority } from './state.js';

export interface Task {
  id: number; title: string; body: string | null; status: Status;
  blocked: 0 | 1; block_reason: string | null; priority: Priority; area: string | null;
  track_id: number | null;
  position: number; archived_at: number | null; created_at: number; updated_at: number;
}
export interface Track {
  id: number; name: string; description: string | null;
  status: 'active' | 'done'; created_at: number;
}
export interface Criterion {
  id: number; task_id: number; text: string;
  checked_at: number | null; position: number; created_at: number;
}
export interface Comment {
  id: number; task_id: number; author: string; body: string; created_at: number;
}
export interface EventRow {
  id: number; task_id: number | null; actor_type: 'user' | 'ai';
  actor_id: string | null; action: string; detail: string | null; created_at: number;
}
