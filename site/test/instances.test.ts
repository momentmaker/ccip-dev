import { describe, expect, it } from 'vitest';
import { GrowingFloats } from '../src/sky/gl-buffers';
import type { SkyFrame } from '../src/sky/frame';
import { COLORS } from '../src/sky/frame';
import { buildInstances, buildLaneVertices, FLOATS_PER_INSTANCE, SHAPE } from '../src/sky/instances';
import type { Projector } from '../src/sky/layout';

const frame: SkyFrame = {
  stars: [
    { x: -1, y: 0, radius: 4, brightness: 1, flash: 0 },
    { x: 1, y: 0, radius: 2, brightness: 0.5, flash: 0 },
  ],
  lanes: [{ from: 0, to: 1, opacity: 0.3 }],
  comets: [{ from: 0, to: 1, progress: 0.5, size: 1, kind: 'gold' }],
  rings: [{ star: 1, progress: 0.25 }],
};
const project: Projector = (x, y) => [100 + x * 50, 100 + y * 50];
const instance = (data: Float32Array, i: number) => [...data.subarray(i * FLOATS_PER_INSTANCE, (i + 1) * FLOATS_PER_INSTANCE)];

describe('buildInstances', () => {
  it('writes two instances per star, a glowing head, a core and a trail per comet, and one per ring', () => {
    expect(buildInstances(frame, project, 1)).toHaveLength((2 * 2 + 1 * 8 + 1) * FLOATS_PER_INSTANCE);
    expect(buildInstances(frame, project, 1, { trail: 3 })).toHaveLength((2 * 2 + 1 * 5 + 1) * FLOATS_PER_INSTANCE);
  });

  it('draws a star as a blue halo and a bright core', () => {
    const data = buildInstances(frame, project, 1);
    expect(instance(data, 0)).toEqual([50, 100, 16, ...COLORS.blue, expect.closeTo(0.18, 5), SHAPE.glow].map((v) => (typeof v === 'number' ? expect.closeTo(v, 5) : v)));
    expect(instance(data, 1)[2]).toBe(4);
    expect(instance(data, 1)[7]).toBe(SHAPE.disc);
  });

  it('puts the comet head on the lane curve in its color', () => {
    const head = instance(buildInstances(frame, project, 1), 10);
    expect(head[0]).toBeCloseTo(100);
    expect(head[1]).toBeCloseTo(110);
    expect(head[2]).toBeCloseTo(26);
    expect(head.slice(3, 6)).toEqual([...COLORS.gold].map((v) => expect.closeTo(v, 5)));
    expect(head[6]).toBe(1);
    expect(head[7]).toBe(SHAPE.glow);
  });

  it('draws a bright core halfway between the comet color and the star color', () => {
    const core = instance(buildInstances(frame, project, 1), 11);
    expect(core[0]).toBeCloseTo(100);
    expect(core[1]).toBeCloseTo(110);
    expect(core[2]).toBeCloseTo(5.2);
    expect(core.slice(3, 6)).toEqual([0, 1, 2].map((ch) => expect.closeTo((COLORS.gold[ch]! + COLORS.star[ch]!) / 2, 5)));
    expect(core[6]).toBe(1);
    expect(core[7]).toBe(SHAPE.disc);
  });

  it('fades the trail behind the head', () => {
    const data = buildInstances(frame, project, 1);
    expect(instance(data, 9)[6]).toBeCloseTo(0.55 * 0.72);
    expect(instance(data, 9)[2]).toBeCloseTo(26 * 0.88);
  });

  it('grows and fades a ring', () => {
    const ring = instance(buildInstances(frame, project, 1), 12);
    expect(ring[0]).toBe(150);
    expect(ring[2]).toBeCloseTo(22.5);
    expect(ring[6]).toBeCloseTo(0.75);
    expect(ring[7]).toBe(SHAPE.ring);
    expect(ring.slice(3, 6)).toEqual([...COLORS.gold].map((v) => expect.closeTo(v, 5)));
  });

  it('draws an arrival ripple at its own reach, in its comet color', () => {
    const ripple = { ...frame, rings: [{ star: 1, progress: 0.5, kind: 'data' as const, reach: 16 }] };
    const ring = instance(buildInstances(ripple, project, 1), 12);
    expect(ring[2]).toBeCloseTo(18);
    expect(ring.slice(3, 6)).toEqual([...COLORS.pale].map((v) => expect.closeTo(v, 5)));
    expect(ring[6]).toBeCloseTo(0.5);
  });

  it('draws nothing for a star that has not appeared yet', () => {
    const hidden = { ...frame, stars: [{ ...frame.stars[0]!, radius: 0 }, frame.stars[1]!] };
    const data = buildInstances(hidden, project, 1);
    expect(instance(data, 0)[6]).toBe(0);
    expect(instance(data, 1)[6]).toBe(0);
  });

  it('hides trail points before the comet starts', () => {
    const early = { ...frame, comets: [{ ...frame.comets[0]!, progress: 0.01 }] };
    const data = buildInstances(early, project, 1);
    expect(instance(data, 4)[6]).toBe(0);
    expect(instance(data, 10)[6]).toBe(1);
    expect(instance(data, 11)[6]).toBe(1);
  });
});

describe('buildLaneVertices', () => {
  it('splits each lane into 16 line segments with its opacity', () => {
    const data = buildLaneVertices(frame, project);
    expect(data).toHaveLength(16 * 2 * 3);
    expect([...data.subarray(0, 3)].map((v) => Number(v.toFixed(3)))).toEqual([50, 100, 0.3]);
    expect([...data.subarray(data.length - 3)].map((v) => Number(v.toFixed(3)))).toEqual([150, 100, 0.3]);
  });
});

describe('reusable targets', () => {
  const bigger: SkyFrame = { ...frame, stars: [...frame.stars, ...frame.stars], comets: [...frame.comets, ...frame.comets] };

  it('fills a reused target with the same instances as a fresh array, whatever came before', () => {
    const target = new GrowingFloats();
    buildInstances(bigger, project, 1, undefined, target);
    expect(buildInstances(frame, project, 1, undefined, target)).toEqual(buildInstances(frame, project, 1));
  });

  it('fills a reused target with the same lane vertices as a fresh array, whatever came before', () => {
    const target = new GrowingFloats();
    buildLaneVertices({ ...frame, lanes: [...frame.lanes, ...frame.lanes] }, project, undefined, target);
    expect(buildLaneVertices(frame, project, undefined, target)).toEqual(buildLaneVertices(frame, project));
  });

  it('zeroes the tail a frame leaves unwritten, instead of keeping the previous frame there', () => {
    const target = new GrowingFloats();
    buildInstances(frame, project, 1, undefined, target);
    const notStarted: SkyFrame = { ...frame, comets: [{ ...frame.comets[0]!, progress: -0.5 }] };
    expect(buildInstances(notStarted, project, 1, undefined, target)).toEqual(buildInstances(notStarted, project, 1));
  });
});
