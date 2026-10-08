import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../src/replay/director/leaderboard';
import { Show } from '../src/replay/director/show';
import { drawStory, loadCanvasFonts } from '../src/replay/story/draw';
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

interface Drawn {
  text: string;
  font: string;
  alpha: number;
  x: number;
  y: number;
  scale: number;
}

function fontCtx(drawn: Drawn[]) {
  let font = '';
  let alpha = 1;
  let scale = 1;
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'fillText') return (text: string, x: number, y: number) => drawn.push({ text, font, alpha, x, y, scale });
        if (key === 'scale') return (sx: number) => void (scale *= sx);
        if (key === 'restore') return () => void (scale = 1);
        if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
        return () => {};
      },
      set: (_t, key, value) => {
        if (key === 'font') font = value as string;
        if (key === 'globalAlpha') alpha = value as number;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

const px = (font: string) => Number(/([\d.]+)px/.exec(font)![1]);
const fontOf = (drawn: Drawn[], text: string) => drawn.find((d) => d.text === text)!.font;

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

  it('counts "1 chain" in the singular under the counter', () => {
    const base = show.frameAt(15);
    const texts: string[] = [];
    drawStory(fakeCtx(texts), { ...base, story: { ...base.story, messages: 2, chains: 1 } }, layoutFor(1080, 1080), assets);
    expect(texts).toContain('moved · 2 messages · 1 chain');
  });

  it('draws a milestone slam', () => {
    const texts: string[] = [];
    const frame = { ...show.frameAt(15), slam: { start: 14.5, label: '$10B moved', progress: 0.4 } };
    drawStory(fakeCtx(texts), frame, layoutFor(1080, 1920), assets);
    expect(texts).toContain('$10B moved');
  });

  it('lays a dark scrim and shadow under the slam label so it reads over a bright hub', () => {
    const events: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, key) => {
          if (key === 'createRadialGradient') return () => (events.push('radial'), { addColorStop: (_at: number, c: string) => events.push(`stop:${c}`) });
          if (key === 'fillRect') return () => events.push('fillRect');
          if (key === 'fillText') return (text: string) => events.push(`text:${text}`);
          if (key === 'measureText') return (text: string) => ({ width: text.length * 10 });
          if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
          return () => {};
        },
        set: (_t, key, value) => {
          if (key === 'shadowBlur' || key === 'shadowColor') events.push(`${String(key)}:${value}`);
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const frame = { ...show.frameAt(15), slam: { start: 14.5, label: '25 chains', progress: 0.4 } };
    drawStory(ctx, frame, layoutFor(1080, 1080), assets);
    const label = events.indexOf('text:25 chains');
    const radial = events.lastIndexOf('radial', label);
    expect(radial).toBeGreaterThanOrEqual(0);
    expect(events.slice(radial, label)).toContain('fillRect');
    expect(events.slice(radial, label)).toContain('stop:rgba(12, 15, 20, 0.55)');
    expect(events.slice(0, label).some((e) => e.startsWith('shadowBlur:') && Number(e.split(':')[1]) > 0)).toBe(true);
  });

  it('draws the end title in the finale', () => {
    const texts: string[] = [];
    drawStory(fakeCtx(texts), show.frameAt(29), layoutFor(1920, 1080), assets);
    expect(texts).toContain('ccip.dev');
  });

  it('fades the end title in late in the finale, after the particles', () => {
    const early: string[] = [];
    drawStory(fakeCtx(early), show.frameAt(27 + 3 * 0.55), layoutFor(1920, 1080), assets);
    expect(early).not.toContain('ccip.dev');
    const late: string[] = [];
    drawStory(fakeCtx(late), show.frameAt(27 + 3 * 0.9), layoutFor(1920, 1080), assets);
    expect(late).toContain('ccip.dev');
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
    const frame = { ...show.frameAt(15), board: [{ selector: 'long', value: 5, rank: 0, from: 0, to: 0, swap: 1, alpha: 1, shown: 1, focus: false }] };
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

describe('drawStory text fitting', () => {
  const hookFrame = (title: string, subtitle = 'in 30 seconds') => ({ ...show.frameAt(1), hook: { title, subtitle, progress: 0.5 } });
  const slamFrame = (label: string, progress: number) => ({ ...show.frameAt(15), slam: { start: 14.5, label, progress } });
  const sizes = [[1920, 1080], [1080, 1080], [1080, 1920]] as const;

  it.each(sizes)('scales a 200-character hook title and subtitle down to the title box at %ix%i', (w, h) => {
    const l = layoutFor(w, h);
    const title = 'T'.repeat(200);
    const subtitle = 's'.repeat(200);
    const drawn: Drawn[] = [];
    drawStory(fontCtx(drawn), hookFrame(title, subtitle), l, assets);
    const widthAt = (text: string, base: number) => text.length * 10 * (px(fontOf(drawn, text)) / base);
    expect(widthAt(title, 86 * l.unit)).toBeLessThanOrEqual(l.title.w + 1e-6);
    expect(widthAt(subtitle, 44 * l.unit)).toBeLessThanOrEqual(l.title.w + 1e-6);
  });

  it.each(sizes)('fits a long slam label to the slam box at its rest scale at %ix%i', (w, h) => {
    const l = layoutFor(w, h);
    const label = '1,000,000 messages · '.repeat(6);
    const drawn: Drawn[] = [];
    drawStory(fontCtx(drawn), slamFrame(label, 0.5), l, assets);
    expect(label.length * 10 * (px(fontOf(drawn, label)) / (110 * l.unit))).toBeLessThanOrEqual(l.slam.w + 1e-6);
  });

  it('keeps the fitted slam size through the pop, so the 1.4 to 1.0 scale stays relative to it', () => {
    const l = layoutFor(1080, 1080);
    const label = '1,000,000 messages · '.repeat(6);
    const popping: Drawn[] = [];
    const resting: Drawn[] = [];
    drawStory(fontCtx(popping), slamFrame(label, 0.05), l, assets);
    drawStory(fontCtx(resting), slamFrame(label, 0.5), l, assets);
    expect(fontOf(popping, label)).toBe(fontOf(resting, label));
  });

  it.each(sizes)('keeps a long slam label inside the slam box through the whole pop at %ix%i', (w, h) => {
    const l = layoutFor(w, h);
    const label = '1,000,000 messages · '.repeat(6);
    for (const progress of [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.5, 0.9]) {
      const drawn: Drawn[] = [];
      drawStory(fontCtx(drawn), slamFrame(label, progress), l, assets);
      const d = drawn.find((x) => x.text === label)!;
      expect(label.length * 10 * (px(d.font) / (110 * l.unit)) * d.scale).toBeLessThanOrEqual(l.slam.w + 1e-6);
    }
  });

  it('caps the pop of a label that fits at rest but not at 1.4x', () => {
    const l = layoutFor(1080, 1080);
    const label = 'x'.repeat(Math.floor(l.slam.w / 10 / 1.2));
    const drawn: Drawn[] = [];
    drawStory(fontCtx(drawn), slamFrame(label, 0), l, assets);
    const d = drawn.find((x) => x.text === label)!;
    expect(d.scale).toBeGreaterThan(1);
    expect(label.length * 10 * d.scale).toBeLessThanOrEqual(l.slam.w + 1e-6);
  });

  it('gives a short slam label the full 1.4x pop', () => {
    const drawn: Drawn[] = [];
    drawStory(fontCtx(drawn), slamFrame('$1B moved', 0), layoutFor(1080, 1080), assets);
    expect(drawn.find((x) => x.text === '$1B moved')!.scale).toBeCloseTo(1.4, 9);
  });

  it('keeps the base size for short text', () => {
    const l = layoutFor(1080, 1080);
    const drawn: Drawn[] = [];
    drawStory(fontCtx(drawn), hookFrame('CCIP', 'in 30 seconds'), l, assets);
    drawStory(fontCtx(drawn), slamFrame('$1B moved', 0.5), l, assets);
    expect([px(fontOf(drawn, 'CCIP')), px(fontOf(drawn, 'in 30 seconds')), px(fontOf(drawn, '$1B moved'))]).toEqual([86 * l.unit, 44 * l.unit, 110 * l.unit]);
  });
});

describe('a short focus show', () => {
  it('builds a 2-day focus show and draws every frame without throwing', () => {
    const twoDays = {
      ...replay,
      since: '2024-01-01',
      chains: [
        { selector: 'a', name: 'alpha-mainnet', display_name: 'Alpha', first_day: '2024-01-01' },
        { selector: 'b', name: 'beta-mainnet', display_name: 'Beta', first_day: '2024-01-02' },
      ],
      lanes: [[0, 1], [1, 0]],
      days: [
        { day: '2024-01-01', lanes: [[0, 3, 1000]] },
        { day: '2024-01-02', lanes: [[1, 2, 500], [0, 1, 50]] },
      ],
    } as ReplayFile;
    const twoHistory = twoDays.days.map((d) => ({ ...history[0]!, day: d.day }));
    const focusShow = new Show({ replay: twoDays, history: twoHistory, stars: buildLayout(twoDays.chains), length: 15, focus: 'b', eligible: () => true });
    expect(focusShow.days).toEqual(['2024-01-01', '2024-01-02']);
    expect(() => {
      for (const [w, h] of [[1920, 1080], [1080, 1080], [1080, 1920]] as const) {
        for (let t = 0; t <= focusShow.length; t += 0.25) drawStory(fakeCtx([]), focusShow.frameAt(t), layoutFor(w, h), assets);
      }
    }).not.toThrow();
  });
});

describe('drawStory fonts', () => {
  it('draws the counter in the JetBrains Mono weight the page loads (600)', () => {
    const drawn: Drawn[] = [];
    const frame = show.frameAt(15);
    drawStory(fontCtx(drawn), frame, layoutFor(1080, 1080), assets);
    const monoFonts = new Set(drawn.filter((d) => d.font.includes('JetBrains Mono')).map((d) => d.font.split(' ')[0]));
    expect([...monoFonts]).toEqual(['600']);
  });
});

describe('drawStory board', () => {
  const names = new Map([['up', 'Climber'], ['down', 'Faller'], ['third', 'Third'], ['fourth', 'Fourth']]);
  const row = (selector: string, from: number, to: number, swap: number): BoardRow => ({
    selector, value: 10, rank: from + (to - from) * swap, from, to, swap, alpha: 1, shown: 1, focus: false,
  });
  const swapping = (swap: number) => [row('down', 0, 1, swap), row('up', 1, 0, swap), row('third', 2, 2, 1)];
  const draw = (board: BoardRow[], w: number, h: number) => {
    const drawn: Drawn[] = [];
    drawStory(fontCtx(drawn), { ...show.frameAt(15), card: null, slam: null, board }, layoutFor(w, h), { ...assets, names });
    return drawn;
  };

  it('dims the descending row while two rows cross in the wide list, and draws it under the ascending one', () => {
    const drawn = draw(swapping(0.5), 1920, 1080);
    const faller = drawn.findIndex((d) => d.text === 'Faller');
    const climber = drawn.findIndex((d) => d.text === 'Climber');
    expect(drawn[faller]!.alpha).toBeCloseTo(0.5, 6);
    expect(drawn[climber]!.alpha).toBe(1);
    expect(faller).toBeLessThan(climber);
  });

  it('draws both rows at full strength once the swap is over', () => {
    const drawn = draw([row('up', 0, 0, 1), row('down', 1, 1, 1)], 1920, 1080);
    expect(drawn.filter((d) => d.text === 'Faller' || d.text === 'Climber').map((d) => d.alpha)).toEqual([1, 1]);
  });

  it('crossfades two swapping names in place in the strip instead of sliding one over the other', () => {
    const l = layoutFor(1080, 1080);
    const drawn = draw(swapping(0.25), 1080, 1080);
    const colW = l.board.w / 3;
    const columnOf = (d: Drawn) => Math.floor((d.x - l.board.x) / colW);
    const cells = (text: string) => drawn.filter((d) => d.text === text).map((d) => [columnOf(d), d.alpha]);
    expect(cells('Faller')).toEqual([[0, 0.75], [1, 0.25]]);
    expect(cells('Climber')).toEqual([[1, 0.75], [0, 0.25]]);
  });

  it('keeps three strip columns in the network cut even while a fourth row is crossing in', () => {
    const l = layoutFor(1080, 1920);
    const drawn = draw([row('down', 0, 0, 1), row('up', 1, 1, 1), row('third', 2, 3, 0.5), row('fourth', 3, 2, 0.5)], 1080, 1920);
    const xs = new Set(drawn.filter((d) => ['Faller', 'Climber', 'Third', 'Fourth'].includes(d.text)).map((d) => Math.round(d.x - l.board.x)));
    expect([...xs].sort((a, b) => a - b)).toEqual([0, 1, 2].map((c) => Math.round(c * (l.board.w / 3) + 60 * l.unit)));
  });
});

describe('loadCanvasFonts', () => {
  it('loads every face the story layer draws with, so a poster drawn after it uses the real fonts', async () => {
    const loaded: string[] = [];
    await loadCanvasFonts({ load: async (font: string) => (loaded.push(font), []) });
    expect(loaded).toEqual(['400 16px Inter', '600 16px Inter', '800 16px Inter', '600 16px "JetBrains Mono"']);
  });

  it('settles even when a face fails to load, so drawing and recording never hang on fonts', async () => {
    await expect(loadCanvasFonts({ load: async () => Promise.reject(new Error('offline')) })).resolves.toBeUndefined();
  });
});
