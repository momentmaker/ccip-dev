import { DEFAULT_RPC_URLS, LOG_RPC_URLS, type ChainRef } from '@ccip-dev/core';
import directory from '../../config/ccip-directory.json';
import endpoints from '../../config/endpoints.json';
import type { Env } from './env';

export type ChainEndpoint =
  | { ok: true; rpcUrl: string; router: string; tokenAdminRegistry: string }
  | { ok: false; reason: 'no endpoint' | 'no registry' };

export function keyedRpcUrls(env: Env): string[] {
  return [env.RPC_ETHEREUM ?? '', ...(env.RPC_FALLBACKS ?? '').split(',')].map((u) => u.trim()).filter((u) => u.length > 0);
}

export function balanceRpcUrls(env: Env): string[] {
  const keyed = keyedRpcUrls(env);
  return keyed.length > 0 ? keyed : DEFAULT_RPC_URLS;
}

export function logRpcUrls(env: Env): string[] {
  return [...new Set([...keyedRpcUrls(env), ...LOG_RPC_URLS, ...endpoints.ethereumLogs])];
}

const RPC_BY_NAME: Record<string, string> = endpoints.rpc;
const DIRECTORY_BY_SELECTOR: Record<string, { router: string; tokenAdminRegistry: string }> = directory.chains;

export function chainEndpoint(chain: Pick<ChainRef, 'selector' | 'name'>): ChainEndpoint {
  const rpcUrl = RPC_BY_NAME[chain.name];
  if (!rpcUrl) return { ok: false, reason: 'no endpoint' };
  const entry = DIRECTORY_BY_SELECTOR[chain.selector];
  if (!entry) return { ok: false, reason: 'no registry' };
  return { ok: true, rpcUrl, router: entry.router, tokenAdminRegistry: entry.tokenAdminRegistry };
}
