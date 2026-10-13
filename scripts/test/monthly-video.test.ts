import { describe, expect, it } from 'vitest';
import { probeProblems } from '../video/browser';
import { videoProblems, type Probe } from '../video/check';
import { monthPageUrl, pickMonth } from '../video/monthly';

describe('probeProblems', () => {
  it('passes a browser with WebGL2 and an H.264 encoder, and names what another lacks', () => {
    // #given
    const capable = { webgl2: true, renderer: 'SwiftShader', h264: true };
    const incapable = { webgl2: false, renderer: null, h264: false };
    const throwing = { webgl2: true, renderer: null, h264: 'NotSupportedError: unsupported codec' };

    // #when
    const results = [capable, incapable, throwing].map(probeProblems);

    // #then
    expect(results).toEqual([
      [],
      ['WebGL2 is unavailable', 'H.264 (avc1.640028) at 1080×1080 cannot be encoded'],
      ['H.264 (avc1.640028) at 1080×1080 cannot be encoded: NotSupportedError: unsupported codec'],
    ]);
  });
});

const GOOD: Probe = {
  streams: [
    { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1080, pix_fmt: 'yuv420p' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '30.000000', size: '30123456' },
};

describe('videoProblems', () => {
  it('passes a 30 s 1080×1080 H.264 video with AAC sound under 50 MB', () => {
    expect(videoProblems(GOOD)).toEqual([]);
  });

  it('names every way a video can be wrong', () => {
    // #given a long, small, VP9, silent, 4:4:4 video over 50 MB
    const bad: Probe = { streams: [{ codec_type: 'video', codec_name: 'vp9', width: 720, height: 720, pix_fmt: 'yuv444p' }], format: { duration: '31.2', size: '52000000' } };
    // #then
    expect(videoProblems(bad)).toEqual([
      'it lasts 31.2 s, not 29.5–30.5 s',
      'its video is 720×720, not 1080×1080',
      'its video is vp9, not H.264',
      'its pixels are yuv444p, not 4:2:0',
      'it has no audio',
      'it is 52000000 bytes, not under 50 MB',
    ]);
  });

  it('fails an empty probe, as ffprobe gives for a file that is not a video', () => {
    expect(videoProblems({})).toEqual(['it lasts no s, not 29.5–30.5 s', 'it has no video', 'it has no audio', 'it is of no bytes, not under 50 MB']);
  });

  it('accepts 29.5 and 30.5 s, and a full-range 4:2:0 video', () => {
    const at = (duration: string, pix_fmt = 'yuv420p'): Probe => ({ ...GOOD, streams: [{ ...GOOD.streams![0]!, pix_fmt }, GOOD.streams![1]!], format: { ...GOOD.format, duration } });
    expect([at('29.5'), at('30.5'), at('30', 'yuvj420p')].map(videoProblems)).toEqual([[], [], []]);
  });
});

describe('pickMonth', () => {
  it('records the month asked for, or the month before today', () => {
    expect([pickMonth('2026-09', new Date('2026-12-05T00:00:00Z')), pickMonth(undefined, new Date('2026-10-01T01:15:00Z')), pickMonth(undefined, new Date('2027-01-01T01:15:00Z'))]).toEqual([
      '2026-09', '2026-09', '2026-12',
    ]);
  });

  it('refuses a month that is not YYYY-MM', () => {
    expect(() => pickMonth('2026-9', new Date())).toThrow('--month must be YYYY-MM, not 2026-9');
  });
});

describe('monthPageUrl', () => {
  it('opens the unlisted month page on the base, with or without a trailing slash', () => {
    expect([monthPageUrl('https://ccip.dev', '2026-09'), monthPageUrl('http://localhost:4321/', '2026-09')]).toEqual([
      'https://ccip.dev/replay/month/?m=2026-09', 'http://localhost:4321/replay/month/?m=2026-09',
    ]);
  });
});
