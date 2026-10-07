import { describe, expect, it } from 'vitest';
import { atlasLayout } from '../src/replay/cinema/atlas';
import { QualityController, TIERS } from '../src/replay/cinema/quality';
import { COIN_RASTER_PX } from '../src/replay/coin-images';

describe('TIERS', () => {
  it('matches the spec table', () => {
    expect(TIERS.high).toEqual({ bloom: 'full', particles: 1, nebula: true, dust: 3 });
    expect(TIERS.medium).toEqual({ bloom: 'half', particles: 0.5, nebula: true, dust: 2 });
    expect(TIERS.low).toEqual({ bloom: 'off', particles: 0.25, nebula: false, dust: 1 });
  });
});

describe('QualityController', () => {
  const feed = (c: QualityController, ms: number, from: number, to: number) => {
    let tier = c.tier;
    for (let t = from; t < to; t += 1 / 60) tier = c.sample(ms, t);
    return tier;
  };

  it('stays on High when frames are fast', () => {
    expect(feed(new QualityController({}), 12, 0, 3)).toBe('high');
  });

  it('does not decide before the first window has elapsed', () => {
    expect(feed(new QualityController({}), 80, 0, 1.9)).toBe('high');
  });

  it('goes to Medium when the first window median is above 22 ms', () => {
    expect(feed(new QualityController({}), 26, 0, 2.05)).toBe('medium');
  });

  it('goes straight to Low when the first window median is above 30 ms', () => {
    expect(feed(new QualityController({}), 34, 0, 2.05)).toBe('low');
  });

  it('stays on High when the first window is fast and later frames are slow', () => {
    const c = new QualityController({});
    feed(c, 12, 0, 2.05);
    expect(feed(c, 80, 2.05, 8)).toBe('high');
  });

  it('never re-evaluates after Medium, so slow later frames do not reach Low', () => {
    const c = new QualityController({});
    expect(feed(c, 26, 0, 2.05)).toBe('medium');
    expect(feed(c, 34, 2.05, 8)).toBe('medium');
  });

  it('never steps back up', () => {
    const c = new QualityController({});
    feed(c, 34, 0, 2.05);
    expect(feed(c, 5, 2.05, 8)).toBe('low');
  });

  it('stays on Medium from a Medium start at 25 ms', () => {
    expect(feed(new QualityController({ start: 'medium' }), 25, 0, 4)).toBe('medium');
  });

  it('steps from Medium to Low past 30 ms', () => {
    expect(feed(new QualityController({ start: 'medium' }), 34, 0, 4)).toBe('low');
  });

  it('never steps a Medium start up when frames are fast', () => {
    expect(feed(new QualityController({ start: 'medium' }), 5, 0, 4)).toBe('medium');
  });

  it('never changes when locked, as for recordings', () => {
    expect(feed(new QualityController({ locked: true }), 80, 0, 6)).toBe('high');
  });
});

describe('atlasLayout', () => {
  it('packs cells in rows and gives each icon its UV box', () => {
    const l = atlasLayout(20, COIN_RASTER_PX, 1024);
    expect(l.cols).toBe(8);
    expect(l.rows).toBe(3);
    expect(l.width).toBe(1024);
    expect(l.height).toBe(384);
    expect(l.uv(0)).toEqual([0, 0, 0.125, 1 / 3]);
    expect(l.uv(9)).toEqual([0.125, 1 / 3, 0.25, 2 / 3]);
  });
});
