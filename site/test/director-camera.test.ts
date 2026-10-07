import { describe, expect, it } from 'vitest';
import { cameraAt, ORBIT_RAD, punch, PUNCH } from '../src/replay/director/camera';

const base = { baseExtent: 2, fullExtent: 3, storyStart: 2, storyEnd: 27, slamStarts: [] as number[], focus: null };

describe('punch', () => {
  it('rises over 0.3 s, then falls back to 0 by 1.1 s', () => {
    expect(punch(-1)).toBe(0);
    expect(punch(0.3)).toBeCloseTo(1, 6);
    expect(punch(1.1)).toBe(0);
    expect(punch(0.15)).toBeGreaterThan(0);
  });
});

describe('cameraAt', () => {
  it('starts centered with no rotation, then orbits through the story', () => {
    expect(cameraAt({ ...base, t: 2 })).toEqual({ cx: 0, cy: 0, extent: 2, rotation: 0 });
    expect(cameraAt({ ...base, t: 14.5 }).rotation).toBeCloseTo(ORBIT_RAD / 2, 6);
  });

  it('eases to the full shot with no rotation in the finale', () => {
    const c = cameraAt({ ...base, t: 29.5 });
    expect(c.extent).toBeCloseTo(3, 6);
    expect(c.rotation).toBeCloseTo(0, 6);
  });

  it('pushes in on a milestone', () => {
    expect(cameraAt({ ...base, t: 10.3, slamStarts: [10] }).extent).toBeCloseTo(2 * (1 - PUNCH), 6);
  });

  it('pans toward the focus chain late in the story, widening to keep the network in view', () => {
    const early = cameraAt({ ...base, t: 10, focus: { x: 1, y: 0 } });
    const late = cameraAt({ ...base, t: 27, focus: { x: 1, y: 0 } });
    expect(early.cx).toBe(0);
    expect(late.cx).toBeCloseTo(0.35, 6);
    expect(late.extent).toBeCloseTo(2 + 0.35, 6);
  });

  it('moves smoothly: no jump over 2% of the extent between frames', () => {
    let prev = cameraAt({ ...base, t: 0, slamStarts: [8, 15], focus: { x: 0.6, y: 0.4 } });
    for (let t = 1 / 30; t <= 30; t += 1 / 30) {
      const now = cameraAt({ ...base, t, slamStarts: [8, 15], focus: { x: 0.6, y: 0.4 } });
      expect(Math.abs(now.extent - prev.extent)).toBeLessThan(0.02 * prev.extent);
      prev = now;
    }
  });
});
