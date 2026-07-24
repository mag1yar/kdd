import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import type Database from 'better-sqlite3';
import {
  findJob, getMeta, JOBS, kddHome, listProjects, resolveDbPath, resolveToplevel, setMeta, setMetaMany,
  type JobDef,
} from '@kddkit/core';
import { getBackend, type JobSpec } from '@kddkit/schedule';
import { fail, out, withDb } from './context.js';

// #19-style resolution: bundled by tsup into a single dist/index.js — at runtime this IS the CLI
// bin, exactly what argv needs to re-invoke `kdd <job.args>` from launchd.
const CLI_ENTRY = fileURLToPath(import.meta.url);

function parseEvery(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d+)\s*m?$/i); // '15' or '15m'
  return m ? Number(m[1]) : undefined;
}

// KDD_SCHEDULE_* are internal/testing seams (fake platform + launchctl + plist dir so tests never
// touch the real ~/Library/LaunchAgents or the real launchctl). Unset in production → real launchd.
function makeBackend() {
  return getBackend({
    platform: process.env.KDD_SCHEDULE_PLATFORM as NodeJS.Platform | undefined,
    dir: process.env.KDD_SCHEDULE_DIR,
    launchctl: process.env.KDD_SCHEDULE_LAUNCHCTL,
  });
}

function repohash(): string {
  return basename(dirname(resolveDbPath().dbPath));
}

function jobName(job: JobDef): string {
  return `kdd-${repohash()}-${job.id}`;
}

function specFor(job: JobDef, everyMinutes: number): JobSpec {
  const { dbPath } = resolveDbPath();
  const env: Record<string, string> = { KDD_HOME: kddHome() };
  for (const k of ['KDD_DB', 'KDD_DECISIONS_DIR', 'KDD_ACTOR', 'KDD_SESSION']) {
    if (process.env[k]) env[k] = process.env[k]!;
  }
  return {
    name: jobName(job),
    everyMinutes,
    argv: [process.execPath, CLI_ENTRY, ...job.args],
    cwd: resolveToplevel(),
    env,
    logDir: dirname(dbPath),
  };
}

// --every wins; else stored meta; else the job's own default. Always clamped >= minIntervalMin
// so a typo'd `--every 1` on a job that shouldn't run more than hourly can't hammer the box.
// A PROVIDED-but-unparseable --every (e.g. '2h') is a user error, not a silent fallback — only
// an OMITTED --every (undefined) falls through to stored meta / the job default.
// Pure: caller reads the stored interval and passes it in — no db access here, so enable/install
// each open one connection instead of this opening a throwaway one of its own (Finding #7).
function resolveInterval(job: JobDef, everyOpt: string | undefined, storedInterval: string | undefined, json: boolean): number {
  const parsed = parseEvery(everyOpt);
  if (everyOpt !== undefined && parsed === undefined) {
    fail(`--every must be minutes like '15' or '15m' (got '${everyOpt}')`, json);
  }
  const minutes = parsed ?? (storedInterval ? Number(storedInterval) : job.defaultIntervalMin);
  return Math.max(minutes, job.minIntervalMin);
}

function requireJob(id: string | undefined, json: boolean): JobDef {
  const job = findJob(id ?? 'tick');
  if (!job) fail(`unknown job '${id}' (known: ${JOBS.map((j) => j.id).join(', ')})`, json);
  return job;
}

// gh-style structured error for backend/OS failures (install/uninstall/status all shell out) —
// richer than the plain-string `fail()` other commands use, kept local so it doesn't change their contract.
function scheduleFail(json: boolean, e: unknown): never {
  const message = e instanceof Error ? e.message : String(e);
  if (json) console.log(JSON.stringify({ ok: false, error: { code: 'schedule_error', message, fix: message } }));
  else console.error(`error: ${message}`);
  process.exit(1);
}

