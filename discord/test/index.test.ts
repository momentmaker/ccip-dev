import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { handleInteraction, ONLY_HERE, type Handlers } from '../src/index';
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

  it('defers a command and runs its work after the reply', async () => {
    // #given
    const h = handlers();
    const work: Promise<unknown>[] = [];
    // #when
    const res = await handleInteraction(command('cciptoday'), GUILD, h, (p) => void work.push(p));
    await Promise.all(work);
    // #then
    expect({ reply: await res.json(), ran: h.ran }).toEqual({ reply: { type: 5 }, ran: ['cciptoday'] });
  });

  it('turns away a command from another server or a DM privately, and gives their autocomplete nothing', async () => {
    // #given
    const h = handlers();
    const elsewhere = command('cciptoday', [], { guild_id: '999' });
    const dm = { ...command('cciptoday'), guild_id: undefined };
    const complete = { ...command('ccipchain', [{ name: 'chain', type: 3, value: 'ba', focused: true }], { guild_id: '999' }), type: 4 };
    // #when
    const replies = await Promise.all([elsewhere, dm, complete].map(async (i) => (await handleInteraction(i, GUILD, h, () => {})).json()));
    // #then
    expect({ replies, ran: h.ran }).toEqual({
      replies: [
        { type: 4, data: { content: ONLY_HERE, flags: 64, allowed_mentions: { parse: [] } } },
        { type: 4, data: { content: ONLY_HERE, flags: 64, allowed_mentions: { parse: [] } } },
        { type: 8, data: { choices: [] } },
      ],
      ran: [],
    });
  });

  it('turns everything away while DISCORD_GUILD_ID is empty', async () => {
    // #when
    const res = await handleInteraction(command('cciptoday', [], { guild_id: '' }), '', handlers(), () => {});
    // #then
    expect(await res.json()).toEqual({ type: 4, data: { content: ONLY_HERE, flags: 64, allowed_mentions: { parse: [] } } });
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
