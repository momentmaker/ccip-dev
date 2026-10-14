import type { BroadcastTarget } from '@ccip-dev/core/broadcasts';
import { describe, expect, it } from 'vitest';
import { broadcastTree } from '../worker/cards/broadcast-cards';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import { BASE, texts } from './fixtures/broadcast';
import { loadMoments, MOMENTS, withMoments } from './fixtures/moments';

const inputs = { load: loadMoments, icon: async (selector: string) => (selector === BASE ? 'data:image/svg+xml;base64,AAAA' : null) };
const words = async (target: BroadcastTarget, load = loadMoments) => texts(await broadcastTree(target, { ...inputs, load }));

describe('new sender card', () => {
  it('names the project big with its rank, its messages since its first day, its chains and its page', async () => {
    // #then
    expect(await words({ kind: 'newcomer', key: 'project:xstocks' })).toEqual(
      expect.arrayContaining([
        'New on CCIP · Sun, Oct 11, 2026', 'NEW ON CCIP', '#1 sender of the day', 'xStocks', '520 messages ', 'in its first week',
        'First message ', 'Oct 9, 2026 ', '· 2 chains', 'On ', 'Ethereum', ' · ', 'Base', 'Its page: ', 'ccip.dev/projects/xstocks',
      ]),
    );
  });

  it('names an unlabeled sender by its short address and points to Top senders', async () => {
    // #given
    const address = { ...MOMENTS.arrivals.senders![0]!, key: 'address:0x671be08d6d3c826c2f6d76915f1b54af484d4077', label: null, x: null, kind: null };
    const load = withMoments({ arrivals: { ...MOMENTS.arrivals, senders: [address] } });
    // #then
    expect(await words({ kind: 'newcomer', key: address.key }, load)).toEqual(expect.arrayContaining(['0x671b…4077', 'Every sender: ', 'ccip.dev/top/sender/7d']));
  });

  it('has no card for a sender moments.json does not list, and writes no glyph the fonts lack', async () => {
    // #when
    const missing = await broadcastTree({ kind: 'newcomer', key: 'project:nobody' }, inputs);
    const all = await words({ kind: 'newcomer', key: 'project:xstocks' });
    // #then
    expect({ missing, glyphs: all.filter((w) => MISSING_GLYPHS.test(w)) }).toEqual({ missing: null, glyphs: [] });
  });
});

describe('project spotlight card', () => {
  it('names the project big with its growth, its chains, its fees and its page', async () => {
    // #then
    expect(await words({ kind: 'project', monday: '2026-10-05' })).toEqual(
      expect.arrayContaining([
        'PROJECT SPOTLIGHT', 'Fastest-growing project', 'xStocks', '2,100 messages ', '50% vs the week before',
        'On ', 'Ethereum', ' · ', 'Base', 'Paid ', '$525', ' in fees last week', 'Its page: ', 'ccip.dev/projects/xstocks',
      ]),
    );
  });

  const withProject = (patch: Partial<NonNullable<(typeof MOMENTS.weeks)[number]['project']>>) =>
    withMoments({ weeks: MOMENTS.weeks.map((w) => (w.week === '2026-10-05' ? { ...w, project: { ...w.project!, ...patch } } : w)) });
  const downGlyph = btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 5h18l-9 15z" fill="#e58a8a"/></svg>`);

  it('says none the week before, never a first week, when the week before had no messages', async () => {
    // #when
    const found = await words({ kind: 'project', monday: '2026-10-05' }, withProject({ previous_messages: 0 }));
    // #then
    expect({ neutral: found.includes('none the week before'), first: found.some((t) => t.includes('first week')) }).toEqual({ neutral: true, first: false });
  });

  it('shows the value moved before the fees when the project moved value', async () => {
    // #then
    expect(await words({ kind: 'project', monday: '2026-10-05' }, withProject({ usd: 1_200_000 }))).toEqual(expect.arrayContaining(['Moved ', '$1.2M', ' last week']));
  });

  it('has no insight line when the project has neither value nor fees', async () => {
    // #when
    const found = await words({ kind: 'project', monday: '2026-10-05' }, withProject({ fee_usd: null }));
    // #then
    expect(found.some((t) => t.includes('last week'))).toBe(false);
  });

  it('draws a down triangle when the project shrank', async () => {
    // #when
    const tree = await broadcastTree({ kind: 'project', monday: '2026-10-05' }, { ...inputs, load: withProject({ messages: 700, previous_messages: 1_400 }) });
    // #then
    expect(JSON.stringify(tree)).toContain(downGlyph);
  });

  it('has no card for a week without a spotlighted project', async () => {
    // #then
    expect(await broadcastTree({ kind: 'project', monday: '2026-09-28' }, inputs)).toBeNull();
  });
});
