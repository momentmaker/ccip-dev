import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import { Show } from '../src/replay/director/show';
import { drawStory } from '../src/replay/story/draw';
import { layoutFor } from '../src/replay/story/layout';
import { chainNameMap } from '../src/lib/names';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d) => ({ day: d.day, messages: 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const show = new Show({ replay, history, stars: buildLayout(replay.chains), length: 30, focus: null, eligible: () => true });
const assets = { names: chainNameMap(replay.chains), coins: new Map<string, CanvasImageSource>(), ticks: [{ at: 0, label: '2023' }] };

function fakeCtx(texts: string[]) {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'fillText') return (s: string) => texts.push(s);
        if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
        return () => {};
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

describe('drawStory', () => {
  it('draws the hook title and the watermark during the hook', () => {
    const texts: string[] = [];
    drawStory(fakeCtx(texts), show.frameAt(1), layoutFor(1920, 1080), assets);
    expect(texts).toContain('1 month of Chainlink CCIP');
    expect(texts).toContain('in 30 seconds');
    expect(texts).toContain('ccip.dev · @ccipdev');
  });

  it('draws the date, counter, the active card and the board during the story', () => {
    const card = show.cards[0]!;
    const frame = show.frameAt(card.start + 0.1);
    const texts: string[] = [];
    drawStory(fakeCtx(texts), frame, layoutFor(1080, 1080), assets);
    expect(texts.some((t) => t.startsWith('Jul '))).toBe(true);
    expect(texts).toContain(card.label);
    expect(texts.some((t) => t.includes('messages'))).toBe(true);
  });

  it('draws a milestone slam', () => {
    const texts: string[] = [];
    const frame = { ...show.frameAt(15), slam: { start: 14.5, label: '$10B moved', progress: 0.4 } };
    drawStory(fakeCtx(texts), frame, layoutFor(1080, 1920), assets);
    expect(texts).toContain('$10B moved');
  });

  it('draws the end title in the finale', () => {
    const texts: string[] = [];
    drawStory(fakeCtx(texts), show.frameAt(29), layoutFor(1920, 1080), assets);
    expect(texts).toContain('ccip.dev');
  });
});
