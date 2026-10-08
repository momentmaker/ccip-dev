export type Tone = 'up' | 'down' | 'flat';

export function changeTone(value: number | null | undefined): Tone {
  if (!value) return 'flat';
  return value > 0 ? 'up' : 'down';
}
