const MAX_TEXT_LENGTH = 3500;

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export async function sendTelegramMessage(
  fetchFn: typeof fetch,
  { token, chatId }: TelegramConfig,
  text: string,
): Promise<string | null> {
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, MAX_TEXT_LENGTH) }),
    });
    return res.ok ? null : `Telegram returned HTTP ${res.status}`;
  } catch (error) {
    return `Telegram request failed (${error instanceof Error ? error.name : 'unknown error'})`;
  }
}
