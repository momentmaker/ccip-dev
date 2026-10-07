import { z } from 'zod';

export const EMPTY_SPONSOR_CARD = 'Your project here — sponsor ccip.dev. Reach the people watching CCIP live.';

export const SponsorSchema = z.union([
  z.strictObject({
    name: z.string().min(1),
    url: z.url({ protocol: /^https$/ }),
    logo: z.string().regex(/^\/sponsor\/[\w.-]+$/),
    tagline: z.string().min(1),
  }),
  z.strictObject({}),
]);

export interface SponsorView {
  kind: 'sponsor' | 'invite';
  card: { name: string | null; text: string; logo: string | null; href: string };
  footer: { text: string; href: string };
  cardLine: string | null;
}

export function sponsorView(raw: unknown): SponsorView {
  const sponsor = SponsorSchema.parse(raw);
  if ('name' in sponsor) {
    return {
      kind: 'sponsor',
      card: { name: sponsor.name, text: sponsor.tagline, logo: sponsor.logo, href: sponsor.url },
      footer: { text: `Sponsored by ${sponsor.name}`, href: sponsor.url },
      cardLine: `Sponsored by ${sponsor.name}`,
    };
  }
  return {
    kind: 'invite',
    card: { name: null, text: EMPTY_SPONSOR_CARD, logo: null, href: '/sponsor/' },
    footer: { text: 'Sponsor ccip.dev', href: '/sponsor/' },
    cardLine: null,
  };
}
