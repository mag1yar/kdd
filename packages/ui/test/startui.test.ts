import { describe, it, expect } from 'vitest';
import { openDb } from '@kddkit/core';
import { startUi } from '../src/server.js';

describe('startUi', () => {
  it('serves the api on a real socket (port 0 = ephemeral)', async () => {
    const db = openDb(':memory:', 'x');
    const { url, close } = await startUi(db, 0);
    try {
      expect(url).toMatch(/^http:\/\/localhost:\d+$/);
      const res = await fetch(`${url}/api/version`);
      expect(await res.json()).toEqual({ version: 0 });
    } finally { close(); }
  });

  it('GET / without built frontend → 404 ui not built', async () => {
    const db = openDb(':memory:', 'x');
    const { url, close } = await startUi(db, 0);
    try {
      const res = await fetch(url + '/');
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('ui not built');
    } finally { close(); }
  });
});
