import { useEffect, useRef, useState } from 'react';

const COUNT_UP_MS = 900;

export const easeOutCubic = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

export function countUpValue(from: number, to: number, elapsedMs: number, durationMs: number): number {
  return from + (to - from) * easeOutCubic(elapsedMs / durationMs);
}

export function countUpStart(shown: number | null, target: number): number {
  return shown ?? target;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function useNow(intervalMs: number): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useCountUp(target: number, animate: boolean): number {
  const [value, setValue] = useState(target);
  const shownRef = useRef<number | null>(null);
  useEffect(() => {
    const from = countUpStart(shownRef.current, target);
    if (!animate || from === target) {
      shownRef.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const next = countUpValue(from, target, now - start, COUNT_UP_MS);
      shownRef.current = next;
      setValue(next);
      if (now - start < COUNT_UP_MS) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);
  return value;
}
