/** twitter-text v3 (config/v3.json): code points in these ranges weigh 1 and all others 2; an emoji sequence weighs 2 in all. */
const LIGHT: readonly [number, number][] = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]];
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

const weight = (codePoint: number) => (LIGHT.some(([lo, hi]) => codePoint >= lo && codePoint <= hi) ? 1 : 2);

/** The length X counts against its 280 limit. URLs (23 each) are not handled: posts never contain one. */
export function xLength(text: string): number {
  let length = 0;
  for (const { segment } of graphemes.segment(text.normalize('NFC'))) {
    length += EMOJI.test(segment) ? 2 : [...segment].reduce((sum, ch) => sum + weight(ch.codePointAt(0)!), 0);
  }
  return length;
}

/**
 * A cashtag as twitter-text reads one: `$` and 1–6 letters (with an optional `.xx` or `_xx` suffix), after the start, a
 * space or punctuation, and before the end, a space or punctuation. "$6.1M" and "$syrupUSDC" are not cashtags.
 */
const CASHTAG = /(?<=^|\s|\p{P})\$[a-z]{1,6}(?:[._][a-z]{1,2})?(?=$|\s|\p{P})/giu;

export const cashtags = (text: string): string[] => [...text.matchAll(CASHTAG)].map((m) => m[0]);

/** X refuses a post with more than one cashtag: $LINK keeps its `$` (else the first one does), and every other is written plainly. */
export function oneCashtag(text: string): string {
  const found = [...text.matchAll(CASHTAG)];
  if (found.length <= 1) return text;
  const kept = found.find((m) => m[0].toUpperCase() === '$LINK') ?? found[0]!;
  let out = text;
  for (const m of [...found].reverse()) if (m !== kept) out = out.slice(0, m.index) + out.slice(m.index! + 1);
  return out;
}
