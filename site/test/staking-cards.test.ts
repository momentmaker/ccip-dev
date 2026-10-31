import { STAKING_FIXTURE, STAKING_NEW_OPERATOR, STAKING_OPERATOR } from '@ccip-dev/core/testing';
import { describe, expect, it } from 'vitest';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { stakerTree } from '../worker/cards/staking-cards';
import { stakingCard } from '../worker/cards/content';
import { stakingHiveSvg } from '../worker/cards/staking-cards';
import { stakingPageSvg, stakingPageTree } from '../worker/cards/staking-page-card';
import { texts } from './fixtures/broadcast';

const inputs = (staking = STAKING_FIXTURE) => ({ load: async () => staking, icon: async () => null }) as never;
const at = (iso: string) => Date.parse(iso) / 1000;

describe('the staking sitrep card', () => {
  it('reports the week with its pool, flows, asks to leave and the newest operator event', async () => {
    const words = texts(await broadcastTree({ kind: 'staking', monday: '2026-10-26' }, inputs())).join('');
    expect(words).toContain('Chainlink staking · Oct 26 – Nov 1, 2026');
    expect(words).toContain('40.9MLINK staked');
    expect(words).toContain('POOL FULL FOR 1,060 DAYS');
    expect(words).toContain('260.0K LINK asked to leave · 59% of askers go');
    expect(words).toContain('Operator watch: Deepbase joined the operator pool');
    expect(words).toContain('ccip.dev/staking');
  });

  it('has no card until staking.json covers the week', async () => {
    expect(await broadcastTree({ kind: 'staking', monday: '2026-11-02' }, inputs())).toBeNull();
  });

  it('marks the week’s openings as dark cells on the hive', () => {
    const svg = stakingHiveSvg(STAKING_FIXTURE, 1, { kind: 'gap', cells: 3 });
    expect(svg.match(/fill="#070a10" stroke="#ffcf5a"/g)).toHaveLength(3);
  });
});

describe('the operator watch card', () => {
  it('names the operator and what it did', async () => {
    const joined = texts(await broadcastTree({ kind: 'operator', address: STAKING_NEW_OPERATOR, at: at('2026-11-01T09:00:00.000Z') }, inputs())).join('|');
    const unstaked = texts(await broadcastTree({ kind: 'operator', address: STAKING_OPERATOR, at: at('2026-10-27T12:00:00.000Z') }, inputs())).join('|');
    expect(joined).toContain('Deepbase|joined the node operator pool');
    expect(unstaked).toContain('LinkPool|unstaked 7,221 LINK|Staking through a stake.link vault');
    expect(unstaked).toContain('67,779');
  });

  it('has no card for an event the file does not list, or one that only goes in the weekly report', async () => {
    expect(await broadcastTree({ kind: 'operator', address: STAKING_OPERATOR, at: at('2026-10-28T16:42:59.000Z') }, inputs())).toBeNull();
    expect(await broadcastTree({ kind: 'operator', address: STAKING_OPERATOR, at: 1_700_000_000 }, inputs())).toBeNull();
  });
});

describe('the /staking page card', () => {
  it('shows the pool, how long it has been full and how fast gaps refill', () => {
    expect(stakingCard(STAKING_FIXTURE)).toMatchObject({
      eyebrow: 'CHAINLINK STAKING',
      big: '40,875,000 LINK',
      label: 'staked · the community pool is full',
      date: 'full since Dec 7, 2023',
      extra: ['8,528 stakers · gaps refill in 12s'],
    });
  });
});

describe('the staker card', () => {
  const A = '0x00000000000000000000000000000000000000aa';
  const files = (rows: unknown[]) =>
    ({ load: async (name: string) => (name === 'staking.json' ? STAKING_FIXTURE : { ...STAKING_FIXTURE, stakers: rows }), icon: async () => null }) as never;

  it('shows the stake, tenure, place in line and the exit clock', async () => {
    const tree = await stakerTree(A, files([[A, 'c', 15_000, '2023-12-01T00:00:00.000Z', '2026-10-10T00:00:00.000Z', 'wallet', 120, 1, 3]]));
    const words = texts(tree).join('|');
    expect(words).toContain('15,000|LINK');
    expect(words).toContain('AT THE 15,000 MAX');
    expect(words).toContain('#120| in line · one of 1,329 at the max');
    expect(words).toContain('Day one|Gap hunter ×3');
    expect(words).toContain('Unbonding · claim window opens |Nov 7, 2026');
  });

  it('has no card for an address with no stake', async () => {
    expect(await stakerTree(A, files([]))).toBeNull();
  });
});

describe('the /staking share card', () => {
  it('shows the pool, how long it has been full, the four stats and the page', () => {
    const words = texts(stakingPageTree(STAKING_FIXTURE, new Date('2026-11-02T14:00:00.000Z'))).join('|');
    expect(words).toContain('40,875,000');
    expect(words).toContain('FULL|LINK staked · full since Dec 7, 2023, 1,060 days');
    expect(words).toContain('Stakers|8,528|At the max|1,329|Gaps refill|12s|Rewards|4.32%');
    expect(words).toContain('ccip.dev/staking');
  });

  it('draws every cell of the honeycomb, one gap and one refill among them', () => {
    const svg = stakingPageSvg(STAKING_FIXTURE);
    expect(svg).not.toContain('undefined');
    expect(svg.match(/stroke="#ffcf5a" stroke-width="2"/g)).toHaveLength(1);
    expect(svg.match(/filter="url\(#glow\)"/g)).toHaveLength(1);
  });
});
