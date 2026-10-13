import { parseMonthlySummary, type MonthSummary } from '@ccip-dev/core/month';
import { describe, expect, it, vi } from 'vitest';
import { AUDIO_FILE, createRecordHook, SUMMARY_FILE, VIDEO_FILE, type RecordHookDeps } from '../src/replay/record-hook';
import { wavBytes } from '../src/replay/wav';

const MP4 = new Blob([new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112])], { type: 'video/mp4' });
const SEPTEMBER: MonthSummary = {
  month: '2026-09', label: 'September 2026', messages: 7_725, usd: 940_120_000, fees: 3_900, linkSharePct: 40, records: [], joined: [{ selector: '1', name: 'Mode' }], busiestLane: null,
};
const RECORDED = { video: VIDEO_FILE, audio: AUDIO_FILE, summary: SUMMARY_FILE };

function deps(o: Partial<RecordHookDeps> = {}) {
  const files: { name: string; type: string; size: number }[] = [];
  const blobs = new Map<string, Blob>();
  const lines: string[] = [];
  const record = vi.fn<RecordHookDeps['record']>(async (_aspect, _length, onProgress) => {
    for (const f of [0.05, 0.1, 0.12, 0.5, 1]) onProgress(f);
    return { video: MP4, audio: { channels: [new Float32Array([0, 0.5]), new Float32Array([0, -0.5])], sampleRate: 48_000 } };
  });
  const d: RecordHookDeps = {
    canRecord: async () => true,
    record,
    download: (blob, name) => {
      files.push({ name, type: blob.type, size: blob.size });
      blobs.set(name, blob);
    },
    log: (line) => lines.push(line),
    summary: { month: '2026-09', summary: SEPTEMBER },
    ...o,
  };
  return { d, files, blobs, lines, record };
}

describe('the record hook', () => {
  it('records the cut and hands over a silent MP4, a WAV soundtrack and the month summary, logging each tenth once', async () => {
    // #given
    const { d, files, blobs, lines, record } = deps();
    // #when
    const result = await createRecordHook(d)({ aspect: '1:1', length: 30 });
    // #then 2 frames of 2 channels of 16 bits after the 44-byte header
    expect({ result, files: files.map((f) => ({ ...f, size: f.name === SUMMARY_FILE ? 'json' : f.size })), lines, asked: record.mock.calls[0]?.slice(0, 2) }).toEqual({
      result: RECORDED,
      files: [
        { name: 'video.mp4', type: 'video/mp4', size: MP4.size },
        { name: 'audio.wav', type: 'audio/wav', size: 44 + 8 },
        { name: 'summary.json', type: 'application/json', size: 'json' },
      ],
      lines: ['ccipRecord: 0%', 'ccipRecord: 10%', 'ccipRecord: 50%', 'ccipRecord: 100%'],
      asked: ['1:1', 30],
    });
    expect(parseMonthlySummary(await blobs.get(SUMMARY_FILE)!.text(), '2026-09')).toEqual({ summary: SEPTEMBER });
  });

  it('fails with a clear message when the browser cannot encode H.264, and records nothing', async () => {
    // #given
    const { d, files, record } = deps({ canRecord: async () => false });
    // #when
    const failure = await createRecordHook(d)({ aspect: '1:1', length: 30 }).catch((e: Error) => e.message);
    // #then
    expect({ failure, files, recorded: record.mock.calls.length }).toEqual({
      failure: 'ccipRecord: this browser cannot encode H.264 (avc1.640028) at 1080×1080',
      files: [],
      recorded: 0,
    });
  });

  it('refuses an aspect or a length the replay does not have', async () => {
    // #given
    const hook = createRecordHook(deps().d);
    // #when
    const failures = await Promise.all([hook({ aspect: '4:3', length: 30 }), hook({ aspect: '1:1', length: 45 })].map((p) => p.catch((e: Error) => e.message)));
    // #then
    expect(failures).toEqual(['ccipRecord: aspect must be one of 16:9, 1:1, 9:16, not 4:3', 'ccipRecord: length must be one of 15, 30, 60 seconds, not 45']);
  });

  it('runs one recording at a time', async () => {
    // #given a recording that has not finished
    let finish: () => void = () => {};
    const slow = deps({ record: () => new Promise((resolve) => (finish = () => resolve({ video: MP4, audio: { channels: [new Float32Array(1)], sampleRate: 48_000 } }))) });
    const hook = createRecordHook(slow.d);
    const first = hook({ aspect: '1:1', length: 30 });
    await Promise.resolve();
    // #when
    const second = await hook({ aspect: '1:1', length: 30 }).catch((e: Error) => e.message);
    finish();
    // #then
    expect({ second, first: await first }).toEqual({ second: 'ccipRecord: a recording is already running', first: RECORDED });
  });
});

