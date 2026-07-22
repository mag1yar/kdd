import { describe, it, expect } from 'vitest';
import { addTask, appendAgentEvent, openDb } from '@kddkit/core';
import { createApp } from '../src/server.js';

const user = { type: 'user' } as const;
const mk = () => {
  const db = openDb(':memory:', 'x');
  return { db, app: createApp(() => db) };
};

describe('GET /api/tasks/:id/feed', () => {
  it('returns agent_events in id order, filtered by since', async () => {
    const { db, app } = mk();
    addTask(db, { title: 'has a feed' }, user);
    appendAgentEvent(db, 1, 'w', 'run_start');
    const second = appendAgentEvent(db, 1, 'w', 'text', { detail: { text: 'hi' } });
    const all = await app.request('/api/tasks/1/feed');
    expect((await all.json()).map((e: any) => e.kind)).toEqual(['run_start', 'text']);
    const since = await app.request(`/api/tasks/1/feed?since=${second - 1}`);
    expect((await since.json())).toHaveLength(1);
  });
});
