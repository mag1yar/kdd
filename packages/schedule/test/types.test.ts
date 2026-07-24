import { describe, it, expect } from 'vitest';
import { defaultRunner } from '../src/index.js';

describe('defaultRunner', () => {
  it('runs a command and captures stdout + exit code', async () => {
    const r = await defaultRunner('printf', ['hello']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('hello');
  });

  it('captures a non-zero exit code without throwing', async () => {
    const r = await defaultRunner('sh', ['-c', 'exit 3']);
    expect(r.code).toBe(3);
  });

  it('feeds input on stdin when provided', async () => {
    const r = await defaultRunner('cat', [], { input: 'piped' });
    expect(r.stdout).toBe('piped');
  });
});
