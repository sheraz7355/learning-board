import { describe, expect, it } from 'vitest';
import { preferKnownWords } from './handwriting';

describe('preferKnownWords: the best-spelled reading first', () => {
  it('a close alternative made of known words wins over an unknown top reading', () => {
    expect(preferKnownWords(['queve', 'queue', 'quene'])[0]).toBe('queue');
    expect(preferKnownWords(['linkcd list', 'linked list'])[0]).toBe('linked list');
  });
  it('a known top reading stays first; numbers and symbols count as known', () => {
    expect(preferKnownWords(['stack', 'stalk'])[0]).toBe('stack');
    expect(preferKnownWords(['O(n log n)', 'o(nlogn)'])[0]).toBe('O(n log n)');
  });
  it('a far-off alternative does not replace the top reading', () => {
    expect(preferKnownWords(['Umer', 'tree'])[0]).toBe('Umer');
  });
});
