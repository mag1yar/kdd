import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { LaunchdBackend, renderPlist } from '../src/launchd.js';
import type { JobSpec, Runner, RunResult } from '../src/index.js';

const spec = (over: Partial<JobSpec> = {}): JobSpec => ({
  name: 'kdd-abc123-tick',
  everyMinutes: 15,
  argv: ['/usr/local/bin/node', '/repo/dist/index.js', 'tick'],
  cwd: '/repo',
  env: { KDD_HOME: '/home/u/.kdd' },
  logDir: '/tmp/kddlog',
  ...over,
});

describe('renderPlist', () => {
  it('emits Label, StartInterval seconds, argv, WorkingDirectory, env, log paths, RunAtLoad false', () => {
    const p = renderPlist(spec());
    expect(p).toContain('<key>Label</key>');
    expect(p).toContain('<string>kdd-abc123-tick</string>');
    expect(p).toContain('<key>StartInterval</key>');
    expect(p).toContain('<integer>900</integer>');           // 15*60
    expect(p).toContain('<string>/repo/dist/index.js</string>');
    expect(p).toContain('<key>WorkingDirectory</key>');
    expect(p).toContain('<key>KDD_HOME</key>');
    expect(p).toContain('<string>/home/u/.kdd</string>');
    expect(p).toContain('/tmp/kddlog/kdd-abc123-tick.out.log');
    expect(p).toMatch(/<key>RunAtLoad<\/key>\s*<false\/>/);
  });

  it('XML-escapes special characters in values', () => {
    const p = renderPlist(spec({ cwd: '/a & b/<x>' }));
    expect(p).toContain('/a &amp; b/&lt;x&gt;');
    expect(p).not.toContain('/a & b/<x>');
  });
});

describe('LaunchdBackend', () => {
  let dir: string;
  let calls: Array<{ cmd: string; args: string[] }>;
  let runner: Runner;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kdd-launchd-'));
    calls = [];
    // stateful fake launchctl: load/unload track loaded jobs, list exits 0 iff loaded — so
    // uninstall's post-unload verify (and status) see real state instead of a constant success.
    const loaded = new Set<string>();
    runner = async (cmd, args): Promise<RunResult> => {
      calls.push({ cmd, args });
      const [sub, arg] = args;
      if (sub === 'load') { loaded.add(basename(arg, '.plist')); return { code: 0, stdout: '', stderr: '' }; }
      if (sub === 'unload') { loaded.delete(basename(arg, '.plist')); return { code: 0, stdout: '', stderr: '' }; }
      if (sub === 'list') {
        return loaded.has(arg)
          ? { code: 0, stdout: '{\n\t"LastExitStatus" = 0;\n};\n', stderr: '' }
          : { code: 1, stdout: '', stderr: 'Could not find service' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
  });

  it('install writes a plist and unload-then-loads it', async () => {
    const b = new LaunchdBackend({ runner, dir, launchctl: 'launchctl' });
    await b.install(spec());
    expect(readdirSync(dir)).toContain('kdd-abc123-tick.plist');
    const sub = calls.map((c) => c.args[0]);
    expect(sub).toEqual(['unload', 'load']);          // unload before load = idempotent replace
  });

  it('install twice is idempotent (same file, no throw)', async () => {
    const b = new LaunchdBackend({ runner, dir });
    await b.install(spec());
    await b.install(spec());
    expect(readdirSync(dir).filter((f) => f.endsWith('.plist'))).toHaveLength(1);
  });

  it('uninstall removes the plist and does not throw when already gone', async () => {
    const b = new LaunchdBackend({ runner, dir });
    await b.install(spec());
    await b.uninstall('kdd-abc123-tick');
    expect(readdirSync(dir)).not.toContain('kdd-abc123-tick.plist');
    await b.uninstall('kdd-abc123-tick');             // second time: no throw
  });

  it('install throws when launchctl load fails', async () => {
    const failLoad: Runner = async (_cmd, args): Promise<RunResult> => args[0] === 'load'
      ? { code: 1, stdout: '', stderr: 'Load failed: 5: Input/output error' }
      : { code: 0, stdout: '', stderr: '' };
    const b = new LaunchdBackend({ runner: failLoad, dir });
    await expect(b.install(spec())).rejects.toThrow(/load failed/);
  });

  it('uninstall throws and keeps the plist when the job stays loaded after unload', async () => {
    // list always reports loaded → unload didn't take effect; deleting the plist would orphan it.
    const stuck: Runner = async (_cmd, args): Promise<RunResult> => args[0] === 'list'
      ? { code: 0, stdout: '{\n\t"LastExitStatus" = 0;\n};\n', stderr: '' }
      : { code: 0, stdout: '', stderr: '' };
    const b = new LaunchdBackend({ runner: stuck, dir });
    await b.install(spec());
    await expect(b.uninstall('kdd-abc123-tick')).rejects.toThrow(/still loaded/);
    expect(readdirSync(dir)).toContain('kdd-abc123-tick.plist'); // left in place, stays visible
  });

  it('list returns only kdd- plist names, stripped of extension', async () => {
    const b = new LaunchdBackend({ runner, dir });
    await b.install(spec({ name: 'kdd-abc123-tick' }));
    await b.install(spec({ name: 'kdd-def456-tick' }));
    const names = await b.list();
    expect(names.sort()).toEqual(['kdd-abc123-tick', 'kdd-def456-tick']);
  });

  it('status reports installed + lastExitCode from launchctl list output', async () => {
    const withOut: Runner = async () => ({
      code: 0,
      stdout: '{\n\t"LastExitStatus" = 0;\n\t"Label" = "kdd-abc123-tick";\n};\n',
      stderr: '',
    });
    const b = new LaunchdBackend({ runner: withOut, dir });
    const s = await b.status('kdd-abc123-tick');
    expect(s.installed).toBe(true);
    expect(s.lastExitCode).toBe(0);
  });

  it('status reports not-installed when launchctl list exits non-zero', async () => {
    const missing: Runner = async () => ({ code: 1, stdout: '', stderr: 'Could not find service' });
    const b = new LaunchdBackend({ runner: missing, dir });
    const s = await b.status('kdd-abc123-tick');
    expect(s.installed).toBe(false);
  });

  it('preview returns the plist text and writes nothing', async () => {
    const b = new LaunchdBackend({ runner, dir });
    const text = b.preview(spec());
    expect(text).toContain('kdd-abc123-tick');
    expect(readdirSync(dir)).toHaveLength(0);          // nothing written
    expect(calls).toHaveLength(0);                     // launchctl not called
  });
});
