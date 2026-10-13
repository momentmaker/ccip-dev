import { describe, expect, it } from 'vitest';
import { verifyDiscordRequest } from '../src/verify';

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('signature check', () => {
  it('accepts what the key signed and nothing else', async () => {
    // #given
    const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = toHex((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    const sign = async (text: string) => toHex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(text)));
    const body = '{"type":1}';
    const signature = await sign(`1700000000${body}`);
    // #when
    const checks = await Promise.all([
      verifyDiscordRequest(publicKey, signature, '1700000000', body),
      verifyDiscordRequest(publicKey, signature, '1700000001', body),
      verifyDiscordRequest(publicKey, signature, '1700000000', '{"type":2}'),
      verifyDiscordRequest(publicKey, null, '1700000000', body),
      verifyDiscordRequest(publicKey, signature, null, body),
      verifyDiscordRequest(publicKey, 'zz', '1700000000', body),
      verifyDiscordRequest('00', signature, '1700000000', body),
    ]);
    // #then
    expect(checks).toEqual([true, false, false, false, false, false, false]);
  });
});
