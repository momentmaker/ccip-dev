import { describe, expect, it, onTestFinished, vi } from 'vitest';
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

  it('refuses odd-length hex, a 63-byte signature and a key short of 32 bytes, and checks an empty body like any other', async () => {
    // #given
    const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
    const publicKey = toHex((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
    const sign = async (text: string) => toHex(await crypto.subtle.sign('Ed25519', pair.privateKey, new TextEncoder().encode(text)));
    const empty = await sign('1700000000');
    // #when
    const checks = await Promise.all([
      verifyDiscordRequest(publicKey, empty.slice(0, -1), '1700000000', ''),
      verifyDiscordRequest(publicKey, empty.slice(0, -2), '1700000000', ''),
      verifyDiscordRequest(publicKey.slice(0, -2), empty, '1700000000', ''),
      verifyDiscordRequest(publicKey, empty, '1700000000', ''),
      verifyDiscordRequest(publicKey, empty, '1700000000', '{}'),
    ]);
    // #then
    expect(checks).toEqual([false, false, false, true, false]);
  });

  it('says once per isolate, and without the key, that a malformed DISCORD_PUBLIC_KEY refuses every request', async () => {
    // #given the module fresh, as a new isolate loads it
    vi.resetModules();
    const fresh = (await import('../src/verify')).verifyDiscordRequest;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const signature = 'ab'.repeat(64);
    // #when
    const checks = [await fresh('c0ffee', signature, '1', '{}'), await fresh('c0ffee', signature, '1', '{}'), await fresh('', signature, '1', '{}')];
    // #then
    expect({ checks, warned: warn.mock.calls.map((c) => String(c[0])) }).toEqual({
      checks: [false, false, false],
      warned: ['DISCORD_PUBLIC_KEY is unset or not 64 hex characters: every interaction is refused with 401'],
    });
  });
});
