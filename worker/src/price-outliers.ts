import { MAX_TRANSFER_USD } from '@ccip-dev/core';
import type { RunContext } from './context';

/** One alert per run for the token amounts valued above MAX_TRANSFER_USD, which were stored unpriced. */
export async function alertPriceOutliers(c: RunContext, outliers: string[]): Promise<void> {
  if (outliers.length === 0) return;
  const tokens = [...new Set(outliers)];
  await c.alert(
    'price-outlier',
    `${outliers.length} token amount(s) valued above $${MAX_TRANSFER_USD.toLocaleString('en-US')} were stored unpriced; ` +
      `check the price of ${tokens.join(', ')}`,
  );
}
