import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import {
  ABI_CAPS,
  addressWord,
  decodeAggregate3,
  decodeArray,
  decodeBytes,
  decodeBytesArray,
  decodeString,
  decodeTuple,
  decodeValue,
  encodeAggregate3,
  encodeCall,
  MULTICALL3,
  uintWord,
} from '../src/evm-abi';
import recorded from './fixtures/evm/ethereum-link-pool.json';

const selector = (signature: string) => `0x${bytesToHex(keccak_256(utf8ToBytes(signature))).slice(0, 8)}`;
const answer = (name: keyof typeof recorded.calls) => {
  const call = recorded.calls[name] as { result?: string };
  if (call.result === undefined) throw new Error(`${name} has no recorded result`);
  return call.result;
};
const words = (...w: string[]) => `0x${w.join('')}`;
const hexWord = (hex: string) => hex.padStart(64, '0');

const LINK_POOL = '0x1b7492c3bd23a4adb448710e4275ff14a5288932';
const LINK_TOKEN = '0x514910771af9ca656af840dff83e8264ecf986ca';
const LINK_ADMIN = '0x44835bbba9d40deda9b64858095ecfb2693c9449';
const BASE = 15971525489660198786n;
const SOLANA = 124615329519749607n;

describe('selectors', () => {
  it('Multicall3 selectors are the first four bytes of keccak256 of their signatures', () => {
    expect(MULTICALL3.aggregate3).toBe(selector('aggregate3((address,bool,bytes)[])'));
    expect(MULTICALL3.getChainId).toBe(selector('getChainId()'));
  });
});

describe('encodeCall', () => {
  it('encodes getRemotePools(uint64) for Ethereum as the selector and one word', () => {
    expect(encodeCall(selector('getRemotePools(uint64)'), uintWord(5009297550715157269n))).toBe(
      '0xa42a7b8b00000000000000000000000000000000000000000000000045849994fc9c7b15',
    );
  });

  it('gives the calldata mainnet answered for each recorded call', () => {
    expect(encodeCall(selector('getRemotePools(uint64)'), uintWord(BASE))).toBe(recorded.calls['pool.getRemotePools(base)'].data);
    expect(encodeCall(selector('getRemoteToken(uint64)'), uintWord(SOLANA))).toBe(recorded.calls['pool.getRemoteToken(solana)'].data);
    expect(encodeCall(selector('getTokenConfig(address)'), addressWord(LINK_TOKEN))).toBe(recorded.calls['registry.getTokenConfig(link)'].data);
    expect(encodeCall(selector('getAllConfiguredTokens(uint64,uint64)'), uintWord(0n), uintWord(3n))).toBe(recorded.calls['registry.getAllConfiguredTokens(0,3)'].data);
    expect(encodeCall(selector('typeAndVersion()'))).toBe(recorded.calls['pool.typeAndVersion'].data);
  });

  it('rejects a value that does not fit a word and an address that is not one', () => {
    expect(() => uintWord(2n ** 256n)).toThrow();
    expect(() => uintWord(-1n)).toThrow();
    expect(() => addressWord('0x1234')).toThrow();
  });
});

