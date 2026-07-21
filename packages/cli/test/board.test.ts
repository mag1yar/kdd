import { describe, it, expect } from 'vitest';
import { makeEnv, kdd } from './run.js';

describe('board --ready', () => {
  it('lists only takeable tasks and shows criteria progress', () => {
    const env = makeEnv();
    kdd(env, 'add', 'takeable');                    // #1 new
    kdd(env, 'add', 'taken');                        // #2
    kdd(env, 'move', '2', 'in_progress');
    kdd(env, 'criteria', 'add', '1', 'accept it');   // #1 gets an unchecked criterion → 0/1

    const ready = kdd(env, 'board', '--ready');
    expect(ready).toContain('#1');
    expect(ready).not.toContain('#2');
    expect(ready).toContain('0/1');                  // criteria progress on the line
  });
});
