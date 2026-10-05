import type { PriceInfo } from './types';

export interface PricesClient {
  latest(keys: string[]): Promise<Map<string, PriceInfo>>;
  dailyHistory(key: string, fromDay: string, toDay: string): Promise<Map<string, number>>;
}
