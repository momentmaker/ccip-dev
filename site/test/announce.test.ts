import { describe, expect, it } from 'vitest';
import { launchAnnouncement } from '../src/lib/announce';

const names = new Map([['1', 'Ethereum'], ['2', 'Base']]);
const message = { src: '1', dst: '2', usd: 1500, cre: false };

describe('launchAnnouncement', () => {
  it('names the lane and the value', () => {
    // #given, #when, #then
    expect(launchAnnouncement(names, message)).toBe('Ethereum → Base, $1.5K');
  });

  it('adds that a CRE workflow sent the message', () => {
    // #given, #when, #then
    expect(launchAnnouncement(names, { ...message, cre: true })).toBe('Ethereum → Base, $1.5K, sent by a CRE workflow');
  });

  it('names the CRE sender of a data-only message without a value', () => {
    // #given, #when, #then
    expect(launchAnnouncement(names, { ...message, usd: null, cre: true })).toBe('Ethereum → Base, sent by a CRE workflow');
  });
});
