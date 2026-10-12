import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/days';
import { CTA_ROTATION, ctaFor } from '../worker/cards/cta';

const ORACLE = { launch: '2026-11-02', cta: { lead: 'Play Be The Oracle:', path: 'ccip.dev/oracle' } };
const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe('ctaFor', () => {
  it('rotates through the five calls to action by UTC day', () => {
    expect(new Set(days('2026-10-10', 5).map((d) => ctaFor(d, null).path)).size).toBe(CTA_ROTATION.length);
  });

  it('gives Be The Oracle every other day for its first 30 days, then one day in six', () => {
    // #when
    const first = days(ORACLE.launch, 30).map((d) => ctaFor(d, ORACLE) === ORACLE.cta);
    const later = days(addDays(ORACLE.launch, 30), 60).filter((d) => ctaFor(d, ORACLE) === ORACLE.cta).length;
    const before = days('2026-10-01', 30).some((d) => ctaFor(d, ORACLE) === ORACLE.cta);
    // #then
    expect({ alternates: first.every((isOracle, i) => isOracle === (i % 2 === 0)), later, before }).toEqual({ alternates: true, later: 10, before: false });
  });
});
