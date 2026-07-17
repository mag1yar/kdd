import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db.js';
import { createTrack, deleteTrack, editTrack, listTracks } from '../src/tracks.js';
import { addTask, editTask } from '../src/ops.js';
import { boardData } from '../src/queries.js';

const user = { type: 'user' } as const;

describe('tracks', () => {
  it('creates, rejects dup name, lists with open-task counts', () => {
    const db = openDb(':memory:', 'x');
    const a = createTrack(db, { name: 'Main', description: 'use when: core' });
    createTrack(db, { name: 'Side' });
    expect(() => createTrack(db, { name: 'Main' })).toThrow(/already exists/);
    addTask(db, { title: 't1', track_id: a.id }, user);
    const list = listTracks(db, { status: 'active' });
    expect(list.map((t) => [t.name, t.open_tasks])).toEqual([['Main', 1], ['Side', 0]]);
  });

  it('done hides from active list but keeps tasks; reopen restores', () => {
    const db = openDb(':memory:', 'x');
    const a = createTrack(db, { name: 'M' });
    addTask(db, { title: 't', track_id: a.id }, user);
    editTrack(db, a.id, { status: 'done' });
    expect(listTracks(db, { status: 'active' })).toHaveLength(0);
    expect(listTracks(db, {})).toHaveLength(1); // память остаётся
    editTrack(db, a.id, { status: 'active' });
    expect(listTracks(db, { status: 'active' })).toHaveLength(1);
  });

  it('addTask/editTask validate track and board filters by track', () => {
    const db = openDb(':memory:', 'x');
    const a = createTrack(db, { name: 'A' });
    expect(() => addTask(db, { title: 'x', track_id: 99 }, user)).toThrow(/not found/);
    const t = addTask(db, { title: 'ontrack', track_id: a.id }, user);
    addTask(db, { title: 'offtrack' }, user);
    expect(boardData(db, { track_id: a.id }).new.map((x) => x.title)).toEqual(['ontrack']);
    editTask(db, t.id, { track_id: null }, user); // detach
    expect(boardData(db, { track_id: a.id }).new).toHaveLength(0);
  });

  it('delete removes track but detaches (keeps) its tasks', () => {
    const db = openDb(':memory:', 'x');
    const a = createTrack(db, { name: 'A' });
    const t = addTask(db, { title: 'keep me', track_id: a.id }, user);
    deleteTrack(db, a.id);
    expect(listTracks(db, {})).toHaveLength(0);
    const kept = boardData(db).new.find((x) => x.id === t.id); // задача жива, track отцеплен
    expect(kept?.track_id).toBe(null);
    expect(() => deleteTrack(db, a.id)).toThrow(/not found/);
  });
});
