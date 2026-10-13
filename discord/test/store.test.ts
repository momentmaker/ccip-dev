import { seededRandom } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { drawCallsign, MAX_CLASHES, type Draw } from '../src/draw';
import { enlist, findMarine, setCardKey, type Drafted, type Recruit } from '../src/store';
import { resetStorage, SNAPSHOT } from './helpers';

const recruit = (userId: string, platform = 'discord'): Recruit => ({ platform, userId, displayName: `marine ${userId}`, enlistedAt: '2026-10-13T10:40:00.000Z', snapshotVersion: 3 });

function drafted(draw: Draw): Drafted {
  return { draw, memes: draw.tags.map((tag) => ({ tag, file: `${tag}.jpeg`, key: `memes/${tag}.jpeg.png` })), blood: 'LINK+', faith: '4IR' };
}

/** Drafts the given callsigns in turn, then repeats the last. */
function drafts(...callsigns: string[]): () => Drafted {
  let i = 0;
  return () => {
    const tags = callsigns[Math.min(i++, callsigns.length - 1)]!.split('-') as [string, string, string];
    return drafted({ tags, callsign: tags.join('-'), tagKey: [...tags].sort().join('-'), score: 15, tier: 'common', percentile: 40 });
  };
}

beforeEach(resetStorage);

describe('enlistment', () => {
  it('saves the draw with a serial in enlistment order, from 1', async () => {
    // #when
    const results = [await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy')), await enlist(env.DB, recruit('b'), drafts('painting-space-prophecy'))];
    // #then
    expect(results.map((r) => (r.kind === 'enlisted' ? [r.marine.serial, r.marine.callsign, r.marine.memes.map((m) => m.key)] : r.kind))).toEqual([
      [1, 'sergey-pepe-comfy', ['memes/sergey.jpeg.png', 'memes/pepe.jpeg.png', 'memes/comfy.jpeg.png']],
      [2, 'painting-space-prophecy', ['memes/painting.jpeg.png', 'memes/space.jpeg.png', 'memes/prophecy.jpeg.png']],
    ]);
  });

  it('never draws twice: an enlisted Marine gets their record back, untouched', async () => {
    // #given
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    // #when
    const again = await enlist(env.DB, recruit('a'), drafts('painting-space-prophecy'));
    // #then
    expect(again.kind === 'already' && [again.marine.serial, again.marine.callsign]).toEqual([1, 'sergey-pepe-comfy']);
  });

  it('draws again on a callsign whose tags another Marine holds in any order, keeping serials dense', async () => {
    // #given
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    // #when b first draws the same three tags in another order
    const b = await enlist(env.DB, recruit('b'), drafts('comfy-sergey-pepe', 'pepe-comfy-sergey', 'painting-space-prophecy'));
    // #then
    expect(b.kind === 'enlisted' && [b.marine.serial, b.marine.callsign]).toEqual([2, 'painting-space-prophecy']);
  });

  it(`gives up after ${MAX_CLASHES} clashes`, async () => {
    // #given
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    let drawn = 0;
    // #when
    const b = await enlist(env.DB, recruit('b'), () => {
      drawn++;
      return drafts('pepe-sergey-comfy')();
    });
    // #then
    expect({ kind: b.kind, drawn, saved: await findMarine(env.DB, 'discord', 'b') }).toEqual({ kind: 'clashed', drawn: MAX_CLASHES, saved: null });
  });

  it('gives two enlistments at once one Marine: the second finds the first', async () => {
    // #when
    const [x, y] = await Promise.all([enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy')), enlist(env.DB, recruit('a'), drafts('painting-space-prophecy'))]);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM marines').first<{ n: number }>();
    const next = await enlist(env.DB, recruit('b'), drafts('space-comfy-pepe'));
    // #then and the next Marine is #2
    expect({
      kinds: [x.kind, y.kind].sort(),
      count: count?.n,
      same: x.kind !== 'clashed' && y.kind !== 'clashed' && x.marine.callsign === y.marine.callsign,
      next: next.kind === 'enlisted' && next.marine.serial,
    }).toEqual({ kinds: ['already', 'enlisted'], count: 1, same: true, next: 2 });
  });

  it('keeps one Marine per account per platform: the same id on Telegram is another Marine', async () => {
    // #when
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    const telegram = await enlist(env.DB, recruit('a', 'telegram'), drafts('painting-space-prophecy'));
    // #then
    expect(telegram.kind === 'enlisted' && telegram.marine.serial).toBe(2);
  });

  it('records the stamped card', async () => {
    // #given
    await enlist(env.DB, recruit('a'), drafts('sergey-pepe-comfy'));
    // #when
    await setCardKey(env.DB, 1, 'cards/1.png');
    // #then
    expect((await findMarine(env.DB, 'discord', 'a'))?.cardKey).toBe('cards/1.png');
  });

  it('saves a real draw whole: tags, tier, score, percentile, lore and snapshot version', async () => {
    // #given
    const draw = drawCallsign(SNAPSHOT, seededRandom(9));
    // #when
    await enlist(env.DB, recruit('a'), () => drafted(draw));
    // #then
    const m = (await findMarine(env.DB, 'discord', 'a'))!;
    expect([m.tags, m.tier, m.score, m.percentile, m.blood, m.faith, m.snapshotVersion, m.displayName, m.cardKey]).toEqual([draw.tags, draw.tier, draw.score, draw.percentile, 'LINK+', '4IR', 3, 'marine a', null]);
  });
});
