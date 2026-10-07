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

function fakeCtx(texts: string[], calls: Record<string, number> = {}) {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'save' || key === 'restore' || key === 'clip') return () => void (calls[key] = (calls[key] ?? 0) + 1);
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

  it('keeps the timeline labels and watermark by default', () => {
    const texts: string[] = [];
    drawStory(fakeCtx(texts), show.frameAt(15), layoutFor(1920, 1080), assets);
    expect(texts).toContain('2023');
    expect(texts).toContain('ccip.dev · @ccipdev');
  });

  it('leaves out the timeline labels and watermark without chrome', () => {
    const texts: string[] = [];
    drawStory(fakeCtx(texts), show.frameAt(15), layoutFor(1920, 1080), assets, { chrome: false });
    expect(texts).not.toContain('2023');
    expect(texts).not.toContain('ccip.dev · @ccipdev');
    expect(texts.some((t) => t.includes('messages'))).toBe(true);
  });

  it('still draws the hook title without chrome', () => {
    const texts: string[] = [];
    drawStory(fakeCtx(texts), show.frameAt(1), layoutFor(1920, 1080), assets, { chrome: false });
    expect(texts).toContain('in 30 seconds');
    expect(texts).not.toContain('ccip.dev · @ccipdev');
  });

  it('balances save and restore in every phase and layout', () => {
    const card = show.cards[0]!;
    const frames = [
      show.frameAt(1),
      show.frameAt(card.start + 0.1),
      { ...show.frameAt(15), slam: { start: 14.5, label: '$10B moved', progress: 0.4 } },
      show.frameAt(29),
    ];
    for (const [w, h] of [[1920, 1080], [1080, 1080], [1080, 1920]] as const) {
      for (const frame of frames) {
        const calls: Record<string, number> = {};
        drawStory(fakeCtx([], calls), frame, layoutFor(w, h), assets);
        expect(calls.save ?? 0).toBe(calls.restore ?? 0);
      }
    }
  });

  it('truncates a card label that does not fit', () => {
    const card = show.cards[0]!;
    const frame = { ...show.frameAt(card.start + 0.5), card: { ...card, label: 'x'.repeat(120), progress: 0.5 } };
    const texts: string[] = [];
    const l = layoutFor(1080, 1080);
    drawStory(fakeCtx(texts), frame, l, assets);
    const drawn = texts.find((t) => t.startsWith('xx'))!;
    expect(drawn.endsWith('…')).toBe(true);
    expect(drawn.length * 10).toBeLessThanOrEqual(l.card.w);
  });

  it('truncates a long chain name on the board', () => {
    const frame = { ...show.frameAt(15), board: [{ selector: 'long', value: 5, rank: 0, alpha: 1, focus: false }] };
    const names = new Map([['long', 'N'.repeat(60)]]);
    const texts: string[] = [];
    drawStory(fakeCtx(texts), frame, layoutFor(1080, 1920), { ...assets, names });
    expect(texts.find((t) => t.startsWith('NN'))!.endsWith('…')).toBe(true);
  });

  it('rolls a carrying digit column with the last digit', () => {
    const frame = { ...show.frameAt(15), story: { ...show.frameAt(15).story, usd: 1.99e6 } };
    const texts: string[] = [];
    drawStory(fakeCtx(texts), frame, layoutFor(1080, 1080), assets);
    expect(texts).toContain('1');
    expect(texts).toContain('2');
    expect(texts).toContain('0');
  });

  it('rolls only the last digit when it is not a nine', () => {
    const base = show.frameAt(15);
    const frame = { ...base, story: { ...base.story, usd: 24.07e9 } };
    const texts: string[] = [];
    drawStory(fakeCtx(texts), frame, layoutFor(1080, 1080), assets);
    expect(texts.filter((t) => t === '4')).toHaveLength(1);
    expect(texts).not.toContain('5');
  });

  it('draws no rolling column in the finale', () => {
    const calls: Record<string, number> = {};
    drawStory(fakeCtx([], calls), show.frameAt(29), layoutFor(1080, 1080), assets);
    expect(calls.clip ?? 0).toBe(0);
  });
});
