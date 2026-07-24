import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultRunner, type JobSpec, type JobStatus, type Runner, type ScheduleBackend } from './types.js';

const xml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function renderPlist(spec: JobSpec): string {
  const args = spec.argv.map((a) => `    <string>${xml(a)}</string>`).join('\n');
  const env = spec.env
    ? '\n  <key>EnvironmentVariables</key>\n  <dict>\n' +
      Object.entries(spec.env).map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join('\n') +
      '\n  </dict>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(spec.name)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartInterval</key>
  <integer>${Math.round(spec.everyMinutes * 60)}</integer>
  <key>WorkingDirectory</key>
  <string>${xml(spec.cwd)}</string>${env}
  <key>StandardOutPath</key>
  <string>${xml(join(spec.logDir, spec.name + '.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(spec.logDir, spec.name + '.err.log'))}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

export class LaunchdBackend implements ScheduleBackend {
  private runner: Runner;
  private dir: string;
  private launchctl: string;
  constructor(opts: { runner?: Runner; dir?: string; launchctl?: string } = {}) {
    this.runner = opts.runner ?? defaultRunner;
    this.dir = opts.dir ?? join(homedir(), 'Library', 'LaunchAgents');
    this.launchctl = opts.launchctl ?? 'launchctl';
  }
  path(name: string): string { return join(this.dir, name + '.plist'); }

  async install(spec: JobSpec): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const p = this.path(spec.name);
    writeFileSync(p, renderPlist(spec));
    await this.runner(this.launchctl, ['unload', p]); // best-effort: not-loaded is fine
    const r = await this.runner(this.launchctl, ['load', p]);
    // defaultRunner never rejects — a rejected plist comes back as a non-zero code, not a throw.
    if (r.code !== 0) throw new Error(`launchctl load failed (code ${r.code}): ${r.stderr.trim() || 'no stderr'}`);
  }

  async uninstall(name: string): Promise<void> {
    const p = this.path(name);
    await this.runner(this.launchctl, ['unload', p]); // best-effort
    // Verify the job is actually gone before deleting the plist: an unload that "succeeded" but
    // left the job loaded would otherwise orphan a running job with no artifact to see/recover it.
    const st = await this.status(name);
    if (st.installed) {
      throw new Error(`launchctl unload failed: job '${name}' is still loaded (plist left in place so it stays visible)`);
    }
    rmSync(p, { force: true }); // force: no throw if absent
  }

  async status(name: string): Promise<JobStatus> {
    const r = await this.runner(this.launchctl, ['list', name]);
    if (r.code !== 0) return { installed: false };
    const m = r.stdout.match(/"LastExitStatus"\s*=\s*(-?\d+)/);
    return { installed: true, lastExitCode: m ? Number(m[1]) : undefined };
  }

  async list(): Promise<string[]> {
    let files: string[];
    try { files = readdirSync(this.dir); } catch { return []; }
    return files.filter((f) => f.startsWith('kdd-') && f.endsWith('.plist'))
      .map((f) => f.slice(0, -'.plist'.length));
  }

  preview(spec: JobSpec): string { return renderPlist(spec); }
}
