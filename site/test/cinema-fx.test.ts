import { describe, expect, it } from 'vitest';
import { arrivalSeed, assemble, burst, cometFade, elasticPop, heartbeat, novaFlash, novaRing, shockAt, textTargets } from '../src/replay/cinema/fx';

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

describe('burst particles', () => {
  it('returns one particle per requested count, each visible and sized within range', () => {
    const out = burst(7, 12, 0.3, 1, 0, 0, 100);
    expect(out).toHaveLength(12);
    for (const p of out) {
      expect(p.alpha).toBeGreaterThan(0);
      expect(p.size).toBeGreaterThanOrEqual(0.5);
      expect(p.size).toBeLessThanOrEqual(1);
      expect(Math.hypot(p.x, p.y)).toBeGreaterThan(0);
    }
  });

  it('returns nothing for a count of zero', () => {
    expect(burst(7, 0, 0.3, 1, 0, 0, 100)).toEqual([]);
  });
});

describe('supernova and pop', () => {
  it('flashes for 0.3 s and rings out over 0.8 s', () => {
    expect(novaFlash(0)).toBe(1);
    expect(novaFlash(0.3)).toBe(0);
    expect(novaRing(0)).toEqual({ radius: 0, alpha: 1 });
    expect(novaRing(0.8)).toEqual({ radius: 1, alpha: 0 });
  });

  it('draws no ring before it exists', () => {
    expect(novaRing(-0.5)).toEqual({ radius: 0, alpha: 0 });
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

  it('treats a step below one as one instead of looping forever', () => {
    const data = new Uint8ClampedArray(2 * 1 * 4).fill(255);
    expect(textTargets({ width: 2, height: 1, data }, 0)).toEqual(textTargets({ width: 2, height: 1, data }, 1));
    expect(textTargets({ width: 2, height: 1, data }, -3)).toEqual(textTargets({ width: 2, height: 1, data }, 1));
  });

  it('treats a NaN step as one', () => {
    const data = new Uint8ClampedArray(2 * 1 * 4).fill(255);
    expect(textTargets({ width: 2, height: 1, data }, Number.NaN)).toEqual(textTargets({ width: 2, height: 1, data }, 1));
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

  it('treats a NaN progress as not started', () => {
    expect(assemble(3, sources, targets, Number.NaN)).toEqual(assemble(3, sources, targets, 0));
  });

  it('has every particle strictly between its source and target at half progress', () => {
    const along = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    const goals = [{ x: 100, y: 0 }, { x: 200, y: 0 }];
    const mid = assemble(3, along, goals, 0.5);
    const start = assemble(3, along, goals, 0);
    expect(mid).toHaveLength(2);
    mid.forEach((p, i) => {
      const gap = Math.hypot(goals[i]!.x - p.x, goals[i]!.y - p.y);
      const total = Math.hypot(goals[i]!.x - start[i]!.x, goals[i]!.y - start[i]!.y);
      expect(Math.hypot(p.x, p.y)).toBeGreaterThan(0);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThan(total);
      expect(p.alpha).toBe(1);
    });
  });

  it('clamps progress to the range 0 to 1', () => {
    expect(assemble(3, sources, targets, 2)).toEqual(assemble(3, sources, targets, 1));
    expect(assemble(3, sources, targets, -1)).toEqual(assemble(3, sources, targets, 0));
  });
});

describe('cometFade', () => {
  it('eases a comet in over the first tenth of its flight, so departures never stack at the source', () => {
    expect(cometFade(0)).toBe(0);
    expect(cometFade(0.05)).toBeCloseTo(0.5, 9);
    expect(cometFade(0.1)).toBe(1);
  });

  it('flies at full strength and hands over to the arrival sparks as it lands', () => {
    expect(cometFade(0.5)).toBe(1);
    expect(cometFade(0.97)).toBeLessThan(1);
    expect(cometFade(1)).toBe(0);
  });
});

describe('arrivalSeed', () => {
  it('is stable for the same arrival and differs between arrivals', () => {
    expect(arrivalSeed(4, 10.0001)).toBe(arrivalSeed(4, 10.0));
    expect(arrivalSeed(4, 10)).not.toBe(arrivalSeed(5, 10));
  });

  it('is the same for the same input and differs across times and lanes', () => {
    expect(arrivalSeed(3, 12.5)).toBe(arrivalSeed(3, 12.5));
    expect(arrivalSeed(3, 12.5)).not.toBe(arrivalSeed(3, 13));
    const seeds = new Set([0, 1, 2, 3].flatMap((to) => [1, 2, 3].map((time) => arrivalSeed(to, time))));
    expect(seeds.size).toBe(12);
  });
});
