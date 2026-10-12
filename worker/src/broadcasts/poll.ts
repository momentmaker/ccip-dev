import { addDays, dayOf, weekStart } from '@ccip-dev/core';
import { parsePollRecord, pollRecordKey } from '@ccip-dev/core/moments';
import type { RunContext } from '../context';
import * as store from '../store';
import { stopTelegramPoll } from '../telegram';
import { momentMode } from './outputs';

/**
 * Monday's early finalize runs this before it publishes moments.json: it closes last week's poll and keeps its voter
 * counts in the poll's record, so this week's card can show who called it. A poll that cannot be closed (deleted, or a
 * failed call) keeps no counts and alerts; nothing here ever fails the finalize.
 */
export async function closeLastWeekPoll(c: RunContext): Promise<void> {
  const today = dayOf(c.deps.now());
  const token = c.env.TELEGRAM_BOT_TOKEN;
  if (weekStart(today) !== today || momentMode(c.env) === 'off' || !token) return;
  const monday = addDays(today, -7);
  const key = pollRecordKey(monday);
  let problem: string | null;
  try {
    const record = parsePollRecord(await store.getMeta(c.env.DB, key));
    if (record === null || record.voters !== undefined) return;
    const closed = await stopTelegramPoll(c.deps, { token, chatId: record.chat_id }, record.message_id);
    if ('problem' in closed) problem = closed.problem;
    else if (closed.voters.length !== record.options.length) problem = `Telegram counted ${closed.voters.length} options for ${record.options.length}`;
    else {
      await store.setMeta(c.env.DB, key, JSON.stringify({ ...record, voters: closed.voters, total_voters: closed.total }));
      return;
    }
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }
  try {
    await c.alert(`poll-close:${monday}`, `The poll of the week of ${monday} could not be closed, so its result posts without vote shares: ${problem}`);
  } catch (alertErr) {
    console.error('[broadcast] the poll-close alert failed', alertErr instanceof Error ? alertErr.name : 'error');
  }
}
