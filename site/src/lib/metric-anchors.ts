export const METRIC_ANCHORS = {
  messages: 'what-is-counted',
  value: 'what-is-counted',
  fees: 'what-is-counted',
  fee_link: 'what-is-counted',
  delivery: 'what-is-counted',
  senders: 'what-is-counted',
  unpriced: 'what-is-counted',
  since: 'coverage',
  reserve: 'chainlink-reserve',
  labels: 'data-sources',
  status: 'data-sources',
} as const;

export type MetricKey = keyof typeof METRIC_ANCHORS;

export function methodologyHref(metric: MetricKey): string {
  return `/methodology/#${METRIC_ANCHORS[metric]}`;
}
