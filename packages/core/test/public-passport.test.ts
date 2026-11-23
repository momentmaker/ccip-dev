import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { PASSPORT_SCHEMAS, PassportShardFileSchema, passportShard, type PassportFileName } from '../src/public-passport';
import { PUBLIC_SCHEMAS } from '../src/public';
import passportEvents from './fixtures/public/passport-events.json';
import passportIndex from './fixtures/public/passport.json';
import passportShard0 from './fixtures/public/passport-0.json';

const CAPTURED_PASSPORT: [PassportFileName, unknown][] = [
  ['passport.json', passportIndex],
  ['passport/0.json', passportShard0],
  ['passport-events.json', passportEvents],
];

describe('Token Passport files', () => {
  const HEX = '0123456789abcdef';

  it('lists the index, the events file and sixteen shards among the passport files', () => {
    // #when
    const names = Object.keys(PASSPORT_SCHEMAS);
    // #then
    expect(names.sort()).toEqual(['passport-events.json', 'passport.json', ...[...HEX].map((h) => `passport/${h}.json`)].sort());
  });

  it('keeps the passport files out of the public files the browser fetches', () => {
    expect(Object.keys(PUBLIC_SCHEMAS).filter((n) => n.startsWith('passport'))).toEqual([]);
  });

  it.each([
    ['1e5901c9-23ca-5cde-b023-63d82251fe7f', 'passport/1.json'],
    ['C8026BC1-8379-5D46-BFDD-DCCD50A2C169', 'passport/c.json'],
  ])('puts the registry group %s in the shard of its first hex digit', (id, shard) => {
    expect(passportShard(id)).toBe(shard);
  });

  it('puts a page id that is not a registry group id in the shard of the first hex digit of its SHA-256', () => {
    // #given the page id of a row with no group: its chain selector and address
    const id = '5009297550715157269:0x4c1dab3be86347977f3dfc4b9688224ef2272939';
    // #when
    const shard = passportShard(id);
    // #then
    expect(shard).toBe(`passport/${bytesToHex(sha256(utf8ToBytes(id)))[0]}.json`);
  });

  it.each(CAPTURED_PASSPORT)('parse the %s fixture', (name, body) => {
    expect(PASSPORT_SCHEMAS[name].safeParse(body).error?.issues ?? []).toEqual([]);
  });

  it('reject a result whose reason is not a published reason code', () => {
    // #given
    const token = (passportShard0.tokens as Record<string, any>[])[0]!;
    const row = { ...token.rows[0], single_key: { ...token.rows[0].single_key, reason: 'looks fine' } };
    const doc = { ...passportShard0, tokens: [{ ...token, rows: [row] }] };
    // #then
    expect(PassportShardFileSchema.safeParse(doc).success).toBe(false);
  });
});