describe('the record hook, guarded across calls', () => {
  it('refuses a second call made in the same tick while the first still checks the browser', async () => {
    // #given a browser check that stays pending
    let release: (ok: boolean) => void = () => {};
    const { d, record } = deps({ canRecord: () => new Promise<boolean>((resolve) => (release = resolve)) });
    const hook = createRecordHook(d);
    // #when two calls arrive together
    const both = Promise.all([hook({ aspect: '1:1', length: 30 }), hook({ aspect: '1:1', length: 30 })].map((p) => p.catch((e: Error) => e.message)));
    release(true);
    const [first, second] = await both;
    // #then
    expect({ first, second, recorded: record.mock.calls.length }).toEqual({
      first: RECORDED,
      second: 'ccipRecord: a recording is already running',
      recorded: 1,
    });
  });

  it('refuses through a re-installed hook while a recording runs, and runs again after a failed check', async () => {
    // #given a recording that has not finished, and a second hook as the player re-creates it
    let finish: () => void = () => {};
    const slow = deps({ record: () => new Promise((resolve) => (finish = () => resolve({ video: MP4, audio: { channels: [new Float32Array(1)], sampleRate: 48_000 } }))) });
    const first = createRecordHook(slow.d)({ aspect: '1:1', length: 30 });
    await Promise.resolve();
    await Promise.resolve();
    // #when
    const reinstalled = await createRecordHook(deps().d)({ aspect: '1:1', length: 30 }).catch((e: Error) => e.message);
    finish();
    await first;
    const refusedBrowser = await createRecordHook(deps({ canRecord: async () => false }).d)({ aspect: '1:1', length: 30 }).catch((e: Error) => e.message);
    const after = await createRecordHook(deps().d)({ aspect: '1:1', length: 30 });
    // #then
    expect({ reinstalled, after, refusedBrowser: String(refusedBrowser).startsWith('ccipRecord: this browser') }).toEqual({
      reinstalled: 'ccipRecord: a recording is already running',
      after: RECORDED,
      refusedBrowser: true,
    });
  });
});

describe('wavBytes', () => {
  it('writes a 16-bit PCM WAV header and the channels interleaved, clipped to ±1', () => {
    // #when
    const bytes = wavBytes({ channels: [new Float32Array([1, -1]), new Float32Array([0.5, 2])], sampleRate: 48_000 });
    const view = new DataView(bytes.buffer);
    const text = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
    // #then
    expect({
      riff: text(0, 4), wave: text(8, 12), fmt: text(12, 16), data: text(36, 40),
      format: view.getUint16(20, true), channels: view.getUint16(22, true), rate: view.getUint32(24, true), bits: view.getUint16(34, true),
      size: view.getUint32(40, true),
      samples: [0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true)),
    }).toEqual({
      riff: 'RIFF', wave: 'WAVE', fmt: 'fmt ', data: 'data', format: 1, channels: 2, rate: 48_000, bits: 16, size: 8, samples: [32767, 16384, -32768, 32767],
    });
  });
});
