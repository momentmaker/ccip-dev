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
