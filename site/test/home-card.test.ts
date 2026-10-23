import { describe, expect, it } from 'vitest';
import { homeTree } from '../worker/cards/home-card';
import { MISSING_GLYPHS } from '../worker/cards/glyphs';
import { BASE, HISTORY, loadFixture, texts } from './fixtures/broadcast';

const inputs = { load: loadFixture, icon: async (selector: string) => (selector === BASE ? 'data:image/svg+xml;base64,AAAA' : null) };
const card = async (load: typeof loadFixture = loadFixture) => texts(await homeTree({ ...inputs, load }));

describe('the home card', () => {
  it('leads with every message since day one and the last 7 days against the week before', async () => {
    // #when 14 days: 2,850 messages and $107M in all; Oct 5–11 has 1,450 and $51M against 1,400 and $56M the week before
    const words = await card();
    // #then
    expect(words).toEqual(
      expect.arrayContaining(['ccip.dev', 'Every CCIP message · since Jul 6, 2023', '2,850', 'messages · $107.0M moved', 'Last 7 days', '1,450', 'messages ', '3.6%', '$51.0M', 'moved ', '8.9%', 'Live at ']),
    );
  });

  it('puts a record set this week in the strip', async () => {
    // #when Oct 11, in the last 7 days, set the records
    const words = await card();
    // #then
    expect(words).toContain('Record this week: ');
  });

  it("names the week's busiest lane when the week set no record", async () => {
    // #given every day alike, so no day set a record
    const flat: typeof loadFixture = async (name) =>
      name === 'history.json'
        ? ({ ...HISTORY, days: HISTORY.days.map((d) => ({ ...d, messages: 200, usd_value: 8e6, fee_usd: 4, fee_link_usd: 1 })), largest_fees: [] } as never)
        : loadFixture(name);
    // #when
    const words = await card(flat);
    // #then
    const strip = words.slice(words.indexOf('Busiest lane this week: '));
    expect({ record: words.includes('Record this week: '), strip: strip.slice(0, strip.indexOf(' · $8.4M') + 1) }).toEqual({
      record: false,
      strip: ['Busiest lane this week: ', 'Ethereum', 'Base', ' · $8.4M'],
    });
  });

  it('has no card before any day is published', async () => {
    // #given
    const empty: typeof loadFixture = async (name) => (name === 'history.json' ? ({ ...HISTORY, days: [] } as never) : loadFixture(name));
    // #then
    expect(await homeTree({ ...inputs, load: empty })).toBeNull();
  });

  it('writes no glyph the card fonts lack', async () => {
    // #then
    expect((await card()).filter((w) => MISSING_GLYPHS.test(w))).toEqual([]);
  });
});
