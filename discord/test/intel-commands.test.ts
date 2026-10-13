import type { PublicFileName } from '@ccip-dev/core/public';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { DataError, type PublicData } from '../src/data';
import { botHandlers } from '../src/index';
import { INTEL_TEXT, INTEL_TTL_MS, intelCommand, intelKey } from '../src/intel-commands';
import { TEXT } from '../src/marines';
import { command, fakeBot, fakeRenderer, resetStorage } from './helpers';
import { BASE, CHAINS, PLASMA, HISTORY, REPLAY, RESERVE, SOURCES, TODAY } from './fixtures/intel';

const FILES: Partial<Record<PublicFileName, unknown>> = {
  'today.json': TODAY, 'history.json': HISTORY, 'chains.json': CHAINS, 'replay.json': REPLAY, 'top/src_chain.json': SOURCES, 'reserve.json': RESERVE,
};

/** The public files from fixtures; `down` names one that fails. */
function data(down: PublicFileName | null = null): PublicData & { loaded: string[] } {
  const loaded: string[] = [];
  return {
    loaded,
    load: async (name) => {
      loaded.push(name);
      if (name === down) throw new DataError(name, 'HTTP 503');
      return FILES[name] as never;
    },
  };
}

/** A bot whose clock runs with R2's, which stamps objects with the real time. */
function intelBot(overrides: Parameters<typeof fakeBot>[0] = {}) {
  const offset = { ms: 0 };
  const bot = fakeBot({ data: data(), now: () => new Date(Date.now() + offset.ms), ...overrides });
  return Object.assign(bot, { offset });
}

beforeEach(resetStorage);