describe('decoding recorded answers', () => {
  it('decodes getSupportedChains() to its selectors as decimal strings in the order returned', () => {
    expect(decodeArray(answer('pool.getSupportedChains'), 'uint64')?.map(String)).toEqual([
      '12505351618335765396', '13204309965629103672', '1346049177634351622', '1562403441176082196', '15971525489660198786', '1673871237479749969',
      '6180753054346818345', '5142893604156789321', '6422105447186081193', '6916147374840168594', '7264351850409363825', '8805746078405598895',
      '124615329519749607', '4741433654826277614', '9335212494177455608', '18164309074156128038', '17673274061779414707', '4426351306075016396',
      '5936861837188149645', '18240105181246962294', '4829375610284793157', '1523760397290643893', '16978377838628290997', '7801139999541420232',
      '6325494908023253251', '4059281736450291836', '6093540873831549674', '7281642695469137430', '2308837218439511688', '6370580034781731079',
      '1224752112135636129', '4215185756725900654', '8481857512324358265', '3577778157919314504', '14894068710063348487', '1294465214383781161',
      '465944652040885897', '7937294810946806131', '3849287863852499584', '5406759801798337480', '241851231317828981', '1456215246176062136',
      '7613811247471741961', '1804312132722180201', '5608378062013572713', '15293031020466096408', '13447077090413146373', '7222032299962346917',
      '17912061998839310979', '2459028469735686113', '11964252391146578476', '9027416829622342829', '3993510008929295315', '3555797439612589184',
      '2988178761202034333', '3461204551265785888', '4627098889531055414', '1556008542357238666', '16468599424800719238', '1923510103922296319',
      '2049429975587534727', '3016212468291539606', '17198166215261833993', '1462016016387883143', '2442541497099098535', '9813823125703490621',
    ]);
  });

  it('decodes getRemotePools(base) to both left-padded EVM pools unchanged', () => {
    expect(decodeBytesArray(answer('pool.getRemotePools(base)'))).toEqual([
      '0x0000000000000000000000000a995a72d8346683c97514990f802f4778b7ac72',
      '0x000000000000000000000000ba148baf60ccc4d7d86aed4fcff04d5b3265cad4',
    ]);
  });

  it('decodes getRemotePools(solana) to the 32-byte Solana key unchanged', () => {
    expect(decodeBytesArray(answer('pool.getRemotePools(solana)'))).toEqual(['0xec374ef61f9f90858c199ff8f24c61c319a08d47634a58b802196b473df91e75']);
  });

  it('decodes a bytes[] holding a left-padded EVM address and a 32-byte Solana key to both byte strings unchanged', () => {
    const mixed = words(
      hexWord('20'), hexWord('2'), hexWord('40'), hexWord('80'),
      hexWord('20'), '0000000000000000000000000a995a72d8346683c97514990f802f4778b7ac72',
      hexWord('20'), 'ec374ef61f9f90858c199ff8f24c61c319a08d47634a58b802196b473df91e75',
    );
    expect(decodeBytesArray(mixed)).toEqual([
      '0x0000000000000000000000000a995a72d8346683c97514990f802f4778b7ac72',
      '0xec374ef61f9f90858c199ff8f24c61c319a08d47634a58b802196b473df91e75',
    ]);
  });

  it('decodes getRemoteToken as bytes, padded for an EVM remote and raw for Solana', () => {
    expect(decodeBytes(answer('pool.getRemoteToken(base)'))).toBe('0x00000000000000000000000088fb150bdc53a65fe94dea0c9ba0a6daf8c6e196');
    expect(decodeBytes(answer('pool.getRemoteToken(solana)'))).toBe('0x050d4942d784939f85d9220bd3088f159cde79270637f040b2aafd4b59853903');
  });

  it('decodes typeAndVersion() strings', () => {
    expect(decodeString(answer('pool.typeAndVersion'))).toBe('LockReleaseTokenPool 1.5.1');
    expect(decodeString(answer('registry.typeAndVersion'))).toBe('TokenAdminRegistry 1.5.0');
  });

  it('decodes addresses, booleans and integers', () => {
    expect(decodeValue(answer('pool.owner'), 'address')).toBe(LINK_ADMIN);
    expect(decodeValue(answer('pool.getToken'), 'address')).toBe(LINK_TOKEN);
    expect(decodeValue(answer('pool.isSupportedChain(base)'), 'bool')).toBe(true);
    expect(decodeValue(answer('multicall3.getChainId'), 'uint256')).toBe(1n);
  });

  it('decodes getTokenConfig(LINK) as a static tuple of three addresses', () => {
    expect(decodeTuple(answer('registry.getTokenConfig(link)'), ['address', 'address', 'address'])).toEqual([
      LINK_ADMIN,
      '0x0000000000000000000000000000000000000000',
      LINK_POOL,
    ]);
  });

  it('decodes an outbound rate limiter bucket as a static tuple of five words', () => {
    expect(decodeTuple(answer('pool.getCurrentOutboundRateLimiterState(base)'), ['uint128', 'uint32', 'bool', 'uint128', 'uint128'])).toEqual([
      50_000n * 10n ** 18n,
      1795439735n,
      true,
      50_000n * 10n ** 18n,
      13_880_000_000_000_000_000n,
    ]);
  });

  it('decodes getAllConfiguredTokens as an address array', () => {
    expect(decodeArray(answer('registry.getAllConfiguredTokens(0,3)'), 'address')).toEqual([
      '0xb006a31a279fd90be4cdfffab5fd45dd605d33cc',
      LINK_TOKEN,
      '0x2624bd0094f474713ac9c634b37a5ebef4e0b1fe',
    ]);
  });

  it('decodes a signed word', () => {
    expect(decodeValue(words('f'.repeat(64)), 'int256')).toBe(-1n);
    expect(decodeValue(words(hexWord('7f')), 'int8')).toBe(127n);
  });
});

