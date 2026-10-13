import { monthSummary } from '@ccip-dev/core/month';
import { describe, expect, it } from 'vitest';
import { probeProblems } from '../video/browser';
import { summaryProblems, videoProblems, type Probe } from '../video/check';
import { muxArgs } from '../video/mux';
import { monthPageUrl, pickMonth, RECORDED_FILES } from '../video/monthly';

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
    { codec_type: 'video', codec_name: 'h264', width: 1024, height: 1024, pix_fmt: 'yuv420p' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
  format: { duration: '30.000000', size: '30123456' },
};

describe('videoProblems', () => {
  it('passes a 30 s 1024×1024 H.264 video with AAC sound under 50 MB', () => {
    // #when
    const problems = videoProblems(GOOD);
    // #then
    expect(problems).toEqual([]);
  });

  it('names every way a video can be wrong', () => {
    // #given a long, small, VP9, silent, 4:4:4 video over 50 MB
    const bad: Probe = { streams: [{ codec_type: 'video', codec_name: 'vp9', width: 720, height: 720, pix_fmt: 'yuv444p' }], format: { duration: '31.2', size: '52000000' } };
    // #when
    const problems = videoProblems(bad);
    // #then
    expect(problems).toEqual([
      'it lasts 31.2 s, not 29.5–30.5 s',
      'its video is 720×720, not 1024×1024',
      'its video is vp9, not H.264',
      'its pixels are yuv444p, not yuv420p',
      'it has no audio',
      'it is 52000000 bytes, not under 50 MB',
    ]);
  });

  it('fails an empty probe, as ffprobe gives for a file that is not a video', () => {
    // #when
    const problems = videoProblems({});
    // #then
    expect(problems).toEqual(['it lasts no s, not 29.5–30.5 s', 'it has no video', 'it has no audio', 'it is of no bytes, not under 50 MB']);
  });

  it('accepts 29.5 and 30.5 s', () => {
    // #given
    const at = (duration: string): Probe => ({ ...GOOD, format: { ...GOOD.format, duration } });
    // #when
    const results = [at('29.5'), at('30.5')].map(videoProblems);
    // #then
    expect(results).toEqual([[], []]);
  });
});

describe('pickMonth', () => {
  it('records the month asked for, or the month before today', () => {
    // #when
    const months = [pickMonth('2026-09', new Date('2026-12-05T00:00:00Z')), pickMonth(undefined, new Date('2026-10-01T01:15:00Z')), pickMonth(undefined, new Date('2027-01-01T01:15:00Z'))];
    // #then
    expect(months).toEqual(['2026-09', '2026-09', '2026-12']);
  });

  it('refuses a month that is not YYYY-MM', () => {
    // #when
    const pick = () => pickMonth('2026-9', new Date());
    // #then
    expect(pick).toThrow('--month must be YYYY-MM, not 2026-9');
  });
});

describe('monthPageUrl', () => {
  it('opens the unlisted month page on the base, with or without a trailing slash', () => {
    // #when
    const urls = [monthPageUrl('https://ccip.dev', '2026-09'), monthPageUrl('http://localhost:4321/', '2026-09')];
    // #then
    expect(urls).toEqual(['https://ccip.dev/replay/month/?m=2026-09', 'http://localhost:4321/replay/month/?m=2026-09']);
  });
});

describe('videoProblems, one limit at a time', () => {
  const withVideo = (video: object): Probe => ({ ...GOOD, streams: [{ ...GOOD.streams![0]!, ...video }, GOOD.streams![1]!] });

  it('rejects the 1080×1080 the page records, which is too tall for X', () => {
    // #given
    const probe = withVideo({ width: 1080, height: 1080 });
    // #when
    const problems = videoProblems(probe);
    // #then
    expect(problems).toEqual(['its video is 1080×1080, not 1024×1024']);
  });

  it('rejects the full-range yuvj420p Chrome writes on a Mac', () => {
    // #given
    const probe = withVideo({ pix_fmt: 'yuvj420p' });
    // #when
    const problems = videoProblems(probe);
    // #then
    expect(problems).toEqual(['its pixels are yuvj420p, not yuv420p']);
  });

  it('rejects exactly 50,000,000 bytes and accepts 49,999,999', () => {
    // #given
    const at = (size: string): Probe => ({ ...GOOD, format: { ...GOOD.format, size } });
    // #when
    const results = [at('50000000'), at('49999999')].map(videoProblems);
    // #then
    expect(results).toEqual([['it is 50000000 bytes, not under 50 MB'], []]);
  });

  it('rejects audio that is not AAC', () => {
    // #given
    const probe: Probe = { ...GOOD, streams: [GOOD.streams![0]!, { codec_type: 'audio', codec_name: 'opus' }] };
    // #when
    const problems = videoProblems(probe);
    // #then
    expect(problems).toEqual(['its audio is opus, not AAC']);
  });

  it('rejects 29.4 s', () => {
    // #given
    const probe: Probe = { ...GOOD, format: { ...GOOD.format, duration: '29.4' } };
    // #when
    const problems = videoProblems(probe);
    // #then
    expect(problems).toEqual(['it lasts 29.4 s, not 29.5–30.5 s']);
  });
});

describe('muxArgs', () => {
  it('re-encodes to 1024×1024 yuv420p H.264 High, its bitrate capped at 8 Mbps, with AAC sound', () => {
    // #when
    const args = muxArgs('video.mp4', 'audio.wav', 'out.mp4');
    // #then about 30 MB at most over 30 s, so a busy month stays under the 50 MB limit
    expect(args.join(' ')).toBe(
      '-y -v error -i video.mp4 -i audio.wav -vf scale=1024:1024:flags=lanczos:out_range=tv,format=yuv420p -c:v libx264 -profile:v high -preset medium -crf 18 -maxrate 8M -bufsize 16M -r 30 -c:a aac -b:a 128k -shortest -movflags +faststart out.mp4',
    );
  });
});

describe('summaryProblems', () => {
  const summary = monthSummary('2026-09', { days: [], largest: [], replay: { chains: [], lanes: [], days: [] } });

  it("passes the month's summary.json", () => {
    // #given
    const text = JSON.stringify({ month: '2026-09', summary });
    // #when
    const problems = summaryProblems(text, '2026-09');
    // #then
    expect(problems).toEqual([]);
  });

  it('fails a summary.json that is missing, not JSON, not a month summary, or for another month', () => {
    // #given
    const texts = [null, '{', JSON.stringify({ month: '2026-09' }), JSON.stringify({ month: '2026-08', summary: { ...summary, month: '2026-08' } })];
    // #when
    const problems = texts.map((text) => summaryProblems(text, '2026-09'));
    // #then
    expect(problems).toEqual([
      ['summary.json is missing'],
      ['summary.json is not JSON'],
      ['summary.json is not a month summary (summary: Invalid input: expected object, received undefined)'],
      ['summary.json is for 2026-08, not 2026-09'],
    ]);
  });
});

describe('RECORDED_FILES', () => {
  it('waits for the video, its soundtrack and the month summary', () => {
    // #then
    expect(RECORDED_FILES).toEqual(['video.mp4', 'audio.wav', 'summary.json']);
  });
});
