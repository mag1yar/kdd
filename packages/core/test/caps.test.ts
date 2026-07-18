import { describe, it, expect } from 'vitest';
import { capText } from '../src/caps.js';

describe('capText', () => {
  it('returns short strings untouched', () => {
    expect(capText('abc', 5)).toBe('abc');
  });

  it('truncates with a visible marker', () => {
    expect(capText('abcdef', 3)).toBe('abc… [+3 chars]');
  });

  it('never splits a surrogate pair', () => {
    const s = `ab${'🐋'}cd`; // 🐋 = 2 code units at index 2-3
    const cut = capText(s, 3); // boundary lands mid-pair
    expect(cut.startsWith('ab…')).toBe(true);
    expect(JSON.parse(JSON.stringify(cut))).toBe(cut); // valid JSON round-trip
    expect(cut).not.toMatch(/[\ud800-\udbff]…/); // no lone high surrogate
  });
});
