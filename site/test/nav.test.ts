import { describe, expect, it } from 'vitest';
import { isCurrentPath } from '../src/lib/nav';

describe('isCurrentPath', () => {
  it('matches the home page only on the exact root', () => {
    expect(isCurrentPath('/', '/')).toBe(true);
    expect(isCurrentPath('/records/', '/')).toBe(false);
  });
  it('matches a section by prefix', () => {
    expect(isCurrentPath('/history/30d/', '/history/')).toBe(true);
    expect(isCurrentPath('/flow/30d/', '/flow/')).toBe(true);
  });
  it('does not match a different section', () => {
    expect(isCurrentPath('/chains/', '/records/')).toBe(false);
  });
});
