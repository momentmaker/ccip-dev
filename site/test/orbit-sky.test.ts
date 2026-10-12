import { describe, expect, it } from 'vitest';
import { LETTERMARK_BG } from '../src/lib/chain-icons';
import type { VNode } from '../worker/h';
import { orbitSky, skyNodes, STAR_COUNT, starField } from '../worker/cards/orbit-sky';

const chain = (selector: string, value: number) => ({ selector, name: `Chain ${selector}`, value });
const style = (node: VNode) => node.props.style as Record<string, unknown>;

describe('orbitSky', () => {
  it('puts the biggest chain at the hub and sizes coins by the square root of value, labeling those of radius 22 or more', () => {
    // #when
    const sky = orbitSky({ chains: [chain('b', 25), chain('a', 100), chain('c', 4), chain('d', 1)], lanes: [], seed: 1 });
    // #then 17 + 29 × √(v / 100)
    expect(sky.coins.map((c) => [c.selector, c.x, c.y, c.r, c.label])).toEqual([
      ['a', 860, 300, 46, true],
      ['b', 1075, 205, 31.5, true],
      ['c', 1010, 470, 22.8, true],
      ['d', 715, 468, 19.9, false],
    ]);
  });

  it('places at most 11 coins and skips chains without value', () => {
    // #given 14 chains and one with no value
    const chains = [...Array.from({ length: 14 }, (_, i) => chain(`c${String(i).padStart(2, '0')}`, 14 - i)), chain('zero', 0)];
    // #then
    expect(orbitSky({ chains, lanes: [], seed: 1 }).coins.map((c) => c.selector)).toEqual(chains.slice(0, 11).map((c) => c.selector));
  });

  it('draws only lanes between placed coins, thickest for the busiest, each with a gradient along it', () => {
    // #given a lane to an unplaced chain and a lane from a chain to itself
    const lanes = [{ src: 'a', dst: 'b', usd: 50 }, { src: 'b', dst: 'c', usd: 10 }, { src: 'a', dst: 'z', usd: 99 }, { src: 'a', dst: 'a', usd: 5 }];
    // #when
    const sky = orbitSky({ chains: [chain('a', 100), chain('b', 50), chain('c', 10)], lanes, seed: 1 });
    // #then 1.6 + 4.4 × usd / 50
    expect({
      paths: [...sky.svg.matchAll(/stroke="url\(#lane(\d+)\)" stroke-width="([\d.]+)"/g)].map((m) => [m[1], m[2]]),
      userSpace: (sky.svg.match(/gradientUnits="userSpaceOnUse"/g) ?? []).length,
    }).toEqual({ paths: [['0', '6'], ['1', '2.5']], userSpace: 2 });
  });

  it('draws 170 seeded stars, the same ones for the same seed', () => {
    expect({ count: (starField(7).match(/<circle/g) ?? []).length, same: starField(7) === starField(7), differs: starField(7) !== starField(8) }).toEqual({
      count: STAR_COUNT,
      same: true,
      differs: true,
    });
  });

  it('dims the sky to 45% except the gold chain', () => {
    // #when
    const sky = orbitSky({ chains: [chain('a', 100), chain('b', 50)], lanes: [{ src: 'a', dst: 'b', usd: 1 }], seed: 1, dim: true, gold: 'b' });
    // #then
    expect({ gold: sky.coins.map((c) => c.gold), lane: sky.svg.includes('stroke-linecap="round" opacity="0.315"'), halo: sky.svg.includes('fill="url(#gold)" opacity="1"') }).toEqual({
      gold: [false, true],
      lane: true,
      halo: true,
    });
  });
});

describe('skyNodes', () => {
  it('draws coins as circle-clipped card elements over the SVG, a lettermark without an icon, and labels for the big ones', () => {
    // #given chain a has an icon and chain b has none
    const sky = orbitSky({ chains: [chain('a', 100), chain('b', 1)], lanes: [], seed: 1 });
    // #when
    const [svg, iconCoin, letterCoin, ...labels] = skyNodes(sky, new Map([['a', 'data:image/svg+xml;base64,AAAA'], ['b', null]]));
    // #then the icon is 1.25 × the coin, so its square corners fall outside the circle
    expect({
      svg: String(svg!.props.src).startsWith('data:image/svg+xml;base64,'),
      clip: [style(iconCoin!).borderRadius, style(iconCoin!).overflow, style(iconCoin!).width],
      icon: (iconCoin!.props.children as VNode).props.width,
      rim: style(iconCoin!).boxShadow,
      letter: [letterCoin!.props.children, style(letterCoin!).backgroundColor],
      labels: labels.map((l) => l.props.children),
    }).toEqual({
      svg: true,
      clip: [46, 'hidden', 92],
      icon: 115,
      rim: '0 0 0 2px rgba(255,255,255,0.28)',
      letter: ['C', LETTERMARK_BG],
      labels: ['Chain a'],
    });
  });
});

describe('star-free zones', () => {
  const zone = { x: 40, y: 40, width: 660, height: 440 };
  const stars = (svg: string) => [...svg.matchAll(/<circle cx="(\d+)" cy="(\d+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

  it('emits no star inside a zone and keeps every other star where it was', () => {
    // #given
    const all = stars(starField(7));
    // #when
    const kept = stars(starField(7, STAR_COUNT, [zone]));
    // #then
    const inside = (s: { x: number; y: number }) => s.x >= zone.x && s.x <= zone.x + zone.width && s.y >= zone.y && s.y <= zone.y + zone.height;
    expect({ inZone: kept.filter(inside), same: kept, skipped: all.some(inside) }).toEqual({ inZone: [], same: all.filter((s) => !inside(s)), skipped: true });
  });

  it('draws the same field as before when no zone is given', () => {
    expect(starField(7, STAR_COUNT, [])).toBe(starField(7));
  });
});
