import { hexToBytes } from '@noble/hashes/utils.js';

/** One view call: the contract and its calldata. */
export interface EvmCall {
  to: string;
  data: string;
}

/** The longest array, byte string (bytes) and text (string, in UTF-8 bytes) a decoder accepts; anything longer is no answer. */
export const ABI_CAPS = { array: 1000, bytes: 128, text: 128 } as const;

/** Multicall3's canonical deployment (https://github.com/mds1/multicall), trusted on a chain only once probed there. */
export const MULTICALL3 = {
  address: '0xca11bde05977b3631167028862be2a173976ca11',
  aggregate3: '0x82ad56cb',
  getChainId: '0x3408e470',
} as const;

export type StaticType = 'address' | 'bool' | `uint${number}` | `int${number}`;
export type StaticValue<T extends StaticType> = T extends 'address' ? string : T extends 'bool' ? boolean : bigint;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})*$/;
const WORD_LIMIT = 2n ** 256n;

export function uintWord(n: bigint): string {
  if (n < 0n || n >= WORD_LIMIT) throw new Error(`${n} does not fit an unsigned 256-bit word`);
  return n.toString(16).padStart(64, '0');
}

export function addressWord(address: string): string {
  if (!ADDRESS.test(address)) throw new Error(`${address} is not an address`);
  return address.slice(2).toLowerCase().padStart(64, '0');
}

export const boolWord = (value: boolean): string => uintWord(value ? 1n : 0n);

/** Calldata for a call whose arguments are all static: the selector, then one word per argument. */
export function encodeCall(selector: string, ...words: string[]): string {
  return `${selector}${words.join('')}`;
}

/** aggregate3((address target, bool allowFailure, bytes callData)[]) with allowFailure on for every call. */
export function encodeAggregate3(calls: readonly EvmCall[]): string {
  const heads: string[] = [];
  const tails: string[] = [];
  let offset = 32 * calls.length;
  for (const call of calls) {
    const data = call.data.slice(2).toLowerCase();
    const padded = data.padEnd(Math.ceil(data.length / 64) * 64, '0');
    const tail = `${addressWord(call.to)}${boolWord(true)}${uintWord(0x60n)}${uintWord(BigInt(data.length / 2))}${padded}`;
    heads.push(uintWord(BigInt(offset)));
    tails.push(tail);
    offset += tail.length / 2;
  }
  return encodeCall(MULTICALL3.aggregate3, uintWord(0x20n), uintWord(BigInt(calls.length)), ...heads, ...tails);
}

class Malformed extends Error {}

/** Positions are in bytes into the answer's hex (no 0x prefix, two characters a byte). */
function wordAt(hex: string, at: number): bigint {
  if (at + 32 > hex.length / 2) throw new Malformed();
  return BigInt(`0x${hex.slice(at * 2, at * 2 + 64)}`);
}

function offsetAt(hex: string, at: number, base: number): number {
  const target = BigInt(base) + wordAt(hex, at);
  if (target > BigInt(hex.length / 2)) throw new Malformed();
  return Number(target);
}

function lengthAt(hex: string, at: number, cap: number): number {
  const length = wordAt(hex, at);
  if (length > BigInt(cap)) throw new Malformed();
  return Number(length);
}

function bytesAt(hex: string, at: number, cap: number): string {
  const length = lengthAt(hex, at, cap);
  const start = at + 32;
  if (start + length > hex.length / 2) throw new Malformed();
  return `0x${hex.slice(start * 2, (start + length) * 2)}`;
}

function staticAt<T extends StaticType>(hex: string, at: number, type: T): StaticValue<T> {
  const word = wordAt(hex, at);
  if (type === 'address') {
    if (word >> 160n !== 0n) throw new Malformed();
    return `0x${word.toString(16).padStart(40, '0')}` as StaticValue<T>;
  }
  if (type === 'bool') {
    if (word > 1n) throw new Malformed();
    return (word === 1n) as StaticValue<T>;
  }
  const signed = type.startsWith('int');
  const bits = Number(type.slice(signed ? 3 : 4));
  if (!signed) {
    if (word >> BigInt(bits) !== 0n) throw new Malformed();
    return word as StaticValue<T>;
  }
  const value = BigInt.asIntN(256, word);
  if (BigInt.asIntN(bits, value) !== value) throw new Malformed();
  return value as StaticValue<T>;
}

/** Elements of a dynamic array: the answer's first word points at its length, and the elements follow it. */
function arrayAt<T>(hex: string, cap: number, element: (hex: string, at: number, content: number) => T): T[] {
  const start = offsetAt(hex, 0, 0);
  const length = lengthAt(hex, start, cap);
  const content = start + 32;
  return Array.from({ length }, (_, i) => element(hex, content + 32 * i, content));
}

/**
 * Every public decoder answers null for anything malformed: not hex, too short, an offset or length outside the answer, a
 * length over its cap, an address word with high bytes set, a boolean other than 0 or 1, an integer wider than its type,
 * or text that is not UTF-8.
 */
function decoded<T>(value: unknown, read: (hex: string) => T): T | null {
  if (typeof value !== 'string' || !HEX_DATA.test(value)) return null;
  try {
    return read(value.slice(2).toLowerCase());
  } catch (err) {
    if (err instanceof Malformed) return null;
    throw err;
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function utf8(bytes: string): string {
  try {
    return UTF8.decode(hexToBytes(bytes.slice(2)));
  } catch {
    throw new Malformed();
  }
}

export function decodeValue<T extends StaticType>(value: unknown, type: T): StaticValue<T> | null {
  return decoded(value, (hex) => staticAt(hex, 0, type));
}

export function decodeTuple<const T extends readonly StaticType[]>(value: unknown, types: T): { -readonly [K in keyof T]: StaticValue<T[K]> } | null {
  return decoded(value, (hex) => types.map((type, i) => staticAt(hex, 32 * i, type)) as { -readonly [K in keyof T]: StaticValue<T[K]> });
}

export function decodeArray<T extends StaticType>(value: unknown, type: T): StaticValue<T>[] | null {
  return decoded(value, (hex) => arrayAt(hex, ABI_CAPS.array, (h, at) => staticAt(h, at, type)));
}

export function decodeBytes(value: unknown): string | null {
  return decoded(value, (hex) => bytesAt(hex, offsetAt(hex, 0, 0), ABI_CAPS.bytes));
}

export function decodeBytesArray(value: unknown): string[] | null {
  return decoded(value, (hex) => arrayAt(hex, ABI_CAPS.array, (h, at, content) => bytesAt(h, offsetAt(h, at, content), ABI_CAPS.bytes)));
}

export function decodeString(value: unknown): string | null {
  return decoded(value, (hex) => utf8(bytesAt(hex, offsetAt(hex, 0, 0), ABI_CAPS.text)));
}

export interface Aggregate3Result {
  success: boolean;
  data: string;
}

/** aggregate3's ((bool success, bytes returnData)[]): each call's answer, or its revert data when success is false. */
export function decodeAggregate3(value: unknown): Aggregate3Result[] | null {
  return decoded(value, (hex) =>
    arrayAt(hex, ABI_CAPS.array, (h, at, content) => {
      const tuple = offsetAt(h, at, content);
      return { success: staticAt(h, tuple, 'bool'), data: bytesAt(h, offsetAt(h, tuple + 32, tuple), h.length / 2) };
    }),
  );
}
