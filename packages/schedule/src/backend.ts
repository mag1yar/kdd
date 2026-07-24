import { LaunchdBackend } from './launchd.js';
import type { Runner, ScheduleBackend } from './types.js';

export function getBackend(
  opts: { runner?: Runner; dir?: string; launchctl?: string; platform?: NodeJS.Platform } = {},
): ScheduleBackend {
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin') return new LaunchdBackend(opts);
  throw new Error(
    `kdd schedule: unsupported platform '${platform}' (launchd only for now; linux/windows coming soon)`,
  );
}
