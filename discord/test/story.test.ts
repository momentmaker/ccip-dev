import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { publicRoute, storyKey } from '../src/public';
import { fakeRenderer, publicDeps, resetStorage, seedMarine, TG_USER } from './helpers';

const PRIVATE_NAME = 'Zed PRIVATE-NAME 991';
const get = (path: string) => new Request(`https://discord.ccip.dev${path}`);

beforeEach(resetStorage);

describe('/story/<serial>.png', () => {
  it('renders a Marine’s Story card once, keeps it in R2, and serves the copy after, to any site', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy', { tier: 'legendary' });
    const deps = publicDeps();
    // #when
    const first = (await publicRoute(get('/story/1.png'), deps))!;
    const second = (await publicRoute(get('/story/1.png'), deps))!;
    // #then
    expect([first.status, second.status, first.headers.get('content-type'), first.headers.get('access-control-allow-origin'), deps.renderer.calls.filter((c) => c === 'renderMarineStory').length, (await env.MARINES.head(storyKey(1)))?.httpMetadata?.contentType]).toEqual([
      200, 200, 'image/png', '*', 1, 'image/png',
    ]);
  });

  it('hands the renderer no name or avatar', async () => {
    // #given
    await seedMarine('999888777666555444', PRIVATE_NAME, 'painting-space-prophecy');
    const deps = publicDeps();
    // #when
    await publicRoute(get('/story/1.png'), deps);
    // #then
    expect([Object.keys(deps.renderer.stories[0]!).sort(), JSON.stringify(deps.renderer.stories[0]).includes(PRIVATE_NAME)]).toEqual([
      ['blood', 'callsign', 'enlistedAt', 'faith', 'memes', 'percentile', 'serial', 'tier'],
      false,
    ]);
  });

  it('answers 404 for an unknown or padded serial, and 503 when the card fails to render', async () => {
    // #given
    await seedMarine('a', 'momentmaker', 'painting-space-prophecy');
    // #when
    const answers = await Promise.all([publicRoute(get('/story/9.png'), publicDeps()), publicRoute(get('/story/01.png'), publicDeps()), publicRoute(get('/story/1.png'), publicDeps({ renderer: fakeRenderer('renderMarineStory') }))]);
    // #then
    expect(answers.map((r) => r!.status)).toEqual([404, 404, 503]);
  });
});

describe('a Telegram Marine on the public routes', () => {
  it('shows in the roster by callsign alone: neither the Telegram id nor the name reaches it, the web card or the Story card', async () => {
    // #given
    const telegramId = String(TG_USER.id);
    await seedMarine(telegramId, PRIVATE_NAME, 'painting-space-prophecy', { platform: 'telegram' });
    const deps = publicDeps();
    // #when
    const roster = await (await publicRoute(get('/roster.json'), deps))!.text();
    await Promise.all([publicRoute(get('/web/1.png'), deps), publicRoute(get('/story/1.png'), deps)]);
    const cards = JSON.stringify([...deps.renderer.webCards, ...deps.renderer.stories]);
    // #then
    expect({ listed: roster.includes('painting-space-prophecy'), leaks: [roster, cards].flatMap((text) => [telegramId, PRIVATE_NAME].filter((secret) => text.includes(secret))) }).toEqual({ listed: true, leaks: [] });
  });
});
