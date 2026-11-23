import type { PassportPostRecord, PassportSummaryRecord, PassportTokenRecord } from '@ccip-dev/core';
import { passportArrivalLines, passportChangeText, passportMoreText, passportPlace, passportPlural, passportSlug, passportSummaryParts } from '@ccip-dev/core/broadcasts';
import { formatUtcDay } from '@ccip-dev/core/format';
import type { ChainNames } from '@ccip-dev/core/names';
import { bold, TELEGRAM_CAPTION_MAX, tgText, type Copy } from './broadcasts/copy';
import type { PassportFacts } from './broadcasts/facts';

/** The index page, whose "Latest changes" list names every token a summary post covers. */
export const PASSPORT_INDEX_URL = 'https://ccip.dev/passport/';
const LATEST_CHANGES_URL = `${PASSPORT_INDEX_URL}#passport-latest`;

/** R22: the page a post links to: the token's page, or for the day's summary the index's latest-changes list. */
export function passportPostUrl(record: PassportPostRecord): string {
  return record.kind === 'token' ? `${PASSPORT_INDEX_URL}${passportSlug(record.groupId)}/` : LATEST_CHANGES_URL;
}

/** Every change of a token's post, one line each, in the record's order: flag changes, then arrivals with the flags they carry. */
function tokenItems(record: PassportTokenRecord, names: ChainNames): string[] {
  const changes = record.changes.map((ch) => passportChangeText({ ...passportPlace(ch.unit), kind: ch.kind, correction: ch.correction }, names));
  const arrivals = record.arrivals.flatMap((a) =>
    passportArrivalLines({ kind: a.kind, otherChainFlags: a.otherChainFlags, chains: a.chains.map((ch) => ({ chain: ch.chain, readable: ch.readable, flags: ch.flags.map(passportPlace) })) }, names));
  return [...changes, ...arrivals];
}

const summaryHead = (record: PassportSummaryRecord) =>
  `Token Passport · ${passportPlural(record.groupIds.length, 'more token')} on ${formatUtcDay(record.day)}`;

/**
 * The head, as many items as fit, a count of the rest when some are cut, and the link. Telegram counts its 1,024 after
 * removing tags; like the other captions, this measures the raw HTML, which is stricter.
 */
function fitList(head: string, items: readonly string[], link: string, more: (rest: number) => string): string {
  const caption = (shown: number) => {
    const rest = items.length - shown;
    return [head, ...items.slice(0, shown), ...(rest > 0 ? [more(rest)] : []), '', link].join('\n');
  };
  for (let shown = items.length; shown >= 0; shown--) {
    if (caption(shown).length <= TELEGRAM_CAPTION_MAX) return caption(shown);
  }
  throw new Error(`the Passport post does not fit even with no item: ${head.slice(0, 60)}…`);
}

/**
 * R22: the token's name, each change in plain words and the page link; the summary's count of tokens by kind of change
 * and the latest-changes link. Passport never posts to X (R24): the X text is empty, so an X output would refuse it.
 */
export function composePassportCopy(facts: PassportFacts): Copy {
  const { record, names } = facts;
  const link = passportPostUrl(record);
  const telegramHtml =
    record.kind === 'token'
      ? fitList(bold(tgText(`Token Passport · ${record.name}`)), tokenItems(record, names).map(tgText), link, passportMoreText)
      : fitList(bold(tgText(summaryHead(record))), [tgText(passportSummaryParts(record.counts).join(', '))], link, () => '');
  return { xText: '', telegramHtml };
}
