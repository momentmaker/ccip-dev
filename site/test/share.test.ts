import { describe, expect, it } from 'vitest';
import { menuShift, shareText, xIntentUrl } from '../src/lib/share';

describe('share', () => {
  it('credits @ccipdev', () => {
    expect(shareText('2,409 CCIP messages today')).toBe('2,409 CCIP messages today — via @ccipdev');
  });

  it('builds an X post intent with encoded text and URL', () => {
    expect(xIntentUrl('a b & c', 'https://ccip.dev/top/token/30d/')).toBe(
      'https://x.com/intent/post?text=a%20b%20%26%20c&url=https%3A%2F%2Fccip.dev%2Ftop%2Ftoken%2F30d%2F',
    );
  });
});

describe('menuShift', () => {
  it('leaves a menu that fits where it is', () => {
    expect(menuShift(100, 270, 400, 8)).toBe(0);
  });

  it('pushes a menu that runs off the left edge back in', () => {
    expect(menuShift(-90, 80, 390, 8)).toBe(98);
  });

  it('pulls a menu that runs off the right edge back in', () => {
    expect(menuShift(250, 420, 390, 8)).toBe(-38);
  });

  it('prefers the left edge when the menu is wider than the viewport', () => {
    expect(menuShift(-10, 300, 280, 8)).toBe(18);
  });
});
