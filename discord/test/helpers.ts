import { seededRandom, type LinkMarineRenderer } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import type { Bot } from '../src/bot';
import type { Attachment, DiscordApi } from '../src/discord-api';
import { simulate, type CallsignSnapshot } from '../src/draw';
import type { CommandOption, Interaction } from '../src/interactions';

export const GUILD = '1100000000000000001';
export const APP = '1200000000000000002';

/** A slash command run in the LinkMarine server by momentmaker. */
export function command(name: string, options: CommandOption[] = [], extra: Partial<Interaction> = {}): Interaction {
  return {
    id: '1300000000000000003',
    type: 2,
    token: 'tok',
    application_id: APP,
    guild_id: GUILD,
    member: { user: { id: '1400000000000000004', username: 'momentmaker', global_name: 'moment maker', avatar: 'abc' }, nick: null, avatar: null },
    data: { name, options },
    ...extra,
  };
}

const TAGS = [
  { tag: 'sergey', count: 400, memes: ['s1.jpeg', 's2.jpeg', 's3.png'] },
  { tag: 'pepe', count: 100, memes: ['p1.jpeg', 'shared.gif'] },
  { tag: 'comfy', count: 25, memes: ['c1.png'] },
  { tag: 'painting', count: 1, memes: ['shared.gif'] },
  { tag: 'space', count: 1, memes: ['sp1.jpeg'] },
  { tag: 'prophecy', count: 3, memes: ['pr1.jpg', 'pr2.jpeg', 'pr3.png'] },
];

/** A six-tag snapshot, simulated as the real one is, with fewer draws. */
export const SNAPSHOT: CallsignSnapshot = {
  version: 3,
  archive: { repo: 'momentmaker/chainlinkmeme', sha: 'c0ffee' },
  tags: TAGS,
  lore: { blood: [{ text: 'LINK+', weight: 3 }, { text: 'O-LINK', weight: 1 }], faith: [{ text: '4IR', weight: 1 }] },
  ...simulate(TAGS, 20_000, 1),
};

export async function resetStorage(): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM marines'), env.DB.prepare('DELETE FROM meta'), env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'marines'")]);
  const listed = await env.MARINES.list();
  await Promise.all(listed.objects.map((o) => env.MARINES.delete(o.key)));
}

export const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
export const GIF_BYTES = new Uint8Array([71, 73, 70, 56, 57, 97]);

/** The site's renderer as the bot calls it, counting calls; `failing` names a method that throws. */
export function fakeRenderer(failing: keyof LinkMarineRenderer | null = null): LinkMarineRenderer & { calls: string[] } {
  const calls: string[] = [];
  const call = <T>(name: keyof LinkMarineRenderer, value: T) => {
    calls.push(name);
    if (failing === name) throw new Error(`${name} failed`);
    return value;
  };
  return {
    calls,
    async prepareMeme() {
      return call('prepareMeme', PNG_BYTES);
    },
    async renderMarineCard() {
      return call('renderMarineCard', PNG_BYTES);
    },
    async renderMarineGlint(card) {
      return call('renderMarineGlint', card.tier === 'rare' || card.tier === 'legendary' ? GIF_BYTES : null);
    },
    async renderIntelCard() {
      return call('renderIntelCard', PNG_BYTES);
    },
  };
}

/** A fetch that answers from a table of URL prefixes, recording each URL; anything else is a 404. */
export function fakeFetch(routes: Record<string, () => Response> = {}): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const f = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    return route ? routes[route]!() : new Response('not found', { status: 404 });
  };
  return Object.assign(f as typeof fetch, { urls });
}

export interface DiscordCall {
  kind: 'edit' | 'private';
  content: string;
  file?: string;
  at: number;
}

/** Records what the bot sends Discord, and when on the fake clock. */
export function fakeDiscord(clock: { ms: number }): DiscordApi & { calls: DiscordCall[] } {
  const calls: DiscordCall[] = [];
  return {
    calls,
    async editOriginal(_token: string, content: string, file: Attachment | null = null) {
      calls.push({ kind: 'edit', content, ...(file ? { file: file.name } : {}), at: clock.ms });
    },
    async privateFollowup(_token: string, content: string) {
      calls.push({ kind: 'private', content, at: clock.ms });
    },
  };
}

/** Memes and avatars served as images. */
export const ARCHIVE_ROUTES = {
  'https://raw.githubusercontent.com/momentmaker/chainlinkmeme/c0ffee/memes/': () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])),
  'https://cdn.discordapp.com/': () => new Response(PNG_BYTES),
};

export interface FakeBot extends Bot {
  discord: ReturnType<typeof fakeDiscord>;
  renderer: ReturnType<typeof fakeRenderer>;
  fetch: ReturnType<typeof fakeFetch>;
  alerts: { signature: string; text: string }[];
  clock: { ms: number };
}

/** A bot on the test D1 and R2, with fakes around them; sleeping advances the fake clock. */
export function fakeBot(overrides: Partial<Bot> = {}): FakeBot {
  const clock = { ms: Date.parse('2026-10-13T10:40:00.000Z') };
  const alerts: { signature: string; text: string }[] = [];
  const timers: { at: number; resolve: (value: null) => void }[] = [];
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: fakeRenderer(),
    discord: fakeDiscord(clock),
    fetch: fakeFetch(ARCHIVE_ROUTES),
    alert: async (signature, text) => {
      alerts.push({ signature, text });
    },
    sleep: async (ms) => {
      clock.ms += ms;
      for (const timer of timers.filter((t) => t.at <= clock.ms)) timer.resolve(null);
    },
    deadline: (ms) =>
      new Promise<null>((resolve) => {
        if (ms <= 0) resolve(null);
        else timers.push({ at: clock.ms + ms, resolve });
      }),
    now: () => new Date(clock.ms),
    random: seededRandom(42),
    snapshot: SNAPSHOT,
    alerts,
    clock,
    ...overrides,
  } as FakeBot;
}
