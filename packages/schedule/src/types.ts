import { execFile } from 'node:child_process';

export interface JobSpec {
  name: string;                 // stable id, e.g. 'kdd-<repohash>-tick'
  everyMinutes: number;         // interval; interval-only for MVP
  argv: string[];               // absolute: [execPath, '/abs/kdd/dist/index.js', 'tick']
  cwd: string;                  // repo dir the job runs in
  env?: Record<string, string>; // schedulers strip env — caller passes what the job needs
  logDir: string;               // where stdout/stderr go
}

export interface JobStatus {
  installed: boolean;
  nextRun?: Date;               // omitted on launchd (not exposed by the OS)
  lastExitCode?: number;        // best-effort from the OS
}

export type RunResult = { code: number; stdout: string; stderr: string };

// backends call this, never child_process directly — tests inject a fake to stay CI-safe
export type Runner = (cmd: string, args: string[], opts?: { input?: string }) => Promise<RunResult>;

export interface ScheduleBackend {
  install(spec: JobSpec): Promise<void>;   // idempotent full-replace
  uninstall(name: string): Promise<void>;  // idempotent (missing = success)
  status(name: string): Promise<JobStatus>;
  list(): Promise<string[]>;               // job names this backend manages (by kdd- prefix)
  preview(spec: JobSpec): string;          // exact artifact — dry-run, writes nothing
  path(name: string): string;              // on-disk artifact path — CLI uses it so dry-run/status match reality
}

export const defaultRunner: Runner = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = execFile(cmd, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      // execFile's err carries .code (exit status) — resolve, never reject: a non-zero
      // exit is data (launchctl signals "not loaded" this way), not an exception.
      const code = err && typeof (err as { code?: unknown }).code === 'number'
        ? (err as { code: number }).code : (err ? 1 : 0);
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
    if (opts?.input !== undefined) { child.stdin?.write(opts.input); child.stdin?.end(); }
  });
