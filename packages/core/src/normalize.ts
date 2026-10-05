import { isAddressShape } from './chain-map';
import { FixedFees, type DetailMessage, type ListMessage, type NetworkInfo, type RegistryToken } from './ccip/schemas';
import { dayOf, toIsoUtc } from './time';
import type { ChainRef, NormalizedMessage } from './types';

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

export function sanitize(text: string, maxLength = 64): string {
  return text.replace(CONTROL_CHARS, '').slice(0, maxLength);
}

/** EVM addresses are case-insensitive, so they are stored lowercase; base58 (Solana) is case-sensitive. */
export function normalizeAddress(address: string): string {
  return isAddressShape('EVM', address) ? address.toLowerCase() : address;
}

export function chainRef(info: NetworkInfo): ChainRef {
  return { selector: info.chainSelector, name: info.name, chainId: info.chainId, family: info.chainFamily };
}

export function normalizeList(m: ListMessage): NormalizedMessage {
  const src = chainRef(m.sourceNetworkInfo);
  return {
    messageId: m.messageId,
    day: dayOf(m.sendTimestamp),
    sendTs: toIsoUtc(m.sendTimestamp),
    receiptTs: m.receiptTimestamp ? toIsoUtc(m.receiptTimestamp) : null,
    status: m.status,
    readyForManualExec: m.readyForManualExecution,
    src,
    dst: chainRef(m.destNetworkInfo),
    sender: normalizeAddress(m.sender),
    receiver: m.receiver ? normalizeAddress(m.receiver) : null,
    origin: m.origin ? normalizeAddress(m.origin) : null,
    tokens: m.sourceTokenAmount
      ? [{ chain: src, token: normalizeAddress(m.sourceTokenAmount.tokenAddress), amount: m.sourceTokenAmount.tokenAmount }]
      : [],
    fee: null,
  };
}

export interface NormalizedDetail {
  message: NormalizedMessage;
  version: string | null;
  feeShapeUnknown: boolean;
}

export function normalizeDetail(d: DetailMessage): NormalizedDetail {
  const base = normalizeList({ ...d, sourceTokenAmount: null });
  const fees = FixedFees.safeParse(d.fees);
  return {
    message: {
      ...base,
      tokens: d.tokenAmounts.map((t) => ({ chain: base.src, token: normalizeAddress(t.sourceTokenAddress), amount: t.amount })),
      fee: fees.success
        ? { token: normalizeAddress(fees.data.fixedFeesDetails.tokenAddress), amount: fees.data.fixedFeesDetails.totalAmount }
        : null,
    },
    version: d.version ?? null,
    feeShapeUnknown: d.fees !== undefined && !fees.success,
  };
}

export interface NormalizedToken {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  groupId: string | null;
}

export function normalizeRegistryToken(t: RegistryToken): NormalizedToken {
  return {
    chain: t.chainSelector,
    address: normalizeAddress(t.address),
    symbol: sanitize(t.symbol),
    name: sanitize(t.name),
    decimals: t.decimals,
    groupId: t.groupId ?? null,
  };
}
