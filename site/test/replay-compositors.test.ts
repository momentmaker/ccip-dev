import type { DayTotals, ReplayFile } from '@ccip-dev/core/public';
import { describe, expect, it, vi } from 'vitest';
import { CinemaCompositor } from '../src/replay/cinema/compositor';
import type { ReplayCompositor } from '../src/replay/compose';
import {
  buildCompositor,
  liveCinemaOptions,
  liveClassicOptions,
  LossPolicy,
  RECORDING_CINEMA_OPTIONS,
  recordErrorMessage,
  RecordingContextLostError,
  recordingDraw,
  recordingShow,
  recordWithFallback,
  shouldSample,
} from '../src/replay/compositors';
import { PUNCH_IN_S } from '../src/replay/director/camera';
import { Show, type ShowInput } from '../src/replay/director/show';
import { buildLayout } from '../src/sky/layout';
import replayJson from './fixtures/replay.json';

const replay = replayJson as ReplayFile;
const history = replay.days.map((d, i) => ({ day: d.day, messages: i === 2 ? 1500 : 10, token_messages: 10, usd_value: 1000, fee_usd: null, unique_senders: 1, median_delivery_s: 60, unpriced_messages: 0, fee_link_usd: null })) as DayTotals[];
const stars = buildLayout(replay.chains);
const input = (reducedMotion: boolean): ShowInput => ({ replay, history, stars, length: 30, focus: null, eligible: () => true, reducedMotion });
const show = new Show(input(false));
const assets = { names: new Map<string, string>(), ticks: [] };

function fake2d() {
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        if (key === 'measureText') return () => ({ width: 10 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
        return () => {};
      },
      set: () => true,
    },
  );
}
const createCanvas = () => ({ width: 1, height: 1, getContext: (kind: string) => (kind === '2d' ? fake2d() : null) }) as never;
const fakeRenderer = (lost = false) => ({ render: vi.fn(), resize: vi.fn(), setAtlas: vi.fn(), destroy: vi.fn(), lost });
const slamming = {
  frameAt: (t: number) => ({ ...show.frameAt(t), slam: { start: t - 0.05, label: '1K messages', progress: 0.05 } }),
  timing: show.timing,
  length: show.length,
  warp: show.warp,
};

