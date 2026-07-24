import { describe, expect, it } from 'vitest';
import { fmtOutput, mergeFeed } from '../src/web/lib/feed.js';

const ev = (id: number, kind = 'text') => ({ id, kind, task_id: 1, worker_id: 'w', name: null, detail: null, created_at: id }) as any;

describe('mergeFeed', () => {
  it('appends only strictly-newer rows, keeps order, dedups by id', () => {
    const base = [ev(1), ev(2)];
    expect(mergeFeed(base, [ev(2), ev(3)]).map((e) => e.id)).toEqual([1, 2, 3]);
  });
  it('empty incoming keeps prev', () => {
    expect(mergeFeed([ev(1)], []).map((e) => e.id)).toEqual([1]);
  });
});

describe('fmtOutput', () => {
  it('passes strings through unchanged', () => {
    expect(fmtOutput('hi')).toBe('hi');
  });
  it('joins array-of-text-blocks with \\n', () => {
    expect(fmtOutput([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
  });
  it('mixed content (e.g. Read of image/PDF): joins the text blocks, ignores non-text', () => {
    expect(fmtOutput([{ type: 'text', text: 'ok' }, { type: 'image', source: { data: 'x' } }])).toBe('ok');
  });
  it('array with no text blocks at all falls back to JSON', () => {
    expect(fmtOutput([{ type: 'image', source: { data: 'x' } }])).toBe('[{"type":"image","source":{"data":"x"}}]');
  });
  it('JSON-stringifies plain objects', () => {
    expect(fmtOutput({ foo: 1 })).toBe('{"foo":1}');
  });
  it('renders nullish as empty string', () => {
    expect(fmtOutput(null)).toBe('');
    expect(fmtOutput(undefined)).toBe('');
  });
});
