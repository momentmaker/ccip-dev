import { describe, expect, it } from 'vitest';
import { DetailMessage, ListMessage } from '../src/ccip/schemas';
import { normalizeDetail, normalizeList, normalizeRegistryToken, sanitize } from '../src/normalize';
import detailFailed from './fixtures/detail-failed.json';
import detailMultiToken from './fixtures/detail-multi-token.json';
import detailSvm from './fixtures/detail-svm.json';
import detailToken from './fixtures/detail-token.json';
import detailV16 from './fixtures/detail-v16.json';
import listPage from './fixtures/list-page.json';

const list = listPage.data.map((m) => ListMessage.parse(m));

describe('normalizeList', () => {
  it('normalizes an EVM token transfer and lowercases EVM addresses', () => {
    expect(normalizeList(list[0]!)).toEqual({
      messageId: '0xb79027a36c0269cd51156cbab395ccdc5668986a6e2443af528f45824718b8c6',
      day: '2026-10-05',
      sendTs: '2026-10-05T11:14:53.000Z',
      receiptTs: null,
      status: 'SENT',
      readyForManualExec: false,
      src: { selector: '15971525489660198786', name: 'ethereum-mainnet-base-1', chainId: '8453', family: 'EVM' },
      dst: { selector: '11344663589394136015', name: 'binance_smart_chain-mainnet', chainId: '56', family: 'EVM' },
      sender: '0x7af7632562b6063e52788607ad56f7a60f57ce09',
      receiver: '0x346ec0fadbf97cc3a5e2fbdaa7e4d10503f1052e',
      origin: '0x9568a788e04b2e35383c284bf3d748483d77db44',
      tokens: [
        {
          chain: { selector: '15971525489660198786', name: 'ethereum-mainnet-base-1', chainId: '8453', family: 'EVM' },
          token: '0x9818b6c09f5ecc843060927e8587c427c7c93583',
          amount: '24000580226526875891506',
        },
      ],
      fee: null,
    });
  });

  it('keeps Solana (base58) addresses exactly as given', () => {
    const n = normalizeList(list[2]!);
    expect(n.sender).toBe('A8JPtC8mYrZKvainsrr3cGhTcoBeUV2vd8SXun55in3u');
    expect(n.origin).toBe('GP4vfmRbyvhG5kxCZwNL7tBmGEFXtYjZgTcUmYS7Zrbd');
    expect(n.receiver).toBe('0x9ec0e4a4c411493773e01e2abf4d42395788846b');
    expect(n.receiptTs).toBe('2026-10-05T11:05:52.000Z');
  });

  it('gives data-only messages no tokens and keeps the manual-execution flag', () => {
    expect(normalizeList(list[1]!).tokens).toEqual([]);
    expect(normalizeList(list[3]!).readyForManualExec).toBe(true);
  });
});

describe('normalizeDetail', () => {
  it('takes tokens and the fee from a v2.0 detail', () => {
    const { message, version, feeShapeUnknown } = normalizeDetail(DetailMessage.parse(detailToken));
    expect(version).toBe('2.0.0');
    expect(feeShapeUnknown).toBe(false);
    expect(message.tokens.map((t) => [t.token, t.amount])).toEqual([
      ['0x9818b6c09f5ecc843060927e8587c427c7c93583', '24000580226526875891506'],
    ]);
    expect(message.fee).toEqual({ token: '0x4200000000000000000000000000000000000006', amount: '106697113670237' });
  });

  it('reads v1.6 fees that have no items list', () => {
    const { message, feeShapeUnknown } = normalizeDetail(DetailMessage.parse(detailV16));
    expect(feeShapeUnknown).toBe(false);
    expect(message.fee).toEqual({ token: '0xe538905cf8410324e03a5a23c1c177a474d59b2b', amount: '787636488307130' });
  });

  it('keeps a Solana fee token exact and reads FAILED details', () => {
    expect(normalizeDetail(DetailMessage.parse(detailSvm)).message.fee?.token).toBe('So11111111111111111111111111111111111111112');
    const failed = normalizeDetail(DetailMessage.parse(detailFailed)).message;
    expect([failed.status, failed.readyForManualExec]).toEqual(['FAILED', true]);
  });

  it('flags an unknown fee shape and leaves the fee empty', () => {
    const result = normalizeDetail(DetailMessage.parse({ ...detailToken, fees: { somethingNew: true } }));
    expect(result.feeShapeUnknown).toBe(true);
    expect(result.message.fee).toBeNull();
  });

  it('does not flag a pending detail that has no fees yet', () => {
    const { fees: _fees, ...noFees } = detailToken;
    const result = normalizeDetail(DetailMessage.parse(noFees));
    expect(result.feeShapeUnknown).toBe(false);
    expect(result.message.fee).toBeNull();
  });

  it('keeps every token of a multi-token message in order, lowercased, on the source chain', () => {
    const { message } = normalizeDetail(DetailMessage.parse(detailMultiToken));
    expect(message.tokens.map((t) => [t.token, t.amount, t.chain.selector])).toEqual([
      ['0x9818b6c09f5ecc843060927e8587c427c7c93583', '24000580226526875891506', '15971525489660198786'],
      ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '2500000', '15971525489660198786'],
    ]);
  });
});

describe('sanitize and registry tokens', () => {
  it('strips control and bidi characters and caps the length at 64', () => {
    expect(sanitize(`LI\u0000NK\u202e${'x'.repeat(100)}`)).toBe(`LINK${'x'.repeat(60)}`);
  });

  it('normalizes registry tokens', () => {
    expect(
      normalizeRegistryToken({
        chainSelector: '5009297550715157269',
        address: '0x514910771AF9Ca656af840dff83E8264EcF986CA',
        symbol: 'LINK\n',
        name: 'Chainlink',
        decimals: 18,
        groupId: null,
      }),
    ).toEqual({
      chain: '5009297550715157269',
      address: '0x514910771af9ca656af840dff83e8264ecf986ca',
      symbol: 'LINK',
      name: 'Chainlink',
      decimals: 18,
      groupId: null,
    });
  });
});
