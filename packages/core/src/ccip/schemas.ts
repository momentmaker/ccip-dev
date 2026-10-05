import { z } from 'zod';

const unsignedInteger = z.string().regex(/^\d+$/, 'expected an unsigned integer string');

export const NetworkInfo = z.object({
  name: z.string(),
  displayName: z.string(),
  chainSelector: z.string(),
  chainId: z.string(),
  chainFamily: z.string(),
  environment: z.string(),
});
export type NetworkInfo = z.output<typeof NetworkInfo>;

export const ListMessage = z.object({
  messageId: z.string(),
  sender: z.string(),
  receiver: z.string().nullish(),
  origin: z.string().nullish(),
  status: z.string(),
  readyForManualExecution: z.boolean(),
  sourceNetworkInfo: NetworkInfo,
  destNetworkInfo: NetworkInfo,
  sendTimestamp: z.string(),
  receiptTimestamp: z.string().nullish(),
  sourceTokenAmount: z.object({ tokenAddress: z.string(), tokenAmount: unsignedInteger }).nullish(),
});
export type ListMessage = z.output<typeof ListMessage>;

const Pagination = z.object({ hasNextPage: z.boolean(), cursor: z.string().nullish() });

export const ListPage = z.object({ data: z.array(ListMessage), pagination: Pagination });

export const DetailMessage = ListMessage.omit({ sourceTokenAmount: true }).extend({
  version: z.string().nullish(),
  tokenAmounts: z.array(z.object({ sourceTokenAddress: z.string(), amount: unsignedInteger })).default([]),
  fees: z.unknown().optional(),
});
export type DetailMessage = z.output<typeof DetailMessage>;

export const FixedFees = z.object({
  fixedFeesDetails: z.object({ tokenAddress: z.string(), totalAmount: unsignedInteger }),
});

export const ChainsResponse = z.object({ chains: z.array(NetworkInfo) });

export const RegistryToken = z.object({
  chainSelector: z.string(),
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  groupId: z.string().nullish(),
});
export type RegistryToken = z.output<typeof RegistryToken>;

export const TokensPage = z.object({ data: z.array(RegistryToken), pagination: Pagination });
