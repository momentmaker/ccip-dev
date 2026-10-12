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
