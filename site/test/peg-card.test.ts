import { PEG_FILE_FIXTURE, PEG_HISTORY_FIXTURE } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { pegTree } from '../worker/cards/peg-card';
import { texts } from './fixtures/broadcast';

const inputs = (peg = PEG_FILE_FIXTURE) => ({ load: async (name: string) => (name === 'peg.json' ? peg : PEG_HISTORY_FIXTURE), icon: async () => null }) as never;
const OPEN = { ...PEG_FILE_FIXTURE.recent_episodes[0]!, id: 7, closed_at: null, side: 'discount' as const, peak_gap: -0.0091 };
const opened = { ...PEG_FILE_FIXTURE, gap: -0.0084, spot: 0.9916, episode: OPEN, recent_episodes: [OPEN] };

describe('the peg card', () => {
  it('draws the live peg when shared from the page', async () => {
    const words = texts((await pegTree(null, inputs()))!).join('|');
    expect(words).toContain('1 stLINK = 0.99975 LINK');
    expect(words).toContain('ccip.dev/staking/#peg');
  });

  it('draws an open episode for its public post', async () => {
    const words = texts((await broadcastTree({ kind: 'peg', episode: 7, phase: 'open' }, inputs(opened)))!).join('|');
    expect(words).toContain('DISCOUNT OPEN');
    expect(words).toContain('−0.84%');
  });

  it('draws the recap of a closed episode', async () => {
    const words = texts((await broadcastTree({ kind: 'peg', episode: 2, phase: 'close' }, inputs()))!).join('|');
    expect(words).toContain('PREMIUM CLOSED');
    expect(words).toContain('+5.64%');
  });

  it('has no card for an episode peg.json does not list yet, or a close that has not happened', async () => {
    expect(await broadcastTree({ kind: 'peg', episode: 99, phase: 'open' }, inputs())).toBeNull();
    expect(await broadcastTree({ kind: 'peg', episode: 7, phase: 'close' }, inputs(opened))).toBeNull();
  });
});
