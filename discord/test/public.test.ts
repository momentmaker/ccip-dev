import { ROSTER_SCHEMA } from '@ccip-dev/core/roster';
import { beforeEach, describe, expect, it } from 'vitest';
import { publicRoute } from '../src/public';
import { fakeCache, publicDeps, resetStorage, seedMarine, SNAPSHOT } from './helpers';

const PRIVATE_NAME = 'Zed PRIVATE-NAME 991';
const PRIVATE_ID = '999888777666555444';
/** A response's JSON body, untyped: the tests check the shape themselves. */
const bodyOf = async (res: Response | null): Promise<any> => res!.json();
const get = (path: string, method = 'GET') => new Request(`https://discord.ccip.dev${path}`, { method });

beforeEach(resetStorage);

describe('/roster.json', () => {
  it('lists every Marine by serial with only the allowlisted fields, as a valid roster', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy', { tier: 'legendary', score: 18.7, percentile: 97.9 });
    await seedMarine('b', 'rory', 'sergey-pepe-comfy');
    // #when
    const body = await bodyOf(await publicRoute(get('/roster.json'), publicDeps()));
    // #then
    expect({ valid: ROSTER_SCHEMA.safeParse(body).success, marines: body.marines.map((m: Record<string, unknown>) => [m.serial, m.callsign, Object.keys(m).sort()]) }).toEqual({
      valid: true,
      marines: [
        [1, 'painting-space-prophecy', ['blood', 'callsign', 'enlisted', 'faith', 'memes', 'percentile', 'score', 'serial', 'tags', 'tier']],
        [2, 'sergey-pepe-comfy', ['blood', 'callsign', 'enlisted', 'faith', 'memes', 'percentile', 'score', 'serial', 'tags', 'tier']],
      ],
    });
  });

  it('never carries a Discord name or id, in the body or the headers', async () => {
    // #given
    await seedMarine(PRIVATE_ID, PRIVATE_NAME, 'painting-space-prophecy');
    // #when
    const res = (await publicRoute(get('/roster.json'), publicDeps()))!;
    const seen = (await res.text()) + JSON.stringify([...res.headers]);
    // #then
    expect([seen.includes(PRIVATE_NAME), seen.includes(PRIVATE_ID)]).toEqual([false, false]);
  });

  it('gives each meme the tag, file and count, and the enlistment as a bare date', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy');
    // #when
    const [marine] = (await bodyOf(await publicRoute(get('/roster.json'), publicDeps()))).marines;
    // #then
    expect({ memes: marine.memes, enlisted: marine.enlisted }).toEqual({
      memes: [
        { tag: 'painting', file: 'shared.gif', count: 1 },
        { tag: 'space', file: 'sp1.jpeg', count: 1 },
        { tag: 'prophecy', file: 'pr1.jpg', count: 3 },
      ],
      enlisted: '2026-10-13',
    });
  });

  it('falls back to the snapshot’s meme count for the first Marines, whose memes were stored without one', async () => {
    // #given memes stored without counts
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy', { memes: ['shared.gif', 'sp1.jpeg', 'pr1.jpg'].map((file, i) => ({ tag: ['painting', 'space', 'prophecy'][i]!, file, key: `memes/${file}.png` })) });
    // #when
    const [marine] = (await bodyOf(await publicRoute(get('/roster.json'), publicDeps()))).marines;
    // #then
    expect(marine.memes.map((m: { count: number }) => m.count)).toEqual([1, 1, 3]);
  });

  it('still builds when a Marine carries a tag the current snapshot lacks', async () => {
    // #given a Marine whose memes were stored without counts, and a snapshot that has since dropped "space"
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy', { memes: ['shared.gif', 'sp1.jpeg', 'pr1.jpg'].map((file, i) => ({ tag: ['painting', 'space', 'prophecy'][i]!, file, key: `memes/${file}.png` })) });
    const snapshot = { ...SNAPSHOT, tags: SNAPSHOT.tags.filter((t) => t.tag !== 'space') };
    // #when
    const res = (await publicRoute(get('/roster.json'), publicDeps({ snapshot })))!;
    const body = await bodyOf(res);
    // #then
    expect({
      status: res.status,
      valid: ROSTER_SCHEMA.safeParse(body).success,
      spaceCount: body.marines[0].memes[1].count,
      spaceInSnapshot: body.snapshot.tags.some((t: { tag: string }) => t.tag === 'space'),
    }).toEqual({ status: 200, valid: true, spaceCount: 1, spaceInSnapshot: false });
  });

  it('carries the snapshot: every tag with its count, its per-pick chance and its first meme', async () => {
    // #when
    const { snapshot } = await bodyOf(await publicRoute(get('/roster.json'), publicDeps()));
    // #then
    expect({
      version: snapshot.version,
      first: snapshot.tags[0],
      total: Math.round(snapshot.tags.reduce((s: number, t: { chance: number }) => s + t.chance, 0) * 1000) / 1000,
    }).toEqual({ version: 3, first: { tag: 'sergey', count: 400, chance: expect.any(Number), meme: 's1.jpeg' }, total: 1 });
  });

  it('answers as JSON any site may read, fresh for a minute', async () => {
    // #when
    const res = (await publicRoute(get('/roster.json'), publicDeps()))!;
    // #then
    expect([res.status, res.headers.get('content-type'), res.headers.get('access-control-allow-origin'), res.headers.get('cache-control')]).toEqual([200, 'application/json', '*', 'public, max-age=60']);
  });

  it('answers HEAD with the headers and no body, and anything else with 405', async () => {
    // #when
    const [head, post] = [(await publicRoute(get('/roster.json', 'HEAD'), publicDeps()))!, (await publicRoute(get('/roster.json', 'POST'), publicDeps()))!];
    // #then
    expect([head.status, head.body, post.status, post.headers.get('allow')]).toEqual([200, null, 405, 'GET, HEAD']);
  });

  it('answers 503, never cached, when the database fails', async () => {
    // #given a D1 that throws
    const cache = fakeCache();
    const deps = publicDeps({ db: { prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database, cache });
    // #when
    const res = (await publicRoute(get('/roster.json'), deps))!;
    await Promise.all(deps.work);
    // #then
    expect([res.status, res.headers.get('cache-control'), cache.store.size]).toEqual([503, 'no-store', 0]);
  });

  it('serves a repeat from the edge cache, so a new Marine waits out the minute', async () => {
    // #given a cached roster of one
    const deps = publicDeps({ cache: fakeCache() });
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy');
    await publicRoute(get('/roster.json'), deps);
    await Promise.all(deps.work);
    await seedMarine('b', 'rory', 'sergey-pepe-comfy');
    // #when
    const again = await bodyOf(await publicRoute(get('/roster.json'), deps));
    // #then
    expect(again.marines.length).toBe(1);
  });

  it('is not a public path for anything else', async () => {
    // #then
    expect(await publicRoute(get('/rosters.json'), publicDeps())).toBeNull();
  });
});
