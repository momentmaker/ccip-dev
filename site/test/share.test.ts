import { describe, expect, it } from 'vitest';
import { shareText, xIntentUrl } from '../src/lib/share';

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
