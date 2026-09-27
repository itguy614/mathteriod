import { describe, expect, it } from 'vitest';
import { speechFriendly } from './speech';

describe('speechFriendly', () => {
  it('never leaves math symbols to be read literally', () => {
    expect(speechFriendly('12 − 5')).toBe('12 minus 5');
    expect(speechFriendly('12-5')).toBe('12 minus 5');
    expect(speechFriendly('42 ÷ 6')).toBe('42 divided by 6');
    expect(speechFriendly('6 × 7')).toBe('6 times 7');
    expect(speechFriendly('7 + 5 = ?')).toBe('7 plus 5 equals');
    expect(speechFriendly('7 plus 5')).toBe('7 plus 5');
  });
});
