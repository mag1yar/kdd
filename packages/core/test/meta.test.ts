import { describe, it, expect } from 'vitest';
import { openDb, getMeta, setMeta, setMetaMany, JOBS, findJob } from '../src/index.js';

describe('meta helpers', () => {
  it('setMeta then getMeta roundtrips', () => {
    const db = openDb(':memory:');
    expect(getMeta(db, 'schedule.tick.enabled')).toBeUndefined();
    setMeta(db, 'schedule.tick.enabled', '1');
    expect(getMeta(db, 'schedule.tick.enabled')).toBe('1');
  });

  it('setMeta overwrites an existing key', () => {
    const db = openDb(':memory:');
    setMeta(db, 'schedule.tick.interval_min', '15');
    setMeta(db, 'schedule.tick.interval_min', '30');
    expect(getMeta(db, 'schedule.tick.interval_min')).toBe('30');
  });

  it('setMetaMany writes all keys in one transaction', () => {
    const db = openDb(':memory:');
    setMetaMany(db, {
      'schedule.tick.last_run': '2026-07-25T00:00:00.000Z',
      'schedule.tick.last_result': '{"spawned":1}',
    });
    // both keys present = the single transaction committed atomically
    expect(getMeta(db, 'schedule.tick.last_run')).toBe('2026-07-25T00:00:00.000Z');
    expect(getMeta(db, 'schedule.tick.last_result')).toBe('{"spawned":1}');
  });
});

describe('JOBS registry', () => {
  it('contains the tick job with sane defaults', () => {
    const tick = findJob('tick');
    expect(tick).toBeDefined();
    expect(tick!.args).toEqual(['tick']);
    expect(tick!.defaultIntervalMin).toBeGreaterThan(0);
    expect(tick!.minIntervalMin).toBeGreaterThanOrEqual(1);
  });

  it('findJob returns undefined for an unknown id', () => {
    expect(findJob('nope')).toBeUndefined();
  });
});
