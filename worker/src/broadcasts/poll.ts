import { addDays, dayOf, weekStart } from '@ccip-dev/core';
import { parsePollRecord, pollRecordKey } from '@ccip-dev/core/moments';
import type { RunContext } from '../context';
import * as store from '../store';
import { stopTelegramPoll } from '../telegram';
import { momentMode } from './outputs';

/**
 * Monday's early and 06:00 finalize run this before they publish moments.json: it closes last week's poll and keeps its
 * voter counts in the poll's record, so this week's card can show who called it. A poll that already has its counts is
 * skipped, so the 06:00 run only closes what the early run could not. A poll that cannot be closed (deleted, or a failed
 * call) keeps no counts and alerts; nothing here ever fails the finalize.
 */
export async function closeLastWeekPoll(c: RunContext): Promise<void> {
  const today = dayOf(c.deps.now());
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (weekStart(today) !== today || momentMode(c.env) === 'off' || !token) return;
  const monday = addDays(today, -7);
  const key = pollRecordKey(monday);
  let problem: string;
  try {
    const record = parsePollRecord(await store.getMeta(c.env.DB, key));
    if (record === null || record.voters !== undefined) return;
    const closed = await stopTelegramPoll(c.deps, { token, chatId: record.chat_id }, record.message_id);
    if ('problem' in closed) problem = `The poll of the week of ${monday} could not be closed, so its result posts without vote shares: ${closed.problem}`;
    else if (closed.voters.length !== record.options.length) {
      problem = `The poll of the week of ${monday} could not be closed, so its result posts without vote shares: Telegram counted ${closed.voters.length} options for ${record.options.length}`;
    } else {
      const saved = JSON.stringify({ ...record, voters: closed.voters, total_voters: closed.total });
      problem = `The poll of the week of ${monday} was closed, but its counts could not be saved, so its result posts without vote shares`;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await store.setMeta(c.env.DB, key, saved);
          return;
        } catch (err) {
          console.error(`[broadcast] saving ${key} failed (attempt ${attempt + 1})`, err instanceof Error ? err.name : 'error');
        }
      }
    }
  } catch (err) {
    problem = `The poll of the week of ${monday} could not be closed, so its result posts without vote shares: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    await c.alert(`poll-close:${monday}`, problem);
  } catch (alertErr) {
    console.error('[broadcast] the poll-close alert failed', alertErr instanceof Error ? alertErr.name : 'error');
  }
}
