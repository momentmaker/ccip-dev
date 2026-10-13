import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DISCORD_INSTALL_URL, REPO_URL, TELEGRAM_URL, X_URL } from '../src/config';
import { SOCIALS } from '../src/lib/socials';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('SOCIALS', () => {
  it('links X, Telegram, the Discord page and GitHub, in that order', () => {
    // #given the footer's icon row
    // #when its targets are read
    // #then each goes where the brief says
    expect(SOCIALS.map((s) => [s.name, s.href])).toEqual([
      ['X', X_URL],
      ['Telegram', TELEGRAM_URL],
      ['Discord', '/discord/'],
      ['GitHub', REPO_URL],
    ]);
  });

  it('gives every icon a label and a path to draw', () => {
    for (const s of SOCIALS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.path.length).toBeGreaterThan(50);
    }
  });
});

describe('DISCORD_INSTALL_URL', () => {
  it('asks only for the commands scope', () => {
    const url = new URL(DISCORD_INSTALL_URL);
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('applications.commands');
    expect(url.searchParams.has('permissions')).toBe(false);
  });
});

describe('the /discord/ page source', () => {
  const page = source('../src/pages/discord.astro');

  it('gives every image real alt text and its size', () => {
    const images = page.match(/<img\b[^>]*>/g) ?? [];
    expect(images.length).toBe(3);
    for (const tag of images) {
      expect(tag).toMatch(/alt=(?:"[^"]{8,}"|\{[^}]+\})/);
      expect(tag).toMatch(/width="\d+"/);
      expect(tag).toMatch(/height="\d+"/);
    }
  });

  it('loads the hero eagerly and the rest lazily', () => {
    const [hero, ...rest] = page.match(/<img\b[^>]*>/g) ?? [];
    expect(hero).not.toContain('loading="lazy"');
    for (const tag of rest) expect(tag).toContain('loading="lazy"');
  });

  it('links the install URL from its constant, not a literal', () => {
    expect(page).toContain('DISCORD_INSTALL_URL');
    expect(page).not.toContain('discord.com/oauth2');
  });

  it('leaves out the roster counter', () => {
    expect(page).not.toMatch(/enlisted so far|roster is coming/i);
  });
});

describe('the menus', () => {
  it('lists the Discord bot in the header menu and the footer links', () => {
    expect(source('../src/components/Header.astro')).toContain("{ href: '/discord/', label: 'Discord bot' }");
    expect(source('../src/components/Footer.astro')).toContain('Discord bot');
  });

  it('mentions the bot on the about page', () => {
    expect(source('../src/pages/about.astro')).toContain('ccip.dev on Discord');
  });
});
