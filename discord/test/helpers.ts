import { seededRandom, type LinkMarineRenderer, type MarineWebCard } from '@ccip-dev/core/linkmarine';
import { env } from 'cloudflare:workers';
import type { Bot } from '../src/bot';
import type { Attachment, DiscordApi } from '../src/discord-api';
import { simulate, type CallsignSnapshot } from '../src/draw';
import type { CommandOption, Interaction } from '../src/interactions';
import type { PublicDeps } from '../src/public';
import { enlist, type MarineMeme } from '../src/store';
import type { TelegramApi, TelegramResult } from '../src/telegram-api';
import type { TelegramBot, TelegramSettings } from '../src/telegram-marines';

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

/**
 * The site's renderer as the bot calls it, counting calls; `failing` names a method that throws. renderMarineCards draws
 * both images as the site does: it fails with renderMarineCard, and gives a failing renderMarineGlint back as the reason.
 */
export function fakeRenderer(failing: keyof LinkMarineRenderer | null = null): LinkMarineRenderer & { calls: string[]; webCards: MarineWebCard[]; stickers: MarineWebCard[]; stories: MarineWebCard[] } {
  const calls: string[] = [];
  const webCards: MarineWebCard[] = [];
  const stickers: MarineWebCard[] = [];
  const stories: MarineWebCard[] = [];
  const call = <T>(name: keyof LinkMarineRenderer, value: T) => {
    calls.push(name);
    if (failing === name) throw new Error(`${name} failed`);
    return value;
  };
  const glints = (tier: string) => tier === 'rare' || tier === 'legendary';
  return {
    calls,
    webCards,
    stickers,
    stories,
    async prepareMeme() {
      return call('prepareMeme', PNG_BYTES);
    },
    async renderMarineCard() {
      return call('renderMarineCard', PNG_BYTES);
    },
    async renderMarineGlint(card) {
      return call('renderMarineGlint', glints(card.tier) ? GIF_BYTES : null);
    },
    async renderMarineCards(card) {
      call('renderMarineCards', null);
      if (failing === 'renderMarineCard') throw new Error('renderMarineCard failed');
      if (!glints(card.tier)) return { png: PNG_BYTES, gif: null, glintError: null };
      return failing === 'renderMarineGlint' ? { png: PNG_BYTES, gif: null, glintError: 'renderMarineGlint failed' } : { png: PNG_BYTES, gif: GIF_BYTES, glintError: null };
    },
    async renderMarineWebCard(card) {
      webCards.push(card);
      return call('renderMarineWebCard', PNG_BYTES);
    },
    async renderMarineSticker(card) {
      stickers.push(card);
      return call('renderMarineSticker', PNG_BYTES);
    },
    async renderMarineStory(card) {
      stories.push(card);
      return call('renderMarineStory', PNG_BYTES);
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
  const timers: { at: number; resolve: (value: null) => void; weak: boolean }[] = [];
  let pumping = false;
  /** Virtual time: while anything sleeps, the clock jumps to the earliest timer once the other work has settled. Deadlines alone never move it. */
  const pump = () => {
    if (pumping) return;
    pumping = true;
    setTimeout(() => {
      pumping = false;
      if (!timers.some((t) => !t.weak)) return;
      clock.ms = Math.max(clock.ms, Math.min(...timers.map((t) => t.at)));
      for (const due of timers.filter((t) => t.at <= clock.ms)) {
        timers.splice(timers.indexOf(due), 1);
        due.resolve(null);
      }
      pump();
    }, 0);
  };
  const timer = (ms: number, weak: boolean) =>
    new Promise<null>((resolve) => {
      if (ms <= 0) return resolve(null);
      timers.push({ at: clock.ms + ms, resolve, weak });
      pump();
    });
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: fakeRenderer(),
    discord: fakeDiscord(clock),
    fetch: fakeFetch(ARCHIVE_ROUTES),
    alert: async (signature, text) => {
      alerts.push({ signature, text });
    },
    sleep: async (ms) => void (await timer(ms, false)),
    deadline: (ms) => timer(ms, true),
    now: () => new Date(clock.ms),
    random: seededRandom(42),
    snapshot: SNAPSHOT,
    telegramOpen: false,
    data: {
      load: async (name) => {
        throw new Error(`no ${name} in this test`);
      },
    },
    alerts,
    clock,
    ...overrides,
  } as FakeBot;
}

/**
 * Enlists a Marine straight into the test D1 with the given callsign. Each meme is the tag's first snapshot file,
 * keyed as the bot keys memes. `extra` overrides the draw's tier, score or percentile, the memes (to leave out counts) or the platform.
 */
export async function seedMarine(
  userId: string,
  displayName: string,
  callsign: string,
  extra: { tier?: 'common' | 'uncommon' | 'rare' | 'legendary'; score?: number; percentile?: number; memes?: MarineMeme[]; platform?: string } = {},
): Promise<void> {
  const tags = callsign.split('-') as [string, string, string];
  const files = tags.map((tag) => SNAPSHOT.tags.find((t) => t.tag === tag)!.memes[0]!);
  const result = await enlist(
    env.DB,
    { platform: extra.platform ?? 'discord', userId, displayName, enlistedAt: '2026-10-13T10:40:00.000Z', snapshotVersion: SNAPSHOT.version },
    () => ({
      draw: { tags, callsign, tagKey: [...tags].sort().join('-'), score: extra.score ?? 15, tier: extra.tier ?? 'common', percentile: extra.percentile ?? 40 },
      memes: extra.memes ?? tags.map((tag, i) => ({ tag, file: files[i]!, key: `memes/${files[i]}.png`, count: SNAPSHOT.tags.find((t) => t.tag === tag)!.count, sha: SNAPSHOT.archive.sha })),
      blood: 'LINK+',
      faith: '4IR',
    }),
  );
  if (result.kind !== 'enlisted') throw new Error(`seedMarine ${callsign}: ${result.kind}`);
}

/** The public routes' dependencies on the test D1 and R2, with the fake renderer and archive, and no edge cache. */
export function publicDeps(overrides: Partial<PublicDeps> = {}): PublicDeps & { renderer: ReturnType<typeof fakeRenderer>; fetch: ReturnType<typeof fakeFetch>; work: Promise<unknown>[] } {
  const work: Promise<unknown>[] = [];
  return {
    db: env.DB,
    bucket: env.MARINES,
    renderer: fakeRenderer(),
    fetch: fakeFetch(ARCHIVE_ROUTES),
    snapshot: SNAPSHOT,
    now: () => new Date('2026-10-13T14:00:00.000Z'),
    cache: null,
    waitUntil: (p) => void work.push(p),
    work,
    ...overrides,
  } as PublicDeps & { renderer: ReturnType<typeof fakeRenderer>; fetch: ReturnType<typeof fakeFetch>; work: Promise<unknown>[] };
}

/** An edge cache in a Map, keyed by URL. With browserTtl it imitates Cloudflare rewriting a hit's Cache-Control to the zone's Browser Cache TTL. */
export function fakeCache(options: { browserTtl?: number } = {}): Pick<Cache, 'match' | 'put'> & { store: Map<string, Response> } {
  const store = new Map<string, Response>();
  const keyOf = (request: RequestInfo | URL) => String(request instanceof Request ? request.url : request);
  return {
    store,
    match: async (request: RequestInfo | URL) => {
      const hit = store.get(keyOf(request))?.clone();
      if (!hit || options.browserTtl === undefined) return hit;
      const headers = new Headers(hit.headers);
      headers.set('Cache-Control', `public, max-age=${options.browserTtl}`);
      return new Response(hit.body, { status: hit.status, headers });
    },
    put: async (request: RequestInfo | URL, response: Response) => void store.set(keyOf(request), response),
  } as Pick<Cache, 'match' | 'put'> & { store: Map<string, Response> };
}

export const BOT_TOKEN = '123456:TEST-bot-token';
/** A Telegram account, as launch data names it. */
export const TG_USER = { id: 777000111, first_name: 'Ada', last_name: 'Lovelace', username: 'ada' };

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Launch data as Telegram signs it, for `user` at `authDate` (Unix seconds). `extra` adds or replaces fields before signing; a null value leaves that field out. */
export async function signedLaunch(user: Record<string, unknown>, authDate: number, token = BOT_TOKEN, extra: Record<string, string | null> = {}): Promise<string> {
  const merged: Record<string, string | null> = { query_id: 'AAHdF6IQAAAAAN0XohDhrOrc', user: JSON.stringify(user), auth_date: String(authDate), ...extra };
  const fields = Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== null));
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const encode = (s: string) => new TextEncoder().encode(s);
  const hmac = async (key: BufferSource, data: string) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encode(data));
  const hash = toHex(await hmac(await hmac(encode('WebAppData'), token), check));
  return new URLSearchParams({ ...fields, hash }).toString();
}

