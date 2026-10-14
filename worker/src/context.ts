import {
  createCcipClient, createCoingeckoClient, createPricesClient, type CcipClient, type CoingeckoClient, type Handles, type LabelIndex, type PricesClient, type ProjectRegistry,
} from '@ccip-dev/core';
import { createAlerter, type Alert } from './alerts';
import type { Deps } from './deps';
import type { Env } from './env';
import { bundledHandles } from './handles';
import { bundledLabels, bundledProjects } from './labels';

export interface RunContext {
  env: Env;
  deps: Deps;
  ccip: CcipClient;
  prices: PricesClient;
  coingecko: CoingeckoClient;
  alert: Alert;
  labels: LabelIndex;
  handles: Handles;
  projects: ProjectRegistry;
}

export function createRunContext(
  env: Env,
  deps: Deps,
  overrides: Partial<Pick<RunContext, 'ccip' | 'prices' | 'coingecko' | 'alert' | 'labels' | 'handles' | 'projects'>> = {},
): RunContext {
  return {
    env,
    deps,
    ccip: overrides.ccip ?? createCcipClient(deps, { baseUrl: env.CCIP_API_BASE }),
    prices: overrides.prices ?? createPricesClient(deps),
    coingecko: overrides.coingecko ?? createCoingeckoClient(deps),
    alert: overrides.alert ?? createAlerter(env.DB, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID }, deps),
    labels: overrides.labels ?? bundledLabels,
    handles: overrides.handles ?? bundledHandles,
    projects: overrides.projects ?? bundledProjects,
  };
}
