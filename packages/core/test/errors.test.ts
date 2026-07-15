import { describe, it, expect } from 'vitest';
import { openDb, logError } from '../src/index.js';

describe('logError', () => {
  it('records a row in the errors table', () => {
    const db = openDb(':memory:', 'x');
    logError(db, 'mcp', 'boom');
    const row = db.prepare(`SELECT source, message FROM errors`).get();
    expect(row).toEqual({ source: 'mcp', message: 'boom' });
  });
});