describe('buildCompositor', () => {
  const classic = { kind: 'classic' } as unknown as ReplayCompositor;
  const cinema = { kind: 'cinema' } as unknown as CinemaCompositor;

  it('builds the cinema compositor when WebGL2 is there', () => {
    expect(buildCompositor('cinema', () => true, { cinema: () => cinema, classic: () => classic })).toBe(cinema);
  });

  it('builds the classic compositor without probing once the player has fallen back', () => {
    const supported = vi.fn(() => true);
    const makeCinema = vi.fn(() => cinema);
    expect(buildCompositor('classic', supported, { cinema: makeCinema, classic: () => classic })).toBe(classic);
    expect(supported).not.toHaveBeenCalled();
    expect(makeCinema).not.toHaveBeenCalled();
  });

  it('builds the classic compositor when WebGL2 is missing', () => {
    expect(buildCompositor('cinema', () => false, { cinema: () => cinema, classic: () => classic })).toBe(classic);
  });

  it('falls back to the classic compositor with a warning when the cinema one fails to start', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = () => {
      throw new Error('cinema: WebGL2 is unavailable');
    };
    expect(buildCompositor('cinema', () => true, { cinema: failing, classic: () => classic })).toBe(classic);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('LossPolicy', () => {
  const first = { lost: true };
  const second = { lost: true };
  const flipping = () => ({ render: vi.fn(), resize: vi.fn(), setAtlas: vi.fn(), lost: false, destroy() { this.lost = true; } });

  it('draws a compositor whose context is fine', () => {
    expect(new LossPolicy().assess({ lost: false }, 10_000)).toBe('draw');
  });

  it('recreates on the first context loss and falls back to the classic compositor on the second', () => {
    const policy = new LossPolicy();
    expect(policy.assess(first, 10_000)).toBe('recreate');
    expect(policy.assess(second, 25_000)).toBe('fallback');
  });

  it('counts a lost compositor once however many frames notice it', () => {
    const policy = new LossPolicy();
    expect(policy.assess(first, 10_000)).toBe('recreate');
    expect(policy.assess(first, 10_016)).toBe('ignore');
    expect(policy.assess(first, 10_033)).toBe('ignore');
    expect(policy.assess(second, 70_100)).toBe('recreate');
  });

  it('does not count a compositor that was destroyed on purpose, as on a length or chain change', () => {
    const policy = new LossPolicy();
    const replaced = new CinemaCompositor(show, stars, assets, createCanvas, { ...RECORDING_CINEMA_OPTIONS, createRenderer: () => flipping() as never });
    replaced.destroy();
    expect(policy.assess(replaced, 10_000)).toBe('draw');
    const lost = new CinemaCompositor(show, stars, assets, createCanvas, { ...RECORDING_CINEMA_OPTIONS, createRenderer: () => fakeRenderer(true) as never });
    expect(policy.assess(lost, 11_000)).toBe('recreate');
  });
});

describe('recordWithFallback', () => {
  const blob = new Blob(['mp4']);

  it('records with the cinema compositor when it holds up', async () => {
    const attempt = vi.fn(async () => blob);
    await expect(recordWithFallback(attempt)).resolves.toBe(blob);
    expect(attempt.mock.calls).toEqual([['cinema']]);
  });

  it('retries once with the classic compositor when the cinema context is lost mid-recording', async () => {
    const attempt = vi.fn(async (kind: string) => {
      if (kind === 'cinema') throw new RecordingContextLostError();
      return blob;
    });
    await expect(recordWithFallback(attempt)).resolves.toBe(blob);
    expect(attempt.mock.calls).toEqual([['cinema'], ['classic']]);
  });

  it('does not retry other failures, such as a cancel', async () => {
    const cancel = new DOMException('Recording cancelled', 'AbortError');
    const attempt = vi.fn(async () => {
      throw cancel;
    });
    await expect(recordWithFallback(attempt)).rejects.toBe(cancel);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe('shouldSample', () => {
  it('measures frame times only once the story is on screen, not during the near-empty hook', () => {
    expect(shouldSample(0, 2)).toBe(false);
    expect(shouldSample(1.99, 2)).toBe(false);
    expect(shouldSample(2, 2)).toBe(true);
    expect(shouldSample(12, 1.5)).toBe(true);
  });
});

describe('liveClassicOptions', () => {
  it('keeps the GL sky until the player has fallen back after context losses, then uses the 2D sky', () => {
    expect(liveClassicOptions('cinema')).toEqual({ chrome: false, preferGl: true });
    expect(liveClassicOptions('classic')).toEqual({ chrome: false, preferGl: false });
  });
});

describe('edge feather', () => {
  it('feathers the live canvas into the page and leaves recordings unfeathered', () => {
    const live = fakeRenderer();
    const rec = fakeRenderer();
    new CinemaCompositor(show, stars, assets, createCanvas, { ...liveCinemaOptions(false, { tier: 'high', decided: false }), createRenderer: () => live as never }).draw(15, fake2d() as never, 64, 36);
    new CinemaCompositor(show, stars, assets, createCanvas, { ...RECORDING_CINEMA_OPTIONS, createRenderer: () => rec as never }).draw(15, fake2d() as never, 64, 36);
    expect(live.render.mock.calls[0]![0].edgeFeather).toBeGreaterThan(0);
    expect(rec.render.mock.calls[0]![0].edgeFeather).toBe(0);
  });
});

describe('recording', () => {
  it('records at High even after the live player stepped down to Low', () => {
    const live = new CinemaCompositor(show, stars, assets, createCanvas, { ...liveCinemaOptions(false, { tier: 'low', decided: true }), createRenderer: () => fakeRenderer() as never });
    expect(live.tier).toBe('low');
    const renderer = fakeRenderer();
    const rec = new CinemaCompositor(show, stars, assets, createCanvas, { ...RECORDING_CINEMA_OPTIONS, createRenderer: () => renderer as never });
    for (let t = 0; t < 6; t += 1 / 60) rec.noteFrame(80, t);
    rec.draw(15, fake2d() as never, 64, 36);
    expect(rec.tier).toBe('high');
    expect(renderer.render.mock.calls[0]![0].bloom).toBe('full');
  });

  it('records a full-motion show for a viewer who prefers reduced motion', () => {
    const reduced = new Show(input(true));
    const recorded = recordingShow(reduced, input(true));
    const peak = recorded.slams[0]!.start + PUNCH_IN_S;
    expect(reduced.frameAt(peak).punch).toBe(0);
    expect(recorded.frameAt(peak).punch).toBe(1);
  });

  it('reuses the live show when it already has full motion', () => {
    expect(recordingShow(show, input(false))).toBe(show);
  });

  it('drops the shockwave for a reduced-motion viewer but keeps it in the recording', () => {
    const liveRenderer = fakeRenderer();
    const recRenderer = fakeRenderer();
    new CinemaCompositor(slamming, stars, assets, createCanvas, { ...liveCinemaOptions(true, { tier: 'high', decided: false }), createRenderer: () => liveRenderer as never }).draw(15, fake2d() as never, 64, 36);
    new CinemaCompositor(slamming, stars, assets, createCanvas, { ...RECORDING_CINEMA_OPTIONS, createRenderer: () => recRenderer as never }).draw(15, fake2d() as never, 64, 36);
    expect(liveRenderer.render.mock.calls[0]![0].shock).toBeNull();
    expect(recRenderer.render.mock.calls[0]![0].shock).not.toBeNull();
  });

  it('fails the recording instead of writing frozen frames when the context is lost', () => {
    const ok = new CinemaCompositor(show, stars, assets, createCanvas, { ...RECORDING_CINEMA_OPTIONS, createRenderer: () => fakeRenderer() as never });
    expect(() => recordingDraw(ok)(15, fake2d() as never, 64, 36)).not.toThrow();
    const lost = new CinemaCompositor(show, stars, assets, createCanvas, { ...RECORDING_CINEMA_OPTIONS, createRenderer: () => fakeRenderer(true) as never });
    expect(() => recordingDraw(lost)(15, fake2d() as never, 64, 36)).toThrow(RecordingContextLostError);
  });

  it('tells the viewer the graphics context was lost, rather than blaming the browser', () => {
    expect(recordErrorMessage(new RecordingContextLostError())).toBe('The graphics context was lost while recording. Try again.');
    expect(recordErrorMessage(new Error('encoder failed'))).toBe('Recording failed — try again or use Chrome');
  });

  it('cannot be changed by a caller', () => {
    expect(Object.isFrozen(RECORDING_CINEMA_OPTIONS)).toBe(true);
  });
});
