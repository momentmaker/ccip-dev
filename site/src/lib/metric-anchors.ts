export const METRIC_ANCHORS = {
  messages: 'what-is-counted',
  value: 'what-is-counted',
  fees: 'what-is-counted',
  fee_link: 'what-is-counted',
  typical_fee: 'what-is-counted',
  take_rate: 'what-is-counted',
  delivery: 'what-is-counted',
  senders: 'what-is-counted',
  unpriced: 'what-is-counted',
  since: 'coverage',
  reserve: 'chainlink-reserve',
  staking: 'chainlink-staking',
  labels: 'senders-and-projects',
  status: 'data-sources',
  cre: 'cre-sent-messages',
  passport: 'token-passport',
  passport_single_key: 'single-key-check',
  passport_rate_limit: 'rate-limit-check',
  passport_pool_pointer: 'pool-pointer-check',
  passport_verifiers: 'verifier-line',
  passport_not_readable: 'not-readable',
  passport_posts: 'what-posts-to-telegram',
  passport_statements: 'corrections-and-statements',
} as const;

export type MetricKey = keyof typeof METRIC_ANCHORS;

export function methodologyHref(metric: MetricKey): string {
  return `/methodology/#${METRIC_ANCHORS[metric]}`;
}
