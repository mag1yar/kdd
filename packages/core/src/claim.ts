import type Database from 'better-sqlite3';
import { now } from './db.js';
import { type Actor } from './state.js';
import { appendEvent, authorOf, mustGetTask } from './ops.js';
import { KddError } from './errors.js';
import { PRIORITY_ORDER } from './queries.js';
import type { Task } from './types.js';

export const DEFAULT_TTL = 15 * 60; // сек; hermes-дефолт, override через --ttl
const SYSTEM: Actor = { type: 'ai', id: 'system' }; // provenance ленивого reclaim (не притворяемся владельцем)

// NaN/0/negative ttl -> claim_expires = NaN, который reclaimExpired (< ?) никогда не матчит: lease навечно.
function assertTtl(ttl: number): void {
  if (!Number.isFinite(ttl) || ttl <= 0) throw new KddError(`invalid ttl '${ttl}' (seconds > 0)`);
}

// takeable агентом: ready + есть критерии (definition of done) + не занята.
// status='new' уже исключает занятые (инвариант claimed<=>in_progress); claimed_by IS NULL — гвард окна гонки.
const CLAIMABLE_SQL =
  `status = 'new' AND blocked = 0 AND archived_at IS NULL AND claimed_by IS NULL
   AND (SELECT COUNT(*) FROM criteria WHERE criteria.task_id = tasks.id) > 0`;

const criteriaCount = (db: Database.Database, id: number): number =>
  (db.prepare(`SELECT COUNT(*) c FROM criteria WHERE task_id = ?`).get(id) as { c: number }).c;

// Ленивый TTL-reclaim: истёкший lease -> задача обратно в new, claim снят, событие.
// Вызывается в начале claim/claimNext — без демона, kdd живёт только когда его зовут.
export function reclaimExpired(db: Database.Database): number[] {
  const t = now();
  const expired = db.prepare(
    `SELECT id, claimed_by FROM tasks
     WHERE status = 'in_progress' AND claim_expires IS NOT NULL AND claim_expires < ?`,
  ).all(t) as { id: number; claimed_by: string | null }[];
  const clear = db.prepare(
    `UPDATE tasks SET status='new', claimed_by=NULL, claim_expires=NULL, updated_at=? WHERE id=?`);
  for (const e of expired) {
    clear.run(t, e.id);
    appendEvent(db, e.id, SYSTEM, 'reclaimed', { former: e.claimed_by }, { type: 'claim', level: 'warn' });
  }
  return expired.map((e) => e.id);
}

export function claimTask(
  db: Database.Database, id: number, actor: Actor, ttl = DEFAULT_TTL,
): { ok: true; task: Task } | { ok: false; error: string } {
  assertTtl(ttl);
  return db.transaction((): { ok: true; task: Task } | { ok: false; error: string } => {
    reclaimExpired(db);
    const t = mustGetTask(db, id);
    if (criteriaCount(db, id) === 0) {
      appendEvent(db, id, actor, 'claim_rejected',
        { reason: 'no acceptance criteria' }, { type: 'claim', level: 'warn' });
      return { ok: false, error: `cannot claim #${id}: no acceptance criteria (define done first)` };
    }
    const expires = now() + ttl;
    const r = db.prepare(
      `UPDATE tasks SET status='in_progress', claimed_by=?, claim_expires=?, updated_at=?
       WHERE id=? AND status='new' AND blocked=0 AND archived_at IS NULL AND claimed_by IS NULL`,
    ).run(authorOf(actor), expires, now(), id);
    if (r.changes !== 1) {
      return { ok: false,
        error: `#${id} is not claimable (status ${t.status}${t.claimed_by ? `, held by ${t.claimed_by}` : ''})` };
    }
    appendEvent(db, id, actor, 'claimed', { ttl, expires }, { type: 'claim' });
    return { ok: true, task: mustGetTask(db, id) };
  })();
}

// null = очередь пуста (не ошибка). Гонка разрешается перебором: проигравший CAS -> следующий кандидат.
export function claimNext(db: Database.Database, actor: Actor, ttl = DEFAULT_TTL): Task | null {
  assertTtl(ttl);
  return db.transaction(() => {
    reclaimExpired(db);
    const rows = db.prepare(
      `SELECT id FROM tasks WHERE ${CLAIMABLE_SQL} ORDER BY ${PRIORITY_ORDER}, created_at, id`,
    ).all() as { id: number }[];
    for (const { id } of rows) {
      const expires = now() + ttl;
      const r = db.prepare(
        `UPDATE tasks SET status='in_progress', claimed_by=?, claim_expires=?, updated_at=?
         WHERE id=? AND status='new' AND blocked=0 AND archived_at IS NULL AND claimed_by IS NULL`,
      ).run(authorOf(actor), expires, now(), id);
      if (r.changes === 1) {
        appendEvent(db, id, actor, 'claimed', { ttl, expires }, { type: 'claim' });
        return mustGetTask(db, id);
      }
    }
    return null;
  })();
}

// Продление тем же CAS: rowcount 0 => «ты больше не владелец» (истёк/reclaim), агент обязан остановиться.
export function renewClaim(
  db: Database.Database, id: number, actor: Actor, ttl = DEFAULT_TTL,
): { ok: true; task: Task } | { ok: false; error: string } {
  assertTtl(ttl);
  return db.transaction((): { ok: true; task: Task } | { ok: false; error: string } => {
    mustGetTask(db, id);
    const expires = now() + ttl;
    const r = db.prepare(
      `UPDATE tasks SET claim_expires=?, updated_at=? WHERE id=? AND claimed_by=?`,
    ).run(expires, now(), id, authorOf(actor));
    if (r.changes !== 1) {
      return { ok: false,
        error: `#${id} not held by ${authorOf(actor)} (lease lost or reclaimed) — stop work` };
    }
    appendEvent(db, id, actor, 'claim_renewed', { ttl, expires }, { type: 'claim' });
    return { ok: true, task: mustGetTask(db, id) };
  })();
}