export function writeTickLastRun(
  db: Database.Database, jobId: string, result: { spawned: number; reclaimed: number; active?: number },
): void {
  // one transaction so last_run never lands without its matching last_result (Finding #5).
  setMetaMany(db, {
    [`schedule.${jobId}.last_run`]: new Date().toISOString(),
    [`schedule.${jobId}.last_result`]: JSON.stringify(result),
  });
}

export function registerScheduleCommands(program: Command): void {
  const s = program.command('schedule').description('OS-level recurring jobs (agent auto-activation)');

  s.command('status')
    .argument('[job]', 'job id', 'tick')
    .option('--json')
    .action(async (id, o) => {
      const job = requireJob(id, o.json);
      const name = jobName(job);
      const backend = makeBackend();
      const meta = withDb((db) => ({
        enabled: getMeta(db, `schedule.${job.id}.enabled`) === '1',
        interval_min: Number(getMeta(db, `schedule.${job.id}.interval_min`) ?? job.defaultIntervalMin),
        last_run: getMeta(db, `schedule.${job.id}.last_run`),
        last_result: getMeta(db, `schedule.${job.id}.last_result`),
      }));
      let loaded = false;
      let lastExitCode: number | undefined;
      try {
        const st = await backend.status(name);
        loaded = st.installed; // launchd daemon-registry ground truth
        lastExitCode = st.lastExitCode;
      } catch (e) { scheduleFail(o.json, e); }
      // dual signal: registry AND artifact must agree to call it installed (either alone = drift).
      const plistPresent = existsSync(backend.path(name));
      const installed = loaded && plistPresent;
      // two-way drift: intent-on but not installed = needs (re)install; intent-off but the OS still
      // has the job (loaded or plist left behind) = orphaned, should be removed.
      const drift = meta.enabled && !installed ? 'not_installed'
        : !meta.enabled && (loaded || plistPresent) ? 'orphaned'
          : undefined;
      // a corrupt last_result must degrade to undefined, not throw a SyntaxError out of the command.
      let lastResult: unknown;
      try { lastResult = meta.last_result ? JSON.parse(meta.last_result) : undefined; }
      catch { lastResult = undefined; }
      const next_run = meta.last_run
        ? new Date(new Date(meta.last_run).getTime() + meta.interval_min * 60_000).toISOString()
        : undefined;
      const result = {
        job: job.id, name, enabled: meta.enabled, interval_min: meta.interval_min, installed,
        lastExitCode, last_run: meta.last_run, last_result: lastResult,
        next_run, drift,
      };
      out(o.json, result, () =>
        `${job.id}: enabled=${meta.enabled} interval=${meta.interval_min}m installed=${installed}` +
        `${drift ? ` drift=${drift}` : ''}${meta.last_run ? ` last_run=${meta.last_run}` : ''}`);
    });

  s.command('enable')
    .argument('[job]', 'job id', 'tick')
    .option('--every <dur>', 'interval, e.g. 15m or 15')
    .option('--dry-run')
    .option('--json')
    .action(async (id, o) => {
      const job = requireJob(id, o.json);
      const stored = o.every === undefined
        ? withDb((db) => getMeta(db, `schedule.${job.id}.interval_min`)) : undefined;
      const everyMinutes = resolveInterval(job, o.every, stored, o.json);
      const spec = specFor(job, everyMinutes);
      const backend = makeBackend();
      if (o.dryRun) {
        out(o.json, { dry_run: true, name: spec.name, path: backend.path(spec.name), preview: backend.preview(spec) },
          () => `# would write ${backend.path(spec.name)}\n${backend.preview(spec)}`);
        return;
      }
      // install FIRST — a rejected plist throws here so NO meta is written, and status won't lie
      // "enabled" over a job the OS never accepted (Finding: order so B/C compose).
      try { await backend.install(spec); } catch (e) { scheduleFail(o.json, e); }
      withDb((db) => setMetaMany(db, {
        [`schedule.${job.id}.enabled`]: '1',
        [`schedule.${job.id}.interval_min`]: String(everyMinutes),
      }));
      out(o.json, { ok: true, name: spec.name, interval_min: everyMinutes },
        () => `${job.id}: enabled, every ${everyMinutes}m`);
    });

  s.command('disable')
    .argument('[job]', 'job id', 'tick')
    .option('--dry-run')
    .option('--json')
    .action(async (id, o) => {
      const job = requireJob(id, o.json);
      const name = jobName(job);
      const backend = makeBackend();
      if (o.dryRun) {
        out(o.json, { dry_run: true, name, path: backend.path(name) },
          () => `# would remove ${backend.path(name)} and unload ${name}`);
        return;
      }
      // intent OFF first — if uninstall then throws (job stuck loaded), status shows drift:'orphaned'
      // instead of a lie; interval stays so re-enable remembers it.
      withDb((db) => setMeta(db, `schedule.${job.id}.enabled`, '0'));
      try { await backend.uninstall(name); } catch (e) { scheduleFail(o.json, e); }
      out(o.json, { ok: true, name }, () => `${job.id}: disabled`);
    });

  s.command('install')
    .argument('[job]', 'job id', 'tick')
    .option('--dry-run')
    .option('--json')
    .description('reconcile OS state with stored meta (repairs drift; does not touch enabled)')
    .action(async (id, o) => {
      const job = requireJob(id, o.json);
      const stored = withDb((db) => getMeta(db, `schedule.${job.id}.interval_min`));
      const everyMinutes = resolveInterval(job, undefined, stored, o.json);
      const spec = specFor(job, everyMinutes);
      const backend = makeBackend();
      if (o.dryRun) {
        out(o.json, { dry_run: true, name: spec.name, path: backend.path(spec.name), preview: backend.preview(spec) },
          () => `# would write ${backend.path(spec.name)}\n${backend.preview(spec)}`);
        return;
      }
      try { await backend.install(spec); } catch (e) { scheduleFail(o.json, e); }
      out(o.json, { ok: true, name: spec.name, interval_min: everyMinutes }, () => `${job.id}: installed`);
    });

  s.command('uninstall')
    .option('--all', 'every kdd-managed job on this machine, not just this repo')
    .option('--dry-run')
    .option('--json')
    .action(async (o) => {
      const backend = makeBackend();
      let names: string[];
      try { names = o.all ? await backend.list() : JOBS.map((j) => jobName(j)); }
      catch (e) { scheduleFail(o.json, e); }
      if (o.dryRun) {
        out(o.json, { dry_run: true, names }, () => names.map((n) => `# would remove ${backend.path(n)}`).join('\n') || 'nothing to remove');
        return;
      }
      for (const n of names) {
        try { await backend.uninstall(n); } catch (e) { scheduleFail(o.json, e); }
      }
      out(o.json, { ok: true, names }, () => names.length ? `uninstalled: ${names.join(', ')}` : 'nothing to remove');
    });

  s.command('list')
    .option('--json')
    .action(async (o) => {
      let names: string[];
      try { names = await makeBackend().list(); } catch (e) { scheduleFail(o.json, e); }
      const jobIds = JOBS.map((j) => j.id).join('|');
      const re = new RegExp(`^kdd-(.+)-(${jobIds})$`);
      const projects = listProjects();
      const rows = names.map((name) => {
        const m = name.match(re);
        const hash = m?.[1];
        const jobId = m?.[2];
        const repoPath = hash && projects.find((p) => basename(dirname(p.dbPath)) === hash)?.projectPath;
        return { name, repohash: hash, job: jobId, repoPath };
      });
      out(o.json, rows, () => rows.length
        ? rows.map((r) => `${r.name}  ${r.repoPath ?? '(unknown repo)'}`).join('\n')
        : 'no scheduled jobs');
    });
}
