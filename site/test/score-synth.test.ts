import { describe, expect, it } from 'vitest';
import { impulse, midiHz, normalizePeak } from '../src/replay/score/synth';

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