describe('Multicall3 aggregate3', () => {
  const three = [
    { to: LINK_POOL, data: selector('owner()') },
    { to: LINK_POOL, data: encodeCall(selector('getRemotePool(uint64)'), uintWord(BASE)) },
    { to: LINK_POOL, data: selector('getToken()') },
  ];
  const recordedCall = recorded.calls['multicall3.aggregate3(owner,getRemotePool(base),getToken)'];

  it('encodes the calldata mainnet answered', () => {
    expect(recordedCall.to).toBe(MULTICALL3.address);
    expect(encodeAggregate3(three)).toBe(recordedCall.data);
  });

  it('decodes the recorded answer, the reverted second call included', () => {
    expect(decodeAggregate3(recordedCall.result)).toEqual([
      { success: true, data: answer('pool.owner') },
      { success: false, data: '0x' },
      { success: true, data: answer('pool.getToken') },
    ]);
  });
});

describe('malformed answers decode as no answer', () => {
  it('an offset past the end of the answer', () => {
    expect(decodeBytes(words(hexWord('40'), hexWord('20')))).toBeNull();
    expect(decodeArray(words(hexWord('20'), hexWord('2'), hexWord('1')), 'uint64')).toBeNull();
    expect(decodeBytesArray(words(hexWord('20'), hexWord('1'), hexWord('400')))).toBeNull();
  });

  it('an array length over the cap', () => {
    expect(decodeArray(words(hexWord('20'), hexWord((ABI_CAPS.array + 1).toString(16))), 'address')).toBeNull();
    expect(decodeBytesArray(words(hexWord('20'), hexWord('ffffffffffffffff')))).toBeNull();
  });

  it('an address word with non-zero high bytes', () => {
    expect(decodeValue(words(`01${'0'.repeat(22)}514910771af9ca656af840dff83e8264ecf986ca`), 'address')).toBeNull();
    expect(decodeTuple(words(hexWord('1'), `ff${'0'.repeat(62)}`), ['address', 'address'])).toBeNull();
  });

  it('a boolean that is neither 0 nor 1', () => {
    expect(decodeValue(words(hexWord('2')), 'bool')).toBeNull();
  });

  it('an integer wider than its type', () => {
    expect(decodeArray(words(hexWord('20'), hexWord('1'), hexWord('1'.padStart(17, '1'))), 'uint64')).toBeNull();
    expect(decodeValue(words(hexWord('100')), 'uint8')).toBeNull();
    expect(decodeValue(words(hexWord('80')), 'int8')).toBeNull();
  });

  it('a string or bytes over the length cap', () => {
    const over = ABI_CAPS.text + 1;
    const text = '41'.repeat(over).padEnd(Math.ceil(over / 32) * 64, '0');
    expect(decodeString(words(hexWord('20'), hexWord(over.toString(16)), text))).toBeNull();
    const bytesOver = ABI_CAPS.bytes + 1;
    const data = 'ab'.repeat(bytesOver).padEnd(Math.ceil(bytesOver / 32) * 64, '0');
    expect(decodeBytes(words(hexWord('20'), hexWord(bytesOver.toString(16)), data))).toBeNull();
  });

  it('a string that is not UTF-8', () => {
    expect(decodeString(words(hexWord('20'), hexWord('1'), `ff${'0'.repeat(62)}`))).toBeNull();
  });

  it('an empty, short or non-hex answer', () => {
    expect(decodeValue('0x', 'address')).toBeNull();
    expect(decodeTuple(answer('pool.owner'), ['address', 'address'])).toBeNull();
    expect(decodeValue(`0x${'zz'.repeat(32)}`, 'uint256')).toBeNull();
    expect(decodeValue(undefined, 'uint256')).toBeNull();
  });

  it('an aggregate3 answer whose inner bytes run past the end', () => {
    expect(decodeAggregate3(words(hexWord('20'), hexWord('1'), hexWord('20'), hexWord('1'), hexWord('40'), hexWord('100')))).toBeNull();
  });
});
