import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '../hooks';

const link4 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** LINK the reward vault has streamed to stakers since the page opened, counted every frame, or every second with reduced motion. */
export default function RewardsStream({ perSecond }: { perSecond: number }) {
  const reduced = usePrefersReducedMotion();
  const out = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const start = performance.now();
    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      if (!reduced || t - last >= 1_000) {
        last = t;
        if (out.current) out.current.textContent = link4(((t - start) / 1000) * perSecond);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [perSecond, reduced]);

  return <span ref={out}>{link4(0)}</span>;
}
