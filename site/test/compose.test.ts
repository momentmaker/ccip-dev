import { describe, expect, it, vi } from 'vitest';
import { drawOverlay, overlayText } from '../src/replay/compose';
import type { ReplayFrameState } from '../src/replay/timeline';

const state = (endCard: boolean): ReplayFrameState => ({
  t: 10,
  dayIndex: 1,
  day: '2023-07-07',
  endCard,
  cumulativeMessages: 1_565_729,
  cumulativeUsd: 25_300_000_000,
  activeChains: 95,
  captions: ['Base joins'],
  extent: 1,
  sky: { stars: [], lanes: [], comets: [], rings: [] },
});

describe('overlayText', () => {
  it('describes the frame', () => {
    expect(overlayText(state(false), '2023-07-06', '2026-10-06')).toEqual({
      date: 'Jul 7, 2023',
      totals: '1,565,729 messages · $25.3B moved',
      chains: '95 chains',
      captions: ['Base joins'],
      watermark: 'ccip.dev · 2023-07-06 → 2026-10-06',
      endCard: null,
    });
  });

  it('says "1 chain" for a single chain', () => {
    expect(overlayText({ ...state(false), activeChains: 1 }, '2023-07-06', '2026-10-06').chains).toBe('1 chain');
  });

  it('adds the end card after the last day', () => {
    expect(overlayText(state(true), '2023-07-06', '2026-10-06').endCard).toEqual({
      title: 'ccip.dev',
      lines: ['1,565,729 CCIP messages', '$25.3B moved across 95 chains', 'Live CCIP stats at ccip.dev'],
    });
  });
});

describe('drawOverlay', () => {
  it('writes the date, totals, captions and watermark, plus the end card when present', () => {
    const texts: string[] = [];
    const ctx = {
      save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(),
      fillText: (t: string) => texts.push(t),
      set font(_v: string) {}, set fillStyle(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    drawOverlay(ctx, overlayText(state(true), '2023-07-06', '2026-10-06'), 1920, 1080);
    expect(texts).toEqual([
      'Jul 7, 2023',
      '1,565,729 messages · $25.3B moved',
      '95 chains',
      'Base joins',
      'ccip.dev · 2023-07-06 → 2026-10-06',
      'ccip.dev',
      '1,565,729 CCIP messages',
      '$25.3B moved across 95 chains',
      'Live CCIP stats at ccip.dev',
    ]);
  });
});
