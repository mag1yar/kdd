import type Database from 'better-sqlite3';
import { claimNext, reclaimExpired, releaseClaim } from './claim.js';
import { now } from './db.js';

export interface TickResult { reclaimed: number; spawned: number; active: number }
export type SpawnFn = (taskId: number, workerId: string, projectDir: string) => void;

// Число живых воркеров = задачи в работе с непустым lease (инвариант claim).
function activeWorkers(db: Database.Database): number {
  return (db.prepare(
    `SELECT COUNT(*) c FROM tasks WHERE status='in_progress' AND claimed_by IS NOT NULL`,
  ).get() as { c: number }).c;
}

// Тупой механический tick: reclaim -> cap-loop (claim+spawn). Ноль LLM.
// spawn инъектится: тест передаёт recorder, прод — детач-спаун. Часы снаружи (cron).
export function tick(
  db: Database.Database,
  opts: { maxWorkers: number; ttl: number; projectDir: string; spawn: SpawnFn },
): TickResult {
  const reclaimed = db.transaction(() => reclaimExpired(db))().length;
  let active = activeWorkers(db);
  let spawned = 0;
  const nonce = now(); // уникальная база токена на этот tick
  while (active < opts.maxWorkers) {
    const workerId = `tick:${nonce}-${spawned}`; // run-token: уникален на спаун -> reclaim инвалидирует старый
    // tick уже прогнал reclaimExpired выше — не сканировать истёкшие лизы дважды за тик.
    const t = claimNext(db, { type: 'ai', id: workerId }, opts.ttl, { reclaim: false });
    if (!t) break; // очередь суха — fast-forward, не догоняем
    try {
      opts.spawn(t.id, workerId, opts.projectDir);
      active++; spawned++;
    } catch (e) {
      // sync spawn-fail (bad cwd, EMFILE, shell ENOENT): вернуть claim, засчитать неудачу, не занимать слот.
      // break, а не continue: причина обычно системная (плохой projectDir/бинарь) — она не исчезнет
      // для следующей задачи в этом же тике, а долбить очередь до auto-block того же таска бессмысленно.
      releaseClaim(db, t.id, { type: 'ai', id: workerId },
        `spawn failed: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
  }
  return { reclaimed, spawned, active };
}
