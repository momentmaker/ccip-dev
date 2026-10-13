import { ROSTER_SCHEMA } from '@ccip-dev/core/roster';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { publicRoute, webCardKey } from '../src/public';
import { fakeCache, fakeFetch, fakeRenderer, PNG_BYTES, publicDeps, resetStorage, seedMarine, SNAPSHOT } from './helpers';

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

  it('gives a cache hit its route\'s own Cache-Control back, not the zone\'s Browser Cache TTL', async () => {
    // #given an edge that rewrites a hit's Cache-Control to 4 hours
    const cache = fakeCache({ browserTtl: 14_400 });
    const deps = publicDeps({ cache });
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy');
    await publicRoute(get('/roster.json'), deps);
    await publicRoute(get('/web/9.png'), deps);
    await publicRoute(get('/memes/s1.jpeg.png'), deps);
    await Promise.all(deps.work);
    // #when
    const hits = await Promise.all(['/roster.json', '/web/9.png', '/memes/s1.jpeg.png'].map(async (p) => (await publicRoute(get(p), deps))!));
    // #then
    expect(hits.map((r) => [r.status, r.headers.get('cache-control'), r.headers.get('x-ccip-cache-control')])).toEqual([
      [200, 'public, max-age=60', null],
      [404, 'public, max-age=60', null],
      [200, 'public, max-age=31536000, immutable', null],
    ]);
  });

  it('stores the copy with the route\'s own Cache-Control for the edge to follow', async () => {
    // #given
    const cache = fakeCache();
    const deps = publicDeps({ cache });
    // #when
    await publicRoute(get('/roster.json'), deps);
    await Promise.all(deps.work);
    // #then
    const stored = [...cache.store.values()][0]!;
    expect([stored.headers.get('cache-control'), stored.headers.get('x-ccip-cache-control')]).toEqual(['public, max-age=60', 'public, max-age=60']);
  });

  it('answers 503, never cached, when a route throws unexpectedly', async () => {
    // #given an R2 whose get fails
    const cache = fakeCache();
    const bucket = { get: async () => { throw new Error('R2 down'); } } as unknown as R2Bucket;
    const deps = publicDeps({ bucket, cache });
    // #when
    const answers = await Promise.all(['/memes/s1.jpeg.png', '/web/1.png'].map(async (p) => (await publicRoute(get(p), deps))!));
    await Promise.all(deps.work);
    // #then
    expect([answers.map((r) => [r.status, r.headers.get('cache-control'), r.headers.get('access-control-allow-origin')]), cache.store.size]).toEqual([
      [[503, 'no-store', '*'], [503, 'no-store', '*']],
      0,
    ]);
  });

  it('is not a public path for anything else', async () => {
    // #then
    expect(await publicRoute(get('/rosters.json'), publicDeps())).toBeNull();
  });
});

describe('/memes/<file>.png', () => {
  it('serves a kept meme from R2, immutable, without touching the archive', async () => {
    // #given
    await env.MARINES.put('memes/sp1.jpeg.png', PNG_BYTES);
    const deps = publicDeps();
    // #when
    const res = (await publicRoute(get('/memes/sp1.jpeg.png'), deps))!;
    // #then
    expect([res.status, res.headers.get('content-type'), res.headers.get('cache-control'), deps.fetch.urls.length]).toEqual([200, 'image/png', 'public, max-age=31536000, immutable', 0]);
  });

  it('copies a snapshot meme nobody holds yet once, then serves it from R2', async () => {
    // #given
    const deps = publicDeps();
    // #when
    await publicRoute(get('/memes/sp1.jpeg.png'), deps);
    const again = (await publicRoute(get('/memes/sp1.jpeg.png'), deps))!;
    // #then
    expect([again.status, deps.fetch.urls.length, deps.renderer.calls]).toEqual([200, 1, ['prepareMeme']]);
  });

  it('decodes an escaped file name to the same R2 key', async () => {
    // #given a snapshot meme whose name has a space
    const snapshot = { ...SNAPSHOT, tags: [...SNAPSHOT.tags, { tag: 'odd', count: 1, memes: ['b c.gif'] }] };
    await env.MARINES.put('memes/b c.gif.png', PNG_BYTES);
    // #when
    const res = (await publicRoute(get('/memes/b%20c.gif.png'), publicDeps({ snapshot })))!;
    // #then
    expect(res.status).toBe(200);
  });

  it('answers 404 for a file outside the snapshot, or a broken escape, without fetching', async () => {
    // #given
    const deps = publicDeps();
    // #when
    const answers = [(await publicRoute(get('/memes/elsewhere.jpeg.png'), deps))!, (await publicRoute(get('/memes/%E0%A4%A.png'), deps))!];
    // #then
    expect([answers.map((r) => r.status), deps.fetch.urls.length]).toEqual([[404, 404], 0]);
  });

  it('answers 503, never cached, when the archive fails', async () => {
    // #given an archive that answers nothing
    const cache = fakeCache();
    const deps = publicDeps({ fetch: fakeFetch({}), cache });
    // #when
    const res = (await publicRoute(get('/memes/sp1.jpeg.png'), deps))!;
    await Promise.all(deps.work);
    // #then
    expect([res.status, res.headers.get('cache-control'), cache.store.size]).toEqual([503, 'no-store', 0]);
  });
});

describe('/web/<serial>.png', () => {
  it('renders a Marine’s web card once, keeps it in R2, and serves the copy after', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy', { tier: 'legendary' });
    const deps = publicDeps();
    // #when
    const first = (await publicRoute(get('/web/1.png'), deps))!;
    const second = (await publicRoute(get('/web/1.png'), deps))!;
    // #then
    expect([first.status, second.status, first.headers.get('cache-control'), deps.renderer.calls.filter((c) => c === 'renderMarineWebCard').length, (await env.MARINES.head(webCardKey(1)))?.httpMetadata?.contentType]).toEqual([
      200, 200, 'public, max-age=86400', 1, 'image/png',
    ]);
  });

  it('hands the renderer no Discord name or avatar', async () => {
    // #given
    await seedMarine(PRIVATE_ID, PRIVATE_NAME, 'painting-space-prophecy');
    const deps = publicDeps();
    // #when
    await publicRoute(get('/web/1.png'), deps);
    // #then
    expect([Object.keys(deps.renderer.webCards[0]!).sort(), JSON.stringify(deps.renderer.webCards[0]).includes(PRIVATE_NAME)]).toEqual([
      ['blood', 'callsign', 'enlistedAt', 'faith', 'memes', 'percentile', 'serial', 'tier'],
      false,
    ]);
  });

  it('answers 404, briefly cached, for an unknown, zero or padded serial', async () => {
    // #when
    const answers = await Promise.all(['/web/9.png', '/web/0.png', '/web/007.png', '/web/x.png'].map(async (p) => (await publicRoute(get(p), publicDeps()))!));
    // #then
    expect(answers.map((r) => [r.status, r.headers.get('cache-control')])).toEqual(Array(4).fill([404, 'public, max-age=60']));
  });

  it('answers 503, never cached, when the card fails to render', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy');
    const cache = fakeCache();
    const deps = publicDeps({ renderer: fakeRenderer('renderMarineWebCard'), cache });
    // #when
    const res = (await publicRoute(get('/web/1.png'), deps))!;
    await Promise.all(deps.work);
    // #then
    expect([res.status, res.headers.get('cache-control'), cache.store.size, await env.MARINES.head(webCardKey(1))]).toEqual([503, 'no-store', 0, null]);
  });
});
