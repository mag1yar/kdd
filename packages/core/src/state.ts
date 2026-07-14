export type Status = 'backlog' | 'new' | 'in_progress' | 'review' | 'done';
export const STATUSES: Status[] = ['backlog', 'new', 'in_progress', 'review', 'done'];

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

export type Actor = { type: 'user' | 'ai'; id?: string };

export const TRANSITIONS: Record<Status, Status[]> = {
  backlog: ['new'],
  new: ['backlog', 'in_progress'],
  in_progress: ['new', 'review'],
  review: ['in_progress', 'done'],
  done: ['review'],
};

export function checkMove(
  from: Status, to: Status, actor: Actor, reason?: string,
): { ok: true } | { ok: false; error: string } {
  if (from === to) return { ok: false, error: `task is already in ${to}` };
  if (actor.type === 'user') return { ok: true };
  if (TRANSITIONS[from].includes(to)) return { ok: true };
  if (reason) return { ok: true };
  return {
    ok: false,
    error: `invalid transition ${from} → ${to} for ai; allowed: ${TRANSITIONS[from].join(', ')}; pass --reason if user requested a skip`,
  };
}
