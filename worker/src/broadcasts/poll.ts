import { addDays, dayOf, weekStart } from '@ccip-dev/core';
import { parsePollRecord, pollRecordKey, type PollRecord } from '@ccip-dev/core/moments';
import type { RunContext } from '../context';
import * as store from '../store';
import { stopTelegramPoll } from '../telegram';

/** How many weeks before this one a finalize looks back for a poll still open. */
export const CLOSE_WEEKS = 8;

/**
 * Each early and 06:00 finalize runs this before it publishes moments.json: it closes every poll of the 8 weeks before this
 * one that is still open in its record, oldest first, and keeps the counts in the record, so the next poll card can show
 * who called it. Closing posts nothing, so it runs whatever BROADCASTS and MOMENTS say: switching moments off must not leave
 * a public poll open. A poll Telegram had already closed, or whose message is gone, is marked closed without counts and
 * alerts once. Any other failure keeps no counts and alerts, and the next finalize tries again. Nothing here ever fails
 * the finalize.
 */
export async function closeOpenPolls(c: RunContext): Promise<void> {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const thisWeek = weekStart(dayOf(c.deps.now()));
  const mondays = Array.from({ length: CLOSE_WEEKS }, (_, i) => addDays(thisWeek, -7 * (CLOSE_WEEKS - i)));
  let records: Map<string, string>;
  try {
    records = await store.getMetas(c.env.DB, mondays.map(pollRecordKey));
  } catch (err) {
    await alertPollClose(c, mondays.at(-1)!, `The polls of the ${CLOSE_WEEKS} weeks before ${thisWeek} could not be read, so none was closed: ${errorText(err)}`);
    return;
  }
  for (const monday of mondays) {
    const record = parsePollRecord(records.get(pollRecordKey(monday)) ?? null);
    if (record !== null && record.voters === undefined && record.closed === undefined) await closePoll(c, token, monday, record);
  }
}

async function closePoll(c: RunContext, token: string, monday: string, record: PollRecord): Promise<void> {
  let problem: string;
  try {
    const closed = await stopTelegramPoll(c.deps, { token, chatId: record.chat_id }, record.message_id);
    if ('unavailable' in closed) {
      const marked = await saveRecord(c, monday, { ...record, closed: 'unavailable' });
      problem = `The poll of the week of ${monday} was already closed or deleted, so its votes cannot be read and its result posts without vote shares${marked ? '' : '; its record could not be marked, so the next finalize tries again'}: ${closed.unavailable}`;
    } else if ('problem' in closed) problem = `The poll of the week of ${monday} could not be closed, so its result posts without vote shares: ${closed.problem}`;
    else if (closed.voters.length !== record.options.length) {
      problem = `The poll of the week of ${monday} could not be closed, so its result posts without vote shares: Telegram counted ${closed.voters.length} options for ${record.options.length}`;
    } else {
      if (await saveRecord(c, monday, { ...record, voters: closed.voters, total_voters: closed.total })) return;
      problem = `The poll of the week of ${monday} was closed, but its counts could not be saved, so its result posts without vote shares`;
    }
  } catch (err) {
    problem = `The poll of the week of ${monday} could not be closed, so its result posts without vote shares: ${errorText(err)}`;
  }
  await alertPollClose(c, monday, problem);
}

/** Writes the poll's record, with one retry; false when both writes failed. */
async function saveRecord(c: RunContext, monday: string, record: PollRecord): Promise<boolean> {
  const key = pollRecordKey(monday);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await store.setMeta(c.env.DB, key, JSON.stringify(record));
      return true;
    } catch (err) {
      console.error(`[broadcast] saving ${key} failed (attempt ${attempt + 1})`, err instanceof Error ? err.name : 'error');
    }
  }
  return false;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function alertPollClose(c: RunContext, monday: string, problem: string): Promise<void> {
  try {
    await c.alert(`poll-close:${monday}`, problem);
  } catch (alertErr) {
    console.error('[broadcast] the poll-close alert failed', alertErr instanceof Error ? alertErr.name : 'error');
  }
}
