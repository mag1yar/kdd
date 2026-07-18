import {
  CAPS, STATUSES, capText as cap, now,
  type Comment, type EventRow, type RecallHit, type Status, type Task, type Track,
} from '@kddkit/core';

export { capText as cap } from '@kddkit/core';

export function renderAge(epoch: number): string {
  const d = now() - epoch;
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function taskLine(t: Task): string {
  const bits = [`#${t.id}`, cap(t.title, CAPS.titleChars), `[${t.priority}]`];
  if (t.area) bits.push(`@${t.area}`);
  if (t.blocked) bits.push(`BLOCKED: ${cap(t.block_reason ?? '', CAPS.blockReasonChars)}`);
  return `  ${bits.join(' ')}`;
}

export function renderBoard(b: Record<Status, Task[]>): string {
  const lines: string[] = [];
  for (const s of STATUSES) {
    lines.push(`${s} (${b[s].length})`);
    const shown = b[s].slice(0, CAPS.boardRows);
    for (const t of shown) lines.push(taskLine(t));
    if (b[s].length > shown.length) {
      lines.push(`  (+${b[s].length - shown.length} more, use --status ${s})`);
    }
  }
  return lines.join('\n');
}

export function renderShow(d: {
  task: Task; comments: Comment[]; events: EventRow[];
  links: { id: number; title: string; kind: string }[];
}): string {
  const t = d.task;
  const lines = [
    `#${t.id} ${t.title}`,
    `status: ${t.status}${t.blocked ? ` (BLOCKED: ${t.block_reason})` : ''}` +
      `  priority: ${t.priority}${t.area ? `  area: ${t.area}` : ''}` +
      `${t.archived_at ? '  ARCHIVED' : ''}`,
  ];
  if (t.body) lines.push('', cap(t.body, CAPS.bodyChars));
  if (d.links.length) {
    lines.push('', 'links:');
    for (const l of d.links) lines.push(`  ${l.kind} #${l.id} ${cap(l.title, CAPS.titleChars)}`);
  }
  if (d.comments.length) {
    lines.push('', `comments (${d.comments.length}):`);
    const shown = d.comments.slice(-CAPS.comments);
    if (shown.length < d.comments.length) {
      lines.push(`  (${d.comments.length - shown.length} earlier omitted)`);
    }
    for (const c of shown) {
      lines.push(`  [${c.author} ${renderAge(c.created_at)} ago] ${cap(c.body, CAPS.commentChars)}`);
    }
  }
  lines.push('', 'history:');
  for (const e of d.events.slice(-CAPS.events)) {
    lines.push(`  ${renderAge(e.created_at)} ago ${e.actor_type} ${e.action}` +
      `${e.detail ? ` ${e.detail}` : ''}`);
  }
  return lines.join('\n');
}

export function renderRecall(hits: RecallHit[]): string {
  if (hits.length === 0) return 'no results';
  const line = (h: RecallHit): string => {
    const snip = h.snippet.replace(/\s+/g, ' ').trim();
    if (h.kind === 'decision') {
      const tag = h.superseded_by ? ` [superseded by ${h.superseded_by}]` : '';
      return `decision ${h.ref}${tag} ${cap(h.title, CAPS.recallTitleChars)} — ${snip}`;
    }
    return `task #${h.ref} [${h.status ?? '?'}] ${cap(h.title, CAPS.recallTitleChars)} — ${snip}`;
  };
  const all = hits.map(line);
  const shown = [...all];
  while (shown.length > 1 &&
         Buffer.byteLength(shown.join('\n'), 'utf8') > CAPS.recallBytes - 32) {
    shown.pop();
  }
  if (shown.length < all.length) shown.push(`(+${all.length - shown.length} more, use -k)`);
  return shown.join('\n');
}

export function renderTracks(ts: (Track & { open_tasks: number })[]): string {
  if (ts.length === 0) return 'no tracks';
  return ts.map((t) => {
    const head = `#${t.id} ${t.name} (${t.open_tasks})${t.status === 'done' ? ' DONE' : ''}`;
    return t.description ? `${head}\n  ${cap(t.description, CAPS.trackDescChars)}` : head;
  }).join('\n');
}

export function renderStatus(d: {
  in_progress: Task[]; review: Task[]; blocked: Task[]; recent: EventRow[];
}): string {
  const lines: string[] = [];
  const section = (name: string, ts: Task[]) => {
    lines.push(`${name} (${ts.length})`);
    const shown = ts.slice(0, CAPS.statusRows);
    for (const t of shown) lines.push(taskLine(t));
    if (ts.length > shown.length) lines.push(`  (+${ts.length - shown.length} more)`);
  };
  section('in_progress', d.in_progress);
  section('review', d.review);
  section('blocked', d.blocked);
  lines.push('recent:');
  for (const e of d.recent) {
    lines.push(`  ${renderAge(e.created_at)} ago ${e.actor_type} ${e.action}` +
      ` #${e.task_id ?? '-'}`);
  }
  return lines.join('\n');
}
