// A CCIP API cursor is the base58 (Bitcoin alphabet) encoding of a UTF-8 query string such as
// `environment=mainnet&oldestSeenTimestamp=<ms>&oldestSeenMessageId=0x…&totalCount=1000&isCountCapped=true`.
// For the backfill only: the Worker never decodes or crafts cursors.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function decodeCursor(cursor: string): URLSearchParams {
  return new URLSearchParams(new TextDecoder().decode(base58Decode(cursor)));
}

export function encodeCursor(params: URLSearchParams): string {
  return base58Encode(new TextEncoder().encode(params.toString()));
}

export function cursorAt(cursor: string, sendTimestampMs: number, messageId: string): string {
  const params = decodeCursor(cursor);
  params.set('oldestSeenTimestamp', String(sendTimestampMs));
  params.set('oldestSeenMessageId', messageId);
  return encodeCursor(params);
}

function base58Decode(text: string): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error(`cursor is not base58: unexpected character "${char}"`);
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  const leadingZeros = text.length - text.replace(/^1+/, '').length;
  return Uint8Array.from([...new Array<number>(leadingZeros).fill(0), ...bytes]);
}

function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let text = '';
  for (; value > 0n; value /= 58n) text = ALPHABET[Number(value % 58n)] + text;
  const leadingZeros = bytes.findIndex((byte) => byte !== 0);
  return '1'.repeat(leadingZeros === -1 ? bytes.length : leadingZeros) + text;
}
