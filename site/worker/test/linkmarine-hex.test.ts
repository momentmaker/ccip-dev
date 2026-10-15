import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { webMarine } from '../../test/fixtures/linkmarine';
import { h } from '../h';
import { S } from '../linkmarine/art';
import { LinkMarineCards } from '../linkmarine/entrypoint';
import { BACK_TAG, ETCH_HEX, PLANET_LAYOUTS, PLANET_R, skyChoices } from '../linkmarine/marine-card';
import { renderKino } from '../linkmarine/render';
import { pngImage } from './png';

interface Point {
  x: number;
  y: number;
}

const solid = async (color: string) => (await renderKino(h('div', { style: { width: 240, height: 240, display: 'flex', backgroundColor: color } }), { width: 240, height: 240 })).png;
const cards = () => new LinkMarineCards(createExecutionContext(), {} as never);

/** A pointy-top hexagon's corners, clockwise from the top, as the clip-path draws them on a box. */
const hexagon = (left: number, top: number, width: number, height: number): Point[] =>
  [[0.5, 0], [1, 0.25], [1, 0.75], [0.5, 1], [0, 0.75], [0, 0.25]].map(([u, v]) => ({ x: left + u! * width, y: top + v! * height }));

/** A point `distance` px off an edge, t of the way along it: outside the hexagon, or inside when negative. */
function beside(hex: Point[], edge: number, t: number, distance: number): [number, number] {
  const a = hex[edge]!;
  const b = hex[(edge + 1) % 6]!;
  const centre = { x: hex.reduce((sum, p) => sum + p.x, 0) / 6, y: hex.reduce((sum, p) => sum + p.y, 0) / 6 };
  const along = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const faces = (b.y - a.y) * (along.x - centre.x) - (b.x - a.x) * (along.y - centre.y) > 0 ? 1 : -1;
  return [Math.round(along.x + (faces * (b.y - a.y) * distance) / length), Math.round(along.y - (faces * (b.x - a.x) * distance) / length)];
}

type Rendered = Awaited<ReturnType<typeof pngImage>>;
let pair: Promise<[Rendered, Rendered]> | null = null;
/** The card drawn once with white memes and once with black ones: where the memes show, the two differ. */
const whiteAndBlack = () =>
  (pair ??= (async () => {
    const memes = await Promise.all([solid('#ffffff'), solid('#000000')]);
    const [white, black] = await Promise.all(memes.map(async (meme) => pngImage(await cards().renderMarineWebCard(webMarine('legendary', [meme])))));
    return [white!, black!];
  })());

const showsMeme = ([a, b]: [Rendered, Rendered], [x, y]: [number, number]) => a.at(x, y).some((channel, i) => channel !== b.at(x, y)[i]);

describe('the dog tag card: the meme hexagons', () => {
  it('cuts each planet meme out as a clean hexagon, none of it poking out past an edge', async () => {
    // #given the same card drawn with white memes and with black ones
    const renders = await whiteAndBlack();
    const planets = PLANET_LAYOUTS[skyChoices('painting-space-prophecy').layout]!.planets.map((p, i) => {
      const r = PLANET_R[i]!;
      return hexagon(p.x - (r * Math.sqrt(3)) / 2, p.y - r, r * Math.sqrt(3), r * 2).map((c) => ({ x: c.x * S, y: c.y * S }));
    });
    const edges = planets.flatMap((hex) => [0, 2].map((edge) => ({ hex, edge })));
    const probes = (distance: number) => edges.flatMap(({ hex, edge }) => [0.8, 0.95].map((t) => beside(hex, edge, t, distance)));
    // #then 2.5 px outside an edge the two cards agree, and 4 px inside it the meme shows
    expect({ outside: probes(2.5).map((p) => showsMeme(renders, p)), inside: probes(-4).map((p) => showsMeme(renders, p)) }).toEqual({ outside: probes(2.5).map(() => false), inside: probes(-4).map(() => true) });
  });

  it('cuts each etched meme out as a clean hexagon too, its slant straight and its corner whole', async () => {
    // #given the same card drawn with white memes and with black ones
    const renders = await whiteAndBlack();
    // The first etching sits under the chain and the front tag covers the others' lower edges, so only the upper right slant of the other two is in the open.
    const etched = [1, 2].map((i) =>
      hexagon(BACK_TAG.left + ETCH_HEX.left + i * (ETCH_HEX.width + ETCH_HEX.gap), BACK_TAG.top + ETCH_HEX.top, ETCH_HEX.width, ETCH_HEX.height).map((c) => ({ x: c.x * S, y: c.y * S })),
    );
    const probes = (distance: number) => etched.flatMap((hex) => [0.6, 0.95].map((t) => beside(hex, 0, t, distance)));
    // #then 2.5 px outside the slant the two cards agree, and 4 px inside it, up to the corner, the meme shows
    expect({ outside: probes(2.5).map((p) => showsMeme(renders, p)), inside: probes(-4).map((p) => showsMeme(renders, p)) }).toEqual({ outside: probes(2.5).map(() => false), inside: probes(-4).map(() => true) });
  });
});
