import { describe, expect, it } from 'vitest';
import { arrivalSeed, assemble, burst, elasticPop, heartbeat, novaFlash, novaRing, shockAt, textTargets } from '../src/replay/cinema/fx';

describe('burst', () => {
  it('starts every particle at the origin, fully opaque', () => {
    for (const p of burst(7, 12, 0, 1, 50, 60, 100)) expect(p).toMatchObject({ x: 50, y: 60, alpha: 1 });
  });

  it('spreads within its reach and fades out by the end of its life', () => {
    const late = burst(7, 12, 0.99, 1, 0, 0, 100);
    for (const p of late) {
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(100 + 1e-9);
      expect(p.alpha).toBeLessThan(0.001);
    }
    expect(burst(7, 12, 0.5, 1, 0, 0, 100)).toEqual(burst(7, 12, 0.5, 1, 0, 0, 100));
    expect(burst(7, 12, 1.2, 1, 0, 0, 100)).toEqual([]);
  });
});

describe('supernova and pop', () => {
  it('flashes for 0.3 s and rings out over 0.8 s', () => {
    expect(novaFlash(0)).toBe(1);
    expect(novaFlash(0.3)).toBe(0);
    expect(novaRing(0)).toEqual({ radius: 0, alpha: 1 });
    expect(novaRing(0.8)).toEqual({ radius: 1, alpha: 0 });
  });

  it('pops a coin from 0 past 1.25 and settles at 1 by 0.5 s', () => {
    expect(elasticPop(0)).toBe(0);
    const samples = Array.from({ length: 50 }, (_, i) => elasticPop(i / 100));
    expect(Math.max(...samples)).toBeCloseTo(1.25, 2);
    expect(elasticPop(0.5)).toBe(1);
    expect(elasticPop(3)).toBe(1);
  });
});

describe('heartbeat and shock', () => {
  it('maps activity to 0.8–1.2 brightness', () => {
    expect(heartbeat(0)).toBe(0.8);
    expect(heartbeat(1)).toBeCloseTo(1.2, 9);
    expect(heartbeat(5)).toBeCloseTo(1.2, 9);
  });

  it('runs a shockwave for half a second', () => {
    expect(shockAt(-0.1)).toBeNull();
    expect(shockAt(0)).toEqual({ progress: 0, strength: 1 });
    expect(shockAt(0.25)!.strength).toBeCloseTo(0.25, 9);
    expect(shockAt(0.5)).toBeNull();
  });
});

describe('textTargets', () => {
  it('samples opaque pixels on the step grid as normalized points', () => {
    const width = 4;
    const height = 2;
    const data = new Uint8ClampedArray(width * height * 4);
    data[(0 * width + 2) * 4 + 3] = 255;
    data[(1 * width + 0) * 4 + 3] = 200;
    data[(1 * width + 3) * 4 + 3] = 10;
    expect(textTargets({ width, height, data }, 1)).toEqual([
      { x: 2 / 4, y: 0 },
      { x: 0, y: 1 / 2 },
    ]);
  });
});

describe('assemble', () => {
  const sources = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const targets = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 300, y: 100 }];
  it('starts on the sources and lands on the targets', () => {
    const start = assemble(3, sources, targets, 0);
    expect(start.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [0, 0]]);
    const end = assemble(3, sources, targets, 1);
    expect(end.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[100, 100], [200, 100], [300, 100]]);
  });
});

describe('arrivalSeed', () => {
  it('is stable for the same arrival and differs between arrivals', () => {
    expect(arrivalSeed(4, 10.0001)).toBe(arrivalSeed(4, 10.0));
    expect(arrivalSeed(4, 10)).not.toBe(arrivalSeed(5, 10));
  });
});
