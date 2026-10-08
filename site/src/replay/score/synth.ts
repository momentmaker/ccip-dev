import { mulberry32 } from '../timeline';
import type { ScoreEvent } from './schedule';

export const SAMPLE_RATE = 48_000;
const PEAK = 0.891;
const REVERB_S = 2.6;
const FADE_IN_S = 0.4;
const FADE_OUT_S = 0.5;
const SILENT = 0.0001;
const SWELL_TAIL = { release: 1.2, send: 0.35 } as const;

export function midiHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function impulse(seconds: number, rate: number, seed: number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const frames = Math.round(seconds * rate);
  const rng = mulberry32(seed);
  const make = () => {
    const out = new Float32Array(new ArrayBuffer(frames * Float32Array.BYTES_PER_ELEMENT));
    for (let i = 0; i < frames; i++) out[i] = (rng() * 2 - 1) * (1 - i / frames) ** 3;
    return out;
  };
  return [make(), make()];
}

export function normalizePeak(channels: Float32Array[], target = PEAK): number {
  let peak = 0;
  for (const c of channels) for (const v of c) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return 1;
  const gain = target / peak;
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i]! *= gain;
  return gain;
}

interface Voices {
  ctx: OfflineAudioContext;
  dry: AudioNode;
  wet: AudioNode;
}

function envelope(ctx: BaseAudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(SILENT, at + attack + decay);
  return g;
}

function tone(v: Voices, type: OscillatorType, freq: number, at: number, peak: number, attack: number, decay: number, send: number): void {
  const osc = v.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  const g = envelope(v.ctx, at, peak, attack, decay);
  osc.connect(g);
  g.connect(v.dry);
  if (send > 0) {
    const s = v.ctx.createGain();
    s.gain.value = send;
    g.connect(s);
    s.connect(v.wet);
  }
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

function chord(v: Voices, notes: readonly number[], at: number, duration: number, from: number, to: number, peak: number, tail: { release: number; send: number }): void {
  const filter = v.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.linearRampToValueAtTime(to, at + duration);
  const g = v.ctx.createGain();
  const attack = Math.min(1.2, duration / 3);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + duration);
  g.gain.linearRampToValueAtTime(0, at + duration + tail.release);
  filter.connect(g);
  g.connect(v.dry);
  if (tail.send > 0) {
    const send = v.ctx.createGain();
    send.gain.value = tail.send;
    g.connect(send);
    send.connect(v.wet);
  }
  for (const note of notes) {
    for (const detune of [-7, 0, 7]) {
      const osc = v.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(midiHz(note), at);
      osc.detune.setValueAtTime(detune, at);
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + duration + tail.release + 0.1);
    }
  }
}

function boom(v: Voices, at: number): void {
  const osc = v.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(70, at);
  osc.frequency.exponentialRampToValueAtTime(32, at + 1);
  const g = envelope(v.ctx, at, 0.6, 0.01, 1.6);
  osc.connect(g);
  g.connect(v.dry);
  osc.start(at);
  osc.stop(at + 1.7);
  const frames = Math.round(0.6 * v.ctx.sampleRate);
  const buffer = v.ctx.createBuffer(1, frames, v.ctx.sampleRate);
  const rng = mulberry32(Math.round(at * 1000));
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = rng() * 2 - 1;
  const noise = v.ctx.createBufferSource();
  noise.buffer = buffer;
  const lp = v.ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const ng = envelope(v.ctx, at, 0.3, 0.005, 0.5);
  noise.connect(lp);
  lp.connect(ng);
  ng.connect(v.dry);
  ng.connect(v.wet);
  noise.start(at);
}

function pulse(v: Voices, at: number, gain: number): void {
  const osc = v.ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(110, at);
  osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
  const g = envelope(v.ctx, at, 0.5 * gain, 0.005, 0.35);
  osc.connect(g);
  g.connect(v.dry);
  osc.start(at);
  osc.stop(at + 0.4);
}

export async function renderScore(
  events: readonly ScoreEvent[],
  length: number,
  createContext: (frames: number) => OfflineAudioContext = (frames) => new OfflineAudioContext(2, frames, SAMPLE_RATE),
): Promise<AudioBuffer> {
  const ctx = createContext(Math.ceil(length * SAMPLE_RATE));
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 12;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.25;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(1, FADE_IN_S);
  master.gain.setValueAtTime(1, Math.max(FADE_IN_S, length - FADE_OUT_S));
  master.gain.linearRampToValueAtTime(0, length);
  compressor.connect(master);
  master.connect(ctx.destination);
  const reverb = ctx.createConvolver();
  const [left, right] = impulse(REVERB_S, ctx.sampleRate, 7);
  const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
  ir.copyToChannel(left, 0);
  ir.copyToChannel(right, 1);
  reverb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  reverb.connect(wet);
  wet.connect(compressor);
  const voices: Voices = { ctx, dry: compressor, wet: reverb };
  for (const e of events) {
    switch (e.kind) {
      case 'pad':
        chord(voices, e.chord, e.time, e.duration, 300 + 2600 * e.cutoff, 300 + 2600 * e.cutoff, 0.035, e);
        break;
      case 'pulse':
        pulse(voices, e.time, e.gain);
        break;
      case 'pluck':
        tone(voices, 'triangle', midiHz(e.note), e.time, 0.12 * e.gain, 0.005, 0.45, 0.4);
        break;
      case 'chime':
        tone(voices, 'sine', midiHz(e.note), e.time, 0.08, 0.005, 1.8, 0.6);
        tone(voices, 'sine', midiHz(e.note) * 2.01, e.time, 0.03, 0.005, 1.2, 0.6);
        break;
      case 'boom':
        boom(voices, e.time);
        break;
      case 'run':
        e.notes.forEach((note, i) => tone(voices, 'triangle', midiHz(note), e.time + i * 0.07, 0.1, 0.005, 0.5, 0.5));
        break;
      case 'swell':
        chord(voices, e.chord, e.time, e.duration, 400, 3200, 0.05, SWELL_TAIL);
        break;
    }
  }
  const buffer = await ctx.startRendering();
  normalizePeak(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
  return buffer;
}
