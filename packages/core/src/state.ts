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
  from: Status, to: Status, actor: Actor, reason?: string, openCriteria = 0,
): { ok: true } | { ok: false; error: string } {
  if (from === to) return { ok: false, error: `task is already in ${to}` };
  if (actor.type === 'user') return { ok: true };
  if (reason) return { ok: true }; // явный «user попросил» обходит все ai-гейты
  if (!TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      error: `invalid transition ${from} → ${to} for ai; allowed: ${TRANSITIONS[from].join(', ')}; pass --reason if user requested a skip`,
    };
  }
  if (to === 'review' && openCriteria > 0) {
    return {
      ok: false,
      error: `cannot move to review: ${openCriteria} unchecked acceptance criteria; check them (kdd criteria check) or pass --reason if user asked to skip`,
    };
  }
  return { ok: true };
}
