import { createCcipClient, createPricesClient, type CcipClient, type LabelIndex, type PricesClient } from '@ccip-dev/core';
import { createAlerter, type Alert } from './alerts';
import type { Deps } from './deps';
import type { Env } from './env';
import { bundledLabels } from './labels';

export interface RunContext {
  env: Env;
  deps: Deps;
  ccip: CcipClient;
  prices: PricesClient;
  alert: Alert;
  labels: LabelIndex;
}

export function createRunContext(
  env: Env,
  deps: Deps,
  overrides: Partial<Pick<RunContext, 'ccip' | 'prices' | 'alert' | 'labels'>> = {},
): RunContext {
  return {
    env,
    deps,
    ccip: overrides.ccip ?? createCcipClient(deps, { baseUrl: env.CCIP_API_BASE }),
    prices: overrides.prices ?? createPricesClient(deps),
    alert: overrides.alert ?? createAlerter(env.DB, { token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID }, deps),
    labels: overrides.labels ?? bundledLabels,
  };
}
