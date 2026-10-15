import { describe, expect, it } from 'vitest';
import { LAUNCH_MAX_AGE_S, verifyLaunchData } from '../src/telegram-auth';
import { BOT_TOKEN, signedLaunch, TG_USER } from './helpers';

const NOW_S = 1_791_892_245;
const NOW_MS = NOW_S * 1000;

describe('Mini App launch data', () => {
  it("accepts Telegram's own example, signed with its example token", async () => {
    // #given the example from the telegram-apps docs (docs.telegram-mini-apps.com, init data validation)
    const initData =
      'query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2';
    // #when
    const launch = await verifyLaunchData(initData, '5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8', 1_662_771_708_000);
    // #then
    expect([launch?.user.id, launch?.user.first_name, launch?.authDate]).toEqual([279058397, 'Vladislav', 1662771648]);
  });

  it('accepts fresh launch data with every field signed, the signature field included', async () => {
    // #given
    const initData = await signedLaunch(TG_USER, NOW_S - 60, BOT_TOKEN, { signature: 'abc', start_param: 'enlist' });
    // #when
    const launch = await verifyLaunchData(initData, BOT_TOKEN, NOW_MS);
    // #then
    expect(launch).toEqual({ user: TG_USER, authDate: NOW_S - 60 });
  });

  it('refuses launch data older than 24 hours, or from more than five minutes ahead', async () => {
    // #given
    const [stale, edge, ahead] = await Promise.all([signedLaunch(TG_USER, NOW_S - LAUNCH_MAX_AGE_S - 1), signedLaunch(TG_USER, NOW_S - LAUNCH_MAX_AGE_S), signedLaunch(TG_USER, NOW_S + 301)]);
    // #when
    const results = await Promise.all([stale, edge, ahead].map((d) => verifyLaunchData(d, BOT_TOKEN, NOW_MS)));
    // #then
    expect(results.map((r) => r?.user.id ?? null)).toEqual([null, TG_USER.id, null]);
  });

  it('refuses tampered launch data: another user swapped in after signing', async () => {
    // #given
    const signed = new URLSearchParams(await signedLaunch(TG_USER, NOW_S));
    signed.set('user', JSON.stringify({ ...TG_USER, id: 1 }));
    // #then
    expect(await verifyLaunchData(signed.toString(), BOT_TOKEN, NOW_MS)).toBeNull();
  });

  it("refuses launch data signed with another bot's token", async () => {
    // #given
    const initData = await signedLaunch(TG_USER, NOW_S, '999:another-bot');
    // #then
    expect(await verifyLaunchData(initData, BOT_TOKEN, NOW_MS)).toBeNull();
  });

  it('refuses missing launch data, a missing or malformed hash, and a missing token', async () => {
    // #given
    const signed = new URLSearchParams(await signedLaunch(TG_USER, NOW_S));
    const noHash = new URLSearchParams(signed);
    noHash.delete('hash');
    const shortHash = new URLSearchParams(signed);
    shortHash.set('hash', 'abc');
    // #when
    const results = await Promise.all([
      verifyLaunchData('', BOT_TOKEN, NOW_MS),
      verifyLaunchData(noHash.toString(), BOT_TOKEN, NOW_MS),
      verifyLaunchData(shortHash.toString(), BOT_TOKEN, NOW_MS),
      verifyLaunchData(signed.toString(), '', NOW_MS),
    ]);
    // #then
    expect(results).toEqual([null, null, null, null]);
  });

  it('refuses signed launch data without a usable user', async () => {
    // #given
    const [noName, textId] = await Promise.all([signedLaunch({ id: 5 }, NOW_S), signedLaunch({ id: '5', first_name: 'x' }, NOW_S)]);
    // #then
    expect([await verifyLaunchData(noName, BOT_TOKEN, NOW_MS), await verifyLaunchData(textId, BOT_TOKEN, NOW_MS)]).toEqual([null, null]);
  });
  it('refuses a duplicate hash key, whichever comes first', async () => {
    // #given
    const signed = await signedLaunch(TG_USER, NOW_S);
    const bogus = `hash=${'0'.repeat(64)}`;
    // #then
    expect([await verifyLaunchData(`${signed}&${bogus}`, BOT_TOKEN, NOW_MS), await verifyLaunchData(`${bogus}&${signed}`, BOT_TOKEN, NOW_MS)]).toEqual([null, null]);
  });

  it('refuses signed launch data whose user is missing or is not JSON', async () => {
    // #given
    const [missing, notJson] = await Promise.all([signedLaunch(TG_USER, NOW_S, BOT_TOKEN, { user: null }), signedLaunch(TG_USER, NOW_S, BOT_TOKEN, { user: 'not json' })]);
    // #then
    expect([await verifyLaunchData(missing, BOT_TOKEN, NOW_MS), await verifyLaunchData(notJson, BOT_TOKEN, NOW_MS)]).toEqual([null, null]);
  });

  it('refuses signed launch data whose auth_date is missing or is not a number', async () => {
    // #given
    const [missing, text] = await Promise.all([signedLaunch(TG_USER, NOW_S, BOT_TOKEN, { auth_date: null }), signedLaunch(TG_USER, NOW_S, BOT_TOKEN, { auth_date: 'soon' })]);
    // #then
    expect([await verifyLaunchData(missing, BOT_TOKEN, NOW_MS), await verifyLaunchData(text, BOT_TOKEN, NOW_MS)]).toEqual([null, null]);
  });

  it('refuses launch data whose auth_date was changed after signing, even to a fresher one', async () => {
    // #given
    const signed = new URLSearchParams(await signedLaunch(TG_USER, NOW_S - 3600));
    signed.set('auth_date', String(NOW_S));
    // #then
    expect(await verifyLaunchData(signed.toString(), BOT_TOKEN, NOW_MS)).toBeNull();
  });

  it('refuses signed launch data longer than 8192 characters, and takes it at exactly 8192', async () => {
    // #given
    const bare = (await signedLaunch(TG_USER, NOW_S, BOT_TOKEN, { pad: '' })).length;
    const [atLimit, overLimit] = await Promise.all([8192, 8193].map((length) => signedLaunch(TG_USER, NOW_S, BOT_TOKEN, { pad: 'x'.repeat(length - bare) })));
    // #then
    expect([atLimit.length, overLimit.length, (await verifyLaunchData(atLimit, BOT_TOKEN, NOW_MS))?.user.id ?? null, await verifyLaunchData(overLimit, BOT_TOKEN, NOW_MS)]).toEqual([8192, 8193, TG_USER.id, null]);
  });
});
