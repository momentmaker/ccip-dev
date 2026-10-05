import { describe, expect, it } from 'vitest';
import { cursorAt, decodeCursor, encodeCursor } from '../src/ccip/cursor';

const SAMPLE =
  'P5qHHA4DJkUmk3Gdr9T5AwMzWU6tP7yHjTWyMYL2oEkFjhiwx2yCfHJZpBjpCLdswoattNg9X8Ybfh31KW5C3XWhWp8AL3rBYFTnw9kMKsGm7K7KS7fmFBDJXvKMAKSbYfZYS7DHeTRR1bRiHGVo5Nsp8E1fsddypUPBXmyvuw9NVda1A1WpTpK4qqDdreyQThqqWfw1hkdYyPVQHkD1inbbhn8dPEDQM1rFCwb4q87tLoN';
const SAMPLE_QUERY =
  'environment=mainnet&oldestSeenTimestamp=1768449017000&oldestSeenMessageId=0x8f5302f9f7e43464d0e52191dd2591bf50c8b42a4c02a840f9375b79d108da68&totalCount=1000&isCountCapped=true';

describe('decodeCursor', () => {
  it('decodes a real API cursor into its query parameters', () => {
    expect(decodeCursor(SAMPLE).toString()).toBe(SAMPLE_QUERY);
  });

  it('rejects a character outside the base58 alphabet', () => {
    expect(() => decodeCursor('abc0def')).toThrow('not base58');
  });
});

describe('encodeCursor', () => {
  it('re-encodes a decoded real cursor to the same string', () => {
    expect(encodeCursor(decodeCursor(SAMPLE))).toBe(SAMPLE);
  });

});

describe('base58 leading zeros', () => {
  it('decodes each leading 1 as a zero byte', () => {
    expect(decodeCursor(`11${encodeCursor(new URLSearchParams('a=b'))}`).toString()).toBe('%00%00a=b');
  });
});

describe('cursorAt', () => {
  it('replaces only the timestamp and message id, keeping every other parameter in place', () => {
    const id = `0x${'ab'.repeat(32)}`;
    const moved = [...decodeCursor(cursorAt(SAMPLE, 1768449000000, id))];
    const original = [...decodeCursor(SAMPLE)];
    expect(moved.map(([key]) => key)).toEqual(original.map(([key]) => key));
    expect(Object.fromEntries(moved)).toEqual({
      ...Object.fromEntries(original),
      oldestSeenTimestamp: '1768449000000',
      oldestSeenMessageId: id,
    });
  });
});
