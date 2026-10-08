import { describe, expect, it } from 'vitest';
import type { ScoreEvent } from '../src/replay/score/schedule';
import { impulse, midiHz, normalizePeak, renderScore } from '../src/replay/score/synth';

type Automation = [kind: 'set' | 'lin' | 'exp', value: number, time: number];

class FakeParam {
  value = 0;
  readonly calls: Automation[] = [];
  setValueAtTime(value: number, time: number) {
    this.calls.push(['set', value, time]);
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push(['lin', value, time]);
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.calls.push(['exp', value, time]);
    return this;
  }
  peak(): number {
    return Math.max(this.value, ...this.calls.map((c) => c[1]));
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  connect<T extends FakeNode>(node: T): T {
    this.outputs.push(node);
    return node;
  }
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  start() {}
  stop() {}
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
}

class FakeBuffer {
  private readonly data: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number) {
    return this.data[channel]!;
  }
  copyToChannel(source: Float32Array, channel: number) {
    this.data[channel]!.set(source);
  }
}

class FakeBufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  start() {}
}

class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
}

class FakeContext {
  readonly sampleRate = 48_000;
  readonly destination = new FakeNode();
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly sources: FakeBufferSource[] = [];
  readonly convolvers: FakeConvolver[] = [];
  readonly compressors: FakeCompressor[] = [];
  createOscillator = () => this.track(this.oscillators, new FakeOscillator());
  createGain = () => this.track(this.gains, new FakeGain());
  createBiquadFilter = () => this.track(this.filters, new FakeFilter());
  createBufferSource = () => this.track(this.sources, new FakeBufferSource());
  createConvolver = () => this.track(this.convolvers, new FakeConvolver());
  createDynamicsCompressor = () => this.track(this.compressors, new FakeCompressor());
  createBuffer = (channels: number, length: number, rate: number) => new FakeBuffer(channels, length, rate);
  async startRendering() {
    const out = new FakeBuffer(2, 4, this.sampleRate);
    out.getChannelData(0)[0] = 0.5;
    return out;
  }
  private track<T>(list: T[], node: T): T {
    list.push(node);
    return node;
  }
}

async function graphFor(events: ScoreEvent[], length = 5): Promise<FakeContext> {
  const ctx = new FakeContext();
  await renderScore(events, length, () => ctx as unknown as OfflineAudioContext);
  return ctx;
}

const envelopeOf = (osc: FakeOscillator) => osc.outputs[0] as FakeGain;
const startsAt = (osc: FakeOscillator, hz: number, at: number) => osc.frequency.calls.some(([kind, value, time]) => kind === 'set' && Math.abs(value - hz) < 1e-6 && Math.abs(time - at) < 1e-9);
const feedsReverb = (ctx: FakeContext) => [...ctx.gains, ...ctx.filters, ...ctx.sources, ...ctx.oscillators].some((n) => n.outputs.some((o) => o instanceof FakeConvolver));

describe('midiHz', () => {
  it('maps A4 to 440 Hz and an octave to double', () => {
    expect(midiHz(69)).toBe(440);
    expect(midiHz(81)).toBeCloseTo(880, 9);
  });
});

describe('impulse', () => {
  it('is a deterministic stereo decay that starts loud and ends quiet', () => {
    const [l, r] = impulse(1, 1000, 3);
    expect(l).toHaveLength(1000);
    expect(r).toHaveLength(1000);
    const energy = (a: Float32Array, from: number, to: number) => a.slice(from, to).reduce((s, v) => s + v * v, 0);
    expect(energy(l, 0, 100)).toBeGreaterThan(energy(l, 900, 1000) * 10);
    expect(impulse(1, 1000, 3)[0]).toEqual(l);
    expect(l).not.toEqual(r);
  });
});

describe('normalizePeak', () => {
  it('scales the loudest sample to the target, across channels', () => {
    const a = new Float32Array([0.5, -2]);
    const b = new Float32Array([1, 0]);
    const gain = normalizePeak([a, b], 0.891);
    expect(gain).toBeCloseTo(0.4455, 6);
    expect(Math.max(...[...a, ...b].map(Math.abs))).toBeCloseTo(0.891, 6);
  });

  it('leaves silence alone', () => {
    const a = new Float32Array([0, 0]);
    expect(normalizePeak([a])).toBe(1);
  });
});

describe('renderScore voices', () => {
  it('gives the boom a mid body that sweeps 180 to 90 Hz over a quarter second', async () => {
    const ctx = await graphFor([{ kind: 'boom', time: 2 }]);
    const body = ctx.oscillators.find((o) => o.type === 'triangle' && startsAt(o, 180, 2));
    expect(body).toBeDefined();
    expect(body!.frequency.calls).toContainEqual(['exp', 90, 2.25]);
    expect(envelopeOf(body!).gain.peak()).toBeGreaterThanOrEqual(0.4);
  });

  it('balances the boom toward the mids: the sub peaks no higher than the body', async () => {
    const ctx = await graphFor([{ kind: 'boom', time: 2 }]);
    const sub = ctx.oscillators.find((o) => o.type === 'sine' && startsAt(o, 70, 2))!;
    const body = ctx.oscillators.find((o) => o.type === 'triangle')!;
    expect(envelopeOf(sub).gain.peak()).toBeLessThanOrEqual(envelopeOf(body).gain.peak());
  });

  it('catches transients with a fast master compressor attack', async () => {
    const ctx = await graphFor([]);
    expect(ctx.compressors[0]!.attack.value).toBeLessThanOrEqual(0.003);
  });

  it('opens the boom noise burst to a bright transient', async () => {
    const ctx = await graphFor([{ kind: 'boom', time: 2 }]);
    const lowpass = ctx.sources[0]!.outputs[0] as FakeFilter;
    expect(lowpass.frequency.peak()).toBeGreaterThanOrEqual(2500);
    expect(lowpass.frequency.peak()).toBeLessThanOrEqual(3000);
  });

  it('adds a quiet second and third harmonic to the pulse, about 12 dB down', async () => {
    const ctx = await graphFor([{ kind: 'pulse', time: 1, gain: 1 }]);
    const fundamental = ctx.oscillators.find((o) => startsAt(o, 110, 1))!;
    const peak = envelopeOf(fundamental).gain.peak();
    for (const hz of [220, 330]) {
      const overtone = ctx.oscillators.find((o) => startsAt(o, hz, 1));
      expect(overtone).toBeDefined();
      expect(20 * Math.log10(envelopeOf(overtone!).gain.peak() / peak)).toBeCloseTo(-12, 0);
    }
  });

  it('releases a cadence pad in its own short release with no reverb send', async () => {
    const pad = (release: number, send: number): ScoreEvent => ({ kind: 'pad', time: 0, duration: 2, chord: [43], cutoff: 1, release, send });
    const dry = await graphFor([pad(0.2, 0)]);
    expect(feedsReverb(dry)).toBe(false);
    const padGain = dry.gains.find((g) => g.gain.calls.some(([kind, value, time]) => kind === 'lin' && value === 0 && Math.abs(time - 2.2) < 1e-9));
    expect(padGain).toBeDefined();
    expect(feedsReverb(await graphFor([pad(1.2, 0.35)]))).toBe(true);
  });
});
