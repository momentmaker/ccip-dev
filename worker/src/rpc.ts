import { DEFAULT_RPC_URLS, LOG_RPC_URLS } from '@ccip-dev/core';
import endpoints from '../../config/endpoints.json';
import type { Env } from './env';

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
