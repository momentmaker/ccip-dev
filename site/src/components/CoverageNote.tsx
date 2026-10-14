import type { StatusFile } from '@ccip-dev/core/public';
import { labelCoverageLine } from '../lib/format';

export default function CoverageNote({ coverage }: { coverage: StatusFile['label_coverage'] }) {
  const line = labelCoverageLine(coverage);
  if (!line) return null;
  return (
    <p className="coverage">
      {line}. <a href="/projects/">See the projects</a>
    </p>
  );
}
