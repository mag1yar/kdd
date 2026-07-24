// src/types.ts
import { execFile } from "child_process";
var defaultRunner = (cmd, args, opts) => new Promise((resolve) => {
  const child = execFile(cmd, args, { encoding: "utf8" }, (err, stdout, stderr) => {
    const code = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
    resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
  });
  if (opts?.input !== void 0) {
    child.stdin?.write(opts.input);
    child.stdin?.end();
  }
});

// src/launchd.ts
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
function renderPlist(spec) {
  const args = spec.argv.map((a) => `    <string>${xml(a)}</string>`).join("\n");
  const env = spec.env ? "\n  <key>EnvironmentVariables</key>\n  <dict>\n" + Object.entries(spec.env).map(([k, v]) => `    <key>${xml(k)}</key>
    <string>${xml(v)}</string>`).join("\n") + "\n  </dict>" : "";
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
  <string>${xml(join(spec.logDir, spec.name + ".out.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(spec.logDir, spec.name + ".err.log"))}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}
var LaunchdBackend = class {
  runner;
  dir;
  launchctl;
  constructor(opts = {}) {
    this.runner = opts.runner ?? defaultRunner;
    this.dir = opts.dir ?? join(homedir(), "Library", "LaunchAgents");
    this.launchctl = opts.launchctl ?? "launchctl";
  }
  path(name) {
    return join(this.dir, name + ".plist");
  }
  async install(spec) {
    mkdirSync(this.dir, { recursive: true });
    const p = this.path(spec.name);
    writeFileSync(p, renderPlist(spec));
    await this.runner(this.launchctl, ["unload", p]);
    const r = await this.runner(this.launchctl, ["load", p]);
    if (r.code !== 0) throw new Error(`launchctl load failed (code ${r.code}): ${r.stderr.trim() || "no stderr"}`);
  }
  async uninstall(name) {
    const p = this.path(name);
    await this.runner(this.launchctl, ["unload", p]);
    const st = await this.status(name);
    if (st.installed) {
      throw new Error(`launchctl unload failed: job '${name}' is still loaded (plist left in place so it stays visible)`);
    }
    rmSync(p, { force: true });
  }
  async status(name) {
    const r = await this.runner(this.launchctl, ["list", name]);
    if (r.code !== 0) return { installed: false };
    const m = r.stdout.match(/"LastExitStatus"\s*=\s*(-?\d+)/);
    return { installed: true, lastExitCode: m ? Number(m[1]) : void 0 };
  }
  async list() {
    let files;
    try {
      files = readdirSync(this.dir);
    } catch {
      return [];
    }
    return files.filter((f) => f.startsWith("kdd-") && f.endsWith(".plist")).map((f) => f.slice(0, -".plist".length));
  }
  preview(spec) {
    return renderPlist(spec);
  }
};

// src/backend.ts
function getBackend(opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform === "darwin") return new LaunchdBackend(opts);
  throw new Error(
    `kdd schedule: unsupported platform '${platform}' (launchd only for now; linux/windows coming soon)`
  );
}
export {
  LaunchdBackend,
  defaultRunner,
  getBackend,
  renderPlist
};
