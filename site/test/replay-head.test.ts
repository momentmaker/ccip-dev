import { describe, expect, it } from 'vitest';
import { replayHead } from '../src/lib/replay-head';

describe('replayHead', () => {
  it('describes a focus chain by its partners and first day', () => {
    expect(replayHead({ focusName: 'Base', firstDay: '2023-09-12', messages: 1234, chains: 56 })).toEqual({
      title: 'Base on Chainlink CCIP',
      lead: '1,234 messages with 56 chains since Sep 12, 2023',
    });
  });

  it('describes all chains without a focus', () => {
    expect(replayHead({ focusName: null, firstDay: null, messages: 1234, chains: 56 })).toEqual({
      title: 'Watch CCIP grow',
      lead: '1,234 messages across 56 chains, replayed in 30 seconds.',
    });
  });
});
