import type { StatusFile } from '@ccip-dev/core/public';
import { useEffect, useState } from 'react';
import { trackDataError } from '../lib/analytics';
import { startPoller } from '../lib/poller';

export function useStatus(): { status: StatusFile | null; failures: number } {
  const [status, setStatus] = useState<StatusFile | null>(null);
  const [failures, setFailures] = useState(0);
  useEffect(
    () =>
      startPoller({
        name: 'status.json',
        onData: (s) => {
          setStatus(s);
          setFailures(0);
        },
        onError: (_error, n) => {
          setFailures(n);
          trackDataError('status.json');
        },
      }),
    [],
  );
  return { status, failures };
}