export interface TelegramCall {
  method: string;
  body: Record<string, unknown>;
  /** An upload's file name. */
  file?: string;
}

type Answer = (body: Record<string, unknown>) => TelegramResult<unknown>;

/** The Bot API as the bot calls it: each method answered from `answers` (true when unlisted), every call recorded. `files` are what download serves. */
export function fakeTelegram(answers: Record<string, Answer> = {}, files: Record<string, Uint8Array> = {}): TelegramApi & { calls: TelegramCall[] } {
  const calls: TelegramCall[] = [];
  const answer = (method: string, body: Record<string, unknown>) => (answers[method] ?? (() => ({ ok: true, result: true })))(body) as TelegramResult<never>;
  return {
    calls,
    async call(method, body) {
      calls.push({ method, body });
      return answer(method, body);
    },
    async upload(method, fields, file) {
      calls.push({ method, body: fields, file: file.name });
      return answer(method, fields);
    },
    async download(path) {
      return files[path] ?? null;
    },
  };
}

export const tgOk = (result: unknown): TelegramResult<unknown> => ({ ok: true, result });
export const tgError = (status: number, description: string, retryAfter: number | null = null): TelegramResult<unknown> => ({ ok: false, status, description, retryAfter });

export const OWNER_ID = 42;
export const TG_SETTINGS: TelegramSettings = { open: true, gateChats: ['@ccipdev'], ownerId: OWNER_ID, alertChatId: '', botToken: BOT_TOKEN };

export interface FakeTelegramBot extends FakeBot {
  tg: ReturnType<typeof fakeTelegram>;
  settings: TelegramSettings;
}

/** fakeBot with a fake Bot API and LinkMarines on Telegram switched on. telegramOpen follows settings.open, so the bot's two switches never disagree. */
export function fakeTelegramBot(overrides: Partial<TelegramBot> = {}): FakeTelegramBot {
  return { ...fakeBot(), tg: fakeTelegram(), settings: TG_SETTINGS, telegramOpen: (overrides.settings ?? TG_SETTINGS).open, ...overrides } as FakeTelegramBot;
}
