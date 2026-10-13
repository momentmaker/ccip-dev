import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { handleInteraction, type Handlers } from '../src/index';
import { command, GUILD } from './helpers';

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function signedRequest(body: string, sign = true): Promise<{ request: Request; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const timestamp = '1791892245';
  const signature = toHex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(timestamp + body)));
  const headers: Record<string, string> = sign ? { 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': timestamp } : {};
  return { request: new Request('https://discord.ccip.dev/interactions', { method: 'POST', body, headers }), publicKey: toHex((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
/** The Worker's fetch, with a plain Request where Cloudflare would pass its own. */
const handle = (request: Request, environment: typeof env) => worker.fetch(request as Parameters<typeof worker.fetch>[0], environment, ctx);

function handlers(): Handlers & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    commands: { cciptoday: async (i) => void ran.push(i.data!.name) },
    autocomplete: async () => [{ name: 'Base', value: '15971525489660198786' }],
  };
}

describe('the interactions endpoint', () => {
  it('answers a signed PING with PONG, and an unsigned or forged request with 401', async () => {
    // #given
    const ping = await signedRequest('{"type":1}');
    const unsigned = await signedRequest('{"type":1}', false);
    const forged = await signedRequest('{"type":1}');
    // #when
    const answers = await Promise.all([
      handle(ping.request, { ...env, DISCORD_PUBLIC_KEY: ping.publicKey }),
      handle(unsigned.request, { ...env, DISCORD_PUBLIC_KEY: unsigned.publicKey }),
      handle(forged.request, { ...env, DISCORD_PUBLIC_KEY: ping.publicKey }),
    ]);
    // #then
    expect([await answers[0]!.json(), answers[1]!.status, answers[2]!.status]).toEqual([{ type: 1 }, 401, 401]);
  });

  it('answers anything but a POST to /interactions with 404', async () => {
    // #when
    const answers = await Promise.all([handle(new Request('https://discord.ccip.dev/interactions'), env), handle(new Request('https://discord.ccip.dev/', { method: 'POST' }), env)]);
    // #then
    expect(answers.map((r) => r.status)).toEqual([404, 404]);
  });

  it('defers a command at once and hands its work to waitUntil, never waiting on it', async () => {
    // #given a command whose work never ends
    const work: Promise<unknown>[] = [];
    const endless: Handlers = { commands: { cciptoday: () => new Promise<void>(() => {}) }, autocomplete: async () => [] };
    // #when
    const res = await handleInteraction(command('cciptoday'), 'all', endless, (p) => void work.push(p));
    // #then
    expect({ reply: await res.json(), handedOver: work.length }).toEqual({ reply: { type: 5 }, handedOver: 1 });
  });

  it('answers 400 to a signed body that is not a JSON object, an empty one included', async () => {
    // #given
    const signed = await Promise.all(['{"type":', '', 'null'].map((body) => signedRequest(body)));
    // #when
    const answers = await Promise.all(signed.map((r) => handle(r.request, { ...env, DISCORD_PUBLIC_KEY: r.publicKey })));
    // #then
    expect(answers.map((r) => r.status)).toEqual([400, 400, 400]);
  });

  it('refuses a body over 64 KB with 413, however well it is signed, by its length or by what it sends', async () => {
    // #given a signed PING padded past 64 KB, and a small one that declares a huge length
    const big = await signedRequest(JSON.stringify({ type: 1, pad: 'x'.repeat(70_000) }));
    const small = await signedRequest('{"type":1}');
    const declared = new Request(small.request, { headers: { ...Object.fromEntries(small.request.headers), 'content-length': '999999' } });
    // #when
    const answers = await Promise.all([handle(big.request, { ...env, DISCORD_PUBLIC_KEY: big.publicKey }), handle(declared, { ...env, DISCORD_PUBLIC_KEY: small.publicKey })]);
    // #then
    expect(answers.map((r) => r.status)).toEqual([413, 413]);
  });

  it('refuses every request with 401 while DISCORD_PUBLIC_KEY is unset', async () => {
    // #given
    const ping = await signedRequest('{"type":1}');
    // #when
    const res = await handle(ping.request, { ...env, DISCORD_PUBLIC_KEY: undefined });
    // #then
    expect(res.status).toBe(401);
  });

  const TURNED_AWAY = { type: 4, data: { content: 'ccip.dev works in servers that have added it.', flags: 64, allowed_mentions: { parse: [] } } };
  const OTHER_SERVER = '1100000000000000002';

  it('lets any server through when the setting is "all"', async () => {
    // #given
    const h = handlers();
    // #when
    const replies = await Promise.all([GUILD, OTHER_SERVER].map(async (guild_id) => (await handleInteraction(command('cciptoday', [], { guild_id }), 'all', h, (p) => void p)).json()));
    // #then
    expect({ replies, ran: h.ran }).toEqual({ replies: [{ type: 5 }, { type: 5 }], ran: ['cciptoday', 'cciptoday'] });
  });

  it('lets a listed server through and turns an unlisted one away, whatever the list spacing', async () => {
    // #given
    const h = handlers();
    const setting = ` ${GUILD} ,, 1100000000000000009 `;
    // #when
    const listed = await handleInteraction(command('cciptoday'), setting, h, () => {});
    const unlisted = await handleInteraction(command('cciptoday', [], { guild_id: OTHER_SERVER }), setting, h, () => {});
    // #then
    expect({ listed: await listed.json(), unlisted: await unlisted.json(), ran: h.ran }).toEqual({ listed: { type: 5 }, unlisted: TURNED_AWAY, ran: ['cciptoday'] });
  });

  it('gives autocomplete from an unlisted server no choices, and a listed one its choices', async () => {
    // #given
    const complete = (guild_id: string) => ({ ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }], { guild_id }), type: 4 });
    // #when
    const replies = await Promise.all([OTHER_SERVER, GUILD].map(async (id) => (await handleInteraction(complete(id), GUILD, handlers(), () => {})).json()));
    // #then
    expect(replies).toEqual([{ type: 8, data: { choices: [] } }, { type: 8, data: { choices: [{ name: 'Base', value: '15971525489660198786' }] } }]);
  });

  it.each([['empty', ''], ['blank', ' , '], ['missing', undefined]])('turns everything away while the setting is %s', async (_label, setting) => {
    // #given
    const h = handlers();
    const complete = { ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }]), type: 4 };
    // #when
    const replies = await Promise.all([command('cciptoday'), complete].map(async (i) => (await handleInteraction(i, setting, h, () => {})).json()));
    // #then
    expect({ replies, ran: h.ran }).toEqual({ replies: [TURNED_AWAY, { type: 8, data: { choices: [] } }], ran: [] });
  });

  it('turns a DM away even when the setting is "all"', async () => {
    // #given
    const h = handlers();
    const dms = [{ ...command('cciptoday'), guild_id: undefined }, command('cciptoday', [], { guild_id: '' })];
    // #when
    const replies = await Promise.all(dms.map(async (i) => (await handleInteraction(i, 'all', h, () => {})).json()));
    // #then
    expect({ replies, ran: h.ran }).toEqual({ replies: [TURNED_AWAY, TURNED_AWAY], ran: [] });
  });

  it.each([[1], [2]])('turns away an interaction in context %i even when the setting is "all"', async (context) => {
    // #given
    const h = handlers();
    // #when
    const res = await handleInteraction(command('cciptoday', [], { context }), 'all', h, () => {});
    // #then
    expect({ reply: await res.json(), ran: h.ran }).toEqual({ reply: TURNED_AWAY, ran: [] });
  });

  it('lets a guild-context interaction through', async () => {
    // #when
    const res = await handleInteraction(command('cciptoday', [], { context: 0 }), 'all', handlers(), () => {});
    // #then
    expect(await res.json()).toEqual({ type: 5 });
  });

  it('answers PING with PONG whatever the setting', async () => {
    // #when
    const replies = await Promise.all([undefined, '', 'all'].map(async (s) => (await handleInteraction({ ...command('x'), type: 1, guild_id: undefined }, s, handlers(), () => {})).json()));
    // #then
    expect(replies).toEqual([{ type: 1 }, { type: 1 }, { type: 1 }]);
  });

  it('answers an unknown command privately at once', async () => {
    // #when
    const res = await handleInteraction(command('nuke'), GUILD, handlers(), () => {});
    // #then
    expect(await res.json()).toEqual({ type: 4, data: { content: 'Unknown command /nuke.', flags: 64, allowed_mentions: { parse: [] } } });
  });

  it("answers autocomplete within the request, with type 8, and with nothing when the choices can't be read", async () => {
    // #given
    const complete = { ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }]), type: 4 };
    const broken = { ...handlers(), autocomplete: async () => Promise.reject(new Error('chains.json: HTTP 503')) };
    // #when
    const replies = await Promise.all([handleInteraction(complete, GUILD, handlers(), () => {}), handleInteraction(complete, GUILD, broken, () => {})]);
    // #then
    expect(await Promise.all(replies.map((r) => r.json()))).toEqual([{ type: 8, data: { choices: [{ name: 'Base', value: '15971525489660198786' }] } }, { type: 8, data: { choices: [] } }]);
  });
});
