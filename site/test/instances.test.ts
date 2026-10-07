import { describe, expect, it } from 'vitest';
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
  it('writes two instances per star, a head plus its trail per comet, and one per ring', () => {
    expect(buildInstances(frame, project, 1)).toHaveLength((2 * 2 + 1 * 7 + 1) * FLOATS_PER_INSTANCE);
    expect(buildInstances(frame, project, 1, { trail: 3 })).toHaveLength((2 * 2 + 1 * 4 + 1) * FLOATS_PER_INSTANCE);
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
    expect(head[2]).toBeCloseTo(9);
    expect(head.slice(3, 6)).toEqual([...COLORS.gold].map((v) => expect.closeTo(v, 5)));
    expect(head[6]).toBe(1);
  });

  it('grows and fades a ring', () => {
    const ring = instance(buildInstances(frame, project, 1), 11);
    expect(ring[0]).toBe(150);
    expect(ring[2]).toBeCloseTo(22.5);
    expect(ring[6]).toBeCloseTo(0.75);
    expect(ring[7]).toBe(SHAPE.ring);
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
