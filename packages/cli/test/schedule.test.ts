import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kdd, kddFail, makeEnv } from './run.js';

// Stateful fake launchctl: load/unload track a state file so backend.status() is meaningful (the old
// /usr/bin/true always exits 0 and can't exercise load-failure/orphan semantics). FAKE_LC_FAIL forces
// a subcommand to fail; unload-fail leaves the state file → simulates a job stuck loaded.
const FAKE_LAUNCHCTL = `#!/bin/sh
sub=$1
state="$FAKE_LC_STATE"
name_of() { basename "$1" .plist; }
case "$sub" in
  load)   [ "$FAKE_LC_FAIL" = load ] && exit 1; touch "$state/$(name_of "$2")"; exit 0 ;;
  unload) if [ "$FAKE_LC_FAIL" = unload ]; then exit 1; fi; rm -f "$state/$(name_of "$2")"; exit 0 ;;
  list)   [ -f "$state/$2" ] && { printf '{\\n\\t"LastExitStatus" = 0;\\n};\\n'; exit 0; } || exit 1 ;;
  *) exit 0 ;;
esac
`;

// Hermetic: force launchd backend on any OS, send launchctl to the fake above, plists to a temp dir.
// makeEnv() sets KDD_DB directly (no git repo), so resolveDbPath short-circuits and repohash =
// basename(dirname(KDD_DB)) = the mkdtemp name (NOT a 16-hex git hash). resolveToplevel() would
// otherwise throw "not in a git repository" → set KDD_TOPLEVEL so JobSpec.cwd resolves.
// KDD_TOPLEVEL doubles as sweepWorktrees' repoRoot on `kdd tick`, so it must be a REAL (if empty)
// git repo — otherwise listWorktrees' throwing git() blows up the tick test. Kept separate from
// KDD_SCHEDULE_DIR (the plist dir) so the "dry-run writes nothing" assertion still sees an empty dir.
function schedEnv() {
  const env = makeEnv();
  env.KDD_SCHEDULE_PLATFORM = 'darwin';
  const lc = join(mkdtempSync(join(tmpdir(), 'kdd-lc-')), 'launchctl');
  writeFileSync(lc, FAKE_LAUNCHCTL);
  chmodSync(lc, 0o755);
  env.KDD_SCHEDULE_LAUNCHCTL = lc;
  env.FAKE_LC_STATE = mkdtempSync(join(tmpdir(), 'kdd-lc-state-'));
  env.KDD_SCHEDULE_DIR = mkdtempSync(join(tmpdir(), 'kdd-sched-'));
  const toplevel = mkdtempSync(join(tmpdir(), 'kdd-sched-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: toplevel });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: toplevel });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: toplevel });
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: toplevel });
  env.KDD_TOPLEVEL = toplevel;
  return env;
}

describe('kdd schedule', () => {
  it('enable --dry-run prints the plist and writes nothing', () => {
    const env = schedEnv();
    const out = kdd(env, 'schedule', 'enable', '--every', '15m', '--dry-run');
    expect(out).toContain('StartInterval');
    expect(out).toContain('<integer>900</integer>');
    expect(readdirSync(env.KDD_SCHEDULE_DIR!)).toHaveLength(0); // dry-run wrote nothing
  });

  it('enable installs a plist and records meta; status reflects it', () => {
    const env = schedEnv();
    kdd(env, 'schedule', 'enable', '--every', '15m');
    const files = readdirSync(env.KDD_SCHEDULE_DIR!).filter((f) => f.endsWith('.plist'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^kdd-.+-tick\.plist$/); // kdd-<repohash>-tick; repohash = temp name in tests
    const plist = readFileSync(join(env.KDD_SCHEDULE_DIR!, files[0]), 'utf8');
    expect(plist).toContain('<integer>900</integer>');
    const status = JSON.parse(kdd(env, 'schedule', 'status', '--json'));
    expect(status.enabled).toBe(true);
    expect(status.interval_min).toBe(15);
    expect(status.installed).toBe(true);
  });

  it('disable removes the plist and flips enabled meta off', () => {
    const env = schedEnv();
    kdd(env, 'schedule', 'enable', '--every', '15m');
    kdd(env, 'schedule', 'disable');
    expect(readdirSync(env.KDD_SCHEDULE_DIR!).filter((f) => f.endsWith('.plist'))).toHaveLength(0);
    const status = JSON.parse(kdd(env, 'schedule', 'status', '--json'));
    expect(status.enabled).toBe(false);
  });

  it('status shows drift when meta says enabled but the plist is gone', () => {
    const env = schedEnv();
    kdd(env, 'schedule', 'enable', '--every', '15m');
    // simulate drift: wipe the plist dir out from under it
    rmSync(env.KDD_SCHEDULE_DIR!, { recursive: true, force: true });
    mkdirSync(env.KDD_SCHEDULE_DIR!, { recursive: true });
    const status = JSON.parse(kdd(env, 'schedule', 'status', '--json'));
    expect(status.drift).toBe('not_installed');
  });

  it('tick writes schedule.tick.last_run into meta', () => {
    const env = schedEnv();
    kdd(env, 'tick');
    const status = JSON.parse(kdd(env, 'schedule', 'status', '--json'));
    expect(status.last_run).toBeTruthy();
  });

  it('enable --every 2h fails instead of silently defaulting', () => {
    const env = schedEnv();
    const { code, stderr } = kddFail(env, 'schedule', 'enable', '--every', '2h');
    expect(code).toBe(1);
    expect(stderr).toContain("--every must be minutes like '15' or '15m' (got '2h')");
  });

  it('enable surfaces a launchctl load failure and writes no meta', () => {
    const env = schedEnv();
    env.FAKE_LC_FAIL = 'load';
    const { code, stderr } = kddFail(env, 'schedule', 'enable', '--every', '15m');
    expect(code).toBe(1);
    expect(stderr).toContain('load failed');
    delete env.FAKE_LC_FAIL;
    const status = JSON.parse(kdd(env, 'schedule', 'status', '--json'));
    expect(status.enabled).toBe(false); // install threw before setMeta — no false "enabled" state
  });

  it('disable that cannot unload leaves the job as orphaned drift', () => {
    const env = schedEnv();
    kdd(env, 'schedule', 'enable', '--every', '15m'); // loaded + plist + enabled
    env.FAKE_LC_FAIL = 'unload';                       // unload fails and keeps state → stays loaded
    const { code, stderr } = kddFail(env, 'schedule', 'disable');
    expect(code).toBe(1);
    expect(stderr).toContain('still loaded');
    delete env.FAKE_LC_FAIL;
    const status = JSON.parse(kdd(env, 'schedule', 'status', '--json'));
    expect(status.enabled).toBe(false);   // intent flipped off first
    expect(status.installed).toBe(true);  // still loaded + plist present
    expect(status.drift).toBe('orphaned');
  });
});
