import { CARD_FONTS, INTER_900, MONO_700 } from '../fonts';

/** The site's card fonts plus the two weights the LinkMarine mockups need; Inter 600 and JetBrains Mono 600 fall to 700. */
export const KINO_FONTS = [
  ...CARD_FONTS,
  { name: 'Inter', data: INTER_900, weight: 900 as const, style: 'normal' as const },
  { name: 'JetBrains Mono', data: MONO_700, weight: 700 as const, style: 'normal' as const },
];
