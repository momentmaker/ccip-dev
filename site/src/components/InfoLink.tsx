import { methodologyHref, type MetricKey } from '../lib/metric-anchors';

export default function InfoLink({ metric, label }: { metric: MetricKey; label: string }) {
  return (
    <a className="info" href={methodologyHref(metric)} aria-label={`How ${label} is measured`} title="Methodology">
      ⓘ
    </a>
  );
}
