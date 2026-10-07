const UNITS: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K'], [1, '']];

export function odometer(value: number): { text: string; frac: number } {
  const v = Math.max(0, value);
  const [size, suffix] = UNITS.find(([s]) => v >= s) ?? [1, ''];
  const step = suffix === '' ? 1 : 0.1;
  const n = v / size / step;
  const whole = Math.floor(n + 1e-9);
  const shown = whole * step;
  return { text: `$${suffix === '' ? String(shown) : shown.toFixed(1)}${suffix}`, frac: Math.max(0, n - whole) };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (x: number) => x * x * (3 - 2 * x);
const ease = (x: number) => 1 - (1 - x) ** 3;

export function rollOf(frac: number, settle: number): number {
  return smoothstep(clamp01((frac - 0.5) / 0.5)) * (1 - ease(clamp01(settle)));
}
