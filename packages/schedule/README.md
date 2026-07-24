# @kddkit/schedule

**Cross-OS recurring-job scheduling behind one interface** — the
launchd/cron/schtasks wrapper behind kddkit's overnight agent mode.

`@kddkit/schedule` is kdd-agnostic: it takes a plain `JobSpec` (command, cwd,
interval, log dir) and installs/uninstalls/inspects it as a recurring OS job.
It has zero knowledge of kdd, tasks or the board — any project that needs a
cross-platform "run this on a schedule" primitive can use it standalone.

```ts
import { getBackend } from '@kddkit/schedule';

const backend = getBackend();
await backend.install({
  name: 'kdd-abc123-tick',
  everyMinutes: 5,
  argv: [process.execPath, '/abs/path/to/kdd/dist/index.js', 'tick'],
  cwd: '/abs/path/to/repo',
  logDir: '/abs/path/to/logs',
});
```

## Install

```bash
npm i @kddkit/schedule
```

MVP ships macOS/launchd only — `getBackend()` dispatches on `process.platform`
and throws a clear "coming soon" error on Linux/Windows until cron/schtasks
backends land.

---

Part of **[kddkit](https://github.com/mag1yar/kddkit)**. MIT.