describe('the intel commands', () => {
  it('draws /cciptoday from the public files, posts it and keeps it in R2', async () => {
    // #given
    const bot = intelBot();
    // #when
    await intelCommand(bot, command('cciptoday'), 'sitrep');
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content, c.file]), rendered: bot.renderer.calls, kept: (await env.MARINES.head('intel/sitrep.png'))?.httpMetadata?.contentType }).toEqual({
      calls: [['edit', '', 'sitrep.png']],
      rendered: ['renderIntelCard'],
      kept: 'image/png',
    });
  });

  it("posts R2's copy for 5 minutes without reading a file, then draws it afresh", async () => {
    // #given
    const files = data();
    const bot = intelBot({ data: files });
    await intelCommand(bot, command('linkreserve'), 'vault');
    files.loaded.length = 0;
    // #when
    await intelCommand(bot, command('linkreserve'), 'vault');
    const cached = { loaded: [...files.loaded], rendered: bot.renderer.calls.length };
    bot.offset.ms = INTEL_TTL_MS + 1000;
    await intelCommand(bot, command('linkreserve'), 'vault');
    // #then
    expect({ cached, afresh: bot.renderer.calls.length, posts: bot.discord.calls.length }).toEqual({ cached: { loaded: [], rendered: 1 }, afresh: 2, posts: 3 });
  });

  it('finds /ccipchain however it is typed, and keeps each typing apart', async () => {
    // #given
    const renderer = fakeRenderer();
    const seen: unknown[] = [];
    renderer.renderIntelCard = async (kind, card) => {
      seen.push([kind, (card as { chain: { name: string } }).chain.name]);
      return new Uint8Array([137, 80, 78, 71]);
    };
    const bot = intelBot({ renderer });
    // #when
    await intelCommand(bot, command('ccipchain', [{ name: 'chain', type: 3, value: BASE }]), 'dossier');
    await intelCommand(bot, command('ccipchain', [{ name: 'chain', type: 3, value: 'Base Mainnet' }]), 'dossier');
    // #then
    expect({ seen, keys: [intelKey('dossier', BASE), intelKey('dossier', 'Base Mainnet')] }).toEqual({ seen: [['dossier', 'Base'], ['dossier', 'Base']], keys: [`intel/dossier/${BASE}.png`, 'intel/dossier/base%20mainnet.png'] });
  });

  it('answers privately when there is no such chain, drawing nothing and alerting no one', async () => {
    // #given
    const bot = intelBot();
    // #when
    await intelCommand(bot, command('ccipchain', [{ name: 'chain', type: 3, value: 'Solana' }]), 'dossier');
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content]), rendered: bot.renderer.calls, alerts: bot.alerts }).toEqual({ calls: [['private', INTEL_TEXT.unknownChain('Solana')]], rendered: [], alerts: [] });
  });

  it('says privately that a chain on CCIP has no traffic yet, rather than that there is no such chain', async () => {
    // #given Plasma, in chains.json but in no lane of replay.json
    const bot = intelBot();
    // #when
    await intelCommand(bot, command('ccipchain', [{ name: 'chain', type: 3, value: 'plasma' }]), 'dossier');
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content]), rendered: bot.renderer.calls, alerts: bot.alerts }).toEqual({ calls: [['private', 'Plasma has no CCIP traffic yet.']], rendered: [], alerts: [] });
  });

  it('echoes an unknown chain as plain text, cut to 64 characters', async () => {
    // #given
    const bot = intelBot();
    const long = 'x'.repeat(70);
    // #when
    await intelCommand(bot, command('ccipchain', [{ name: 'chain', type: 3, value: '[Solana](https://evil.example)' }]), 'dossier');
    // #then
    expect({ echoed: bot.discord.calls.map((c) => c.content), long: INTEL_TEXT.unknownChain(long) }).toEqual({
      echoed: ["No chain called '\\[Solana\\]\\(https://evil.example\\)' on CCIP."],
      long: `No chain called '${'x'.repeat(63)}…' on CCIP.`,
    });
  });

  it('answers privately that intel is unavailable when a file fails, and alerts discord-data:<file>', async () => {
    // #given
    const bot = intelBot({ data: data('history.json') });
    // #when
    await intelCommand(bot, command('cciprecords'), 'records');
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content]), alerts: bot.alerts.map((a) => a.signature) }).toEqual({ calls: [['private', INTEL_TEXT.noData]], alerts: ['discord-data:history.json'] });
  });

  it('answers privately and alerts discord-render:<kind> when the card fails, keeping nothing', async () => {
    // #given
    const bot = intelBot({ renderer: fakeRenderer('renderIntelCard') });
    // #when
    await intelCommand(bot, command('cciptoday'), 'sitrep');
    // #then
    expect({ calls: bot.discord.calls.map((c) => [c.kind, c.content]), alerts: bot.alerts.map((a) => a.signature), kept: await env.MARINES.head('intel/sitrep.png') }).toEqual({
      calls: [['private', TEXT.internal]],
      alerts: ['discord-render:sitrep'],
      kept: null,
    });
  });

  it('suggests chains for /ccipchain from chains.json', async () => {
    // #given
    const handlers = botHandlers(intelBot());
    // #when
    const choices = await handlers.autocomplete({ ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }]), type: 4 });
    // #then
    expect(choices).toEqual([{ name: 'Base', value: BASE }]);
  });

  it("calls off the autocomplete's 2 s timer once chains.json is back", async () => {
    // #given
    const signals: (AbortSignal | undefined)[] = [];
    const deadline = (_ms: number, signal?: AbortSignal) => {
      signals.push(signal);
      return new Promise<null>(() => {});
    };
    const handlers = botHandlers(intelBot({ deadline }));
    // #when
    const choices = await handlers.autocomplete({ ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }]), type: 4 });
    // #then
    expect({ choices: choices.length, calledOff: signals.map((s) => s?.aborted) }).toEqual({ choices: 1, calledOff: [true] });
  });

  it('answers /ccipchain autocomplete with no choices when chains.json is not back in time', async () => {
    // #given a chains.json that never arrives, and a timer that fires at once
    const hung: PublicData = { load: () => new Promise(() => {}) };
    const handlers = botHandlers(intelBot({ data: hung, deadline: async () => null }));
    // #when
    const choices = await handlers.autocomplete({ ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }]), type: 4 });
    // #then
    expect(choices).toEqual([]);
  });

  describe('autocomplete ranking', () => {
    const typed = (value: string) => ({ ...command('ccipchain', [{ name: 'chain', type: 3, value, focused: true }]), type: 4 });
    const withTop = (top: () => Promise<unknown>): PublicData => ({ load: async (name) => (name === 'top/src_chain.json' ? top() : FILES[name]) as never });
    const busy = { ...SOURCES, windows: { ...SOURCES.windows, '7d': [{ key: PLASMA, messages: 1, usd: 9 }] } };

    it('lists the busiest chain first when top/src_chain.json arrives', async () => {
      // #given
      const handlers = botHandlers(intelBot({ data: withTop(async () => busy) }));
      // #when
      const choices = await handlers.autocomplete(typed(''));
      // #then
      expect(choices[0]?.value).toBe(PLASMA);
    });

    it('falls back to alphabetical when top/src_chain.json fails', async () => {
      // #given
      const handlers = botHandlers(intelBot({ data: withTop(() => Promise.reject(new DataError('top/src_chain.json', 'HTTP 503'))) }));
      // #when
      const choices = await handlers.autocomplete(typed(''));
      // #then
      expect(choices[0]?.name).toBe('Arbitrum');
    });

    it('falls back to alphabetical, still within the budget, when top/src_chain.json is slow', async () => {
      // #given a top file that never arrives, and a timer that fires after chains.json is in
      const handlers = botHandlers(intelBot({ data: withTop(() => new Promise(() => {})), deadline: () => new Promise<null>((r) => setTimeout(() => r(null), 5)) }));
      // #when
      const choices = await handlers.autocomplete(typed(''));
      // #then
      expect(choices[0]?.name).toBe('Arbitrum');
    });
  });

  it('sends the alert after the private reply, and still sends it when the reply fails', async () => {
    // #given
    const order: string[] = [];
    const bot = intelBot({ data: data('history.json') });
    bot.discord.privateFollowup = async () => {
      order.push('reply');
      throw new Error('discord is down');
    };
    bot.alert = async (signature) => void order.push(signature);
    // #when
    await intelCommand(bot, command('cciprecords'), 'records').catch(() => undefined);
    // #then
    expect(order).toEqual(['reply', 'discord-data:history.json']);
  });

  it('still posts the card when R2 will not keep it', async () => {
    // #given
    const bucket = { get: async () => null, put: async () => Promise.reject(new Error('R2 is down')) } as unknown as R2Bucket;
    const bot = intelBot({ bucket });
    // #when
    await intelCommand(bot, command('cciptoday'), 'sitrep');
    // #then
    expect(bot.discord.calls.map((c) => [c.kind, c.file])).toEqual([['edit', 'sitrep.png']]);
  });
});
