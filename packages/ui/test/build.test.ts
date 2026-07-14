import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('build output', () => {
  const dist = join(import.meta.dirname, '..', 'dist');
  it('ships the server bundle', () => {
    expect(existsSync(join(dist, 'server.js'))).toBe(true);
  });
  it('ships the built frontend', () => {
    expect(existsSync(join(dist, 'public', 'index.html'))).toBe(true);
  });
});
