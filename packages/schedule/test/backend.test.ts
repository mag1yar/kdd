import { describe, it, expect } from 'vitest';
import { getBackend, LaunchdBackend } from '../src/index.js';

describe('getBackend', () => {
  it('returns a LaunchdBackend on darwin', () => {
    expect(getBackend({ platform: 'darwin' })).toBeInstanceOf(LaunchdBackend);
  });

  it('throws a clear error on an unsupported platform', () => {
    expect(() => getBackend({ platform: 'linux' })).toThrow(/unsupported platform 'linux'/);
    expect(() => getBackend({ platform: 'win32' })).toThrow(/coming soon/);
  });
});
