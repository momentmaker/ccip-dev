import { beforeEach, describe, expect, it } from 'vitest';
import { cardText, dogtagCommand, enlistCommand } from '../src/marines';
import { command, fakeBot, resetStorage } from './helpers';

beforeEach(resetStorage);

describe('the sticker pack on a posted Discord card', () => {
  it('names the Marine’s pack under the callsign once LinkMarines is on Telegram, with no preview', async () => {
    // #given
    const bot = fakeBot({ telegramOpen: true });
    // #when
    await enlistCommand(bot, command('enlist'));
    await dogtagCommand(bot, command('dogtag'));
    // #then
    const posted = bot.discord.calls.filter((c) => c.file).map((c) => c.content.split('\n')[1]);
    expect(posted).toEqual(Array(2).fill('🎖 Sticker: LinkMarines Vol. 1 <https://t.me/addstickers/linkmarines_by_ccipdevbot>'));
  });

  it('carries the callsign alone while it is off, and names Vol. 2 from serial 121', () => {
    // #then
    expect([cardText({ telegramOpen: false }, { callsign: 'sergey-pepe-comfy', serial: 7 }), cardText({ telegramOpen: true }, { callsign: 'sergey-pepe-comfy', serial: 121 })]).toEqual([
      'sergey-pepe-comfy',
      'sergey-pepe-comfy\n🎖 Sticker: LinkMarines Vol. 2 <https://t.me/addstickers/linkmarines2_by_ccipdevbot>',
    ]);
  });
});
