import { describe, expect, it } from 'vitest';
import { EMPTY_SPONSOR_CARD, sponsorView } from '../src/lib/sponsor';

describe('sponsorView', () => {
  it('invites sponsors when none is set', () => {
    expect(sponsorView({})).toEqual({
      kind: 'invite',
      card: { name: null, text: EMPTY_SPONSOR_CARD, logo: null, href: '/sponsor/' },
      footer: { text: 'Sponsor ccip.dev', href: '/sponsor/' },
      cardLine: null,
    });
    expect(EMPTY_SPONSOR_CARD).toBe('Your project here — sponsor ccip.dev. Reach the people watching CCIP live.');
  });

  it('shows a configured sponsor in the card, the footer and share cards', () => {
    expect(sponsorView({ name: 'Acme', url: 'https://acme.example', logo: '/sponsor/acme.svg', tagline: 'Rockets for oracles' })).toEqual({
      kind: 'sponsor',
      card: { name: 'Acme', text: 'Rockets for oracles', logo: '/sponsor/acme.svg', href: 'https://acme.example' },
      footer: { text: 'Sponsored by Acme', href: 'https://acme.example' },
      cardLine: 'Sponsored by Acme',
    });
  });

  it.each([
    [{ name: 'Acme' }],
    [{ name: 'Acme', url: 'http://acme.example', logo: '/sponsor/a.svg', tagline: 't' }],
    [{ name: 'Acme', url: 'https://acme.example', logo: 'https://elsewhere.example/a.svg', tagline: 't' }],
  ])('rejects a malformed sponsor file %j', (raw) => {
    expect(() => sponsorView(raw)).toThrow();
  });
});
