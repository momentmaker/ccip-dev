import type { StatusFile } from '@ccip-dev/core/public';
import { coverageLine } from '../lib/status-light';

export default function CoverageNote({ coverage }: { coverage: StatusFile['label_coverage'] }) {
  const line = coverageLine(coverage);
  if (!line) return null;
  return (
    <p className="coverage">
      {line}. <a href="/projects/">See the projects</a>
    </p>
  );
}
