const hexBytes = (hex: string): Uint8Array | null => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
};

let keyWarned = false;

/** A malformed key refuses every request, which is said once per isolate, never with the key. */
function warnMalformedKey(): void {
  if (keyWarned) return;
  keyWarned = true;
  console.warn('DISCORD_PUBLIC_KEY is unset or not 64 hex characters: every interaction is refused with 401');
}

/**
 * Discord signs each interaction with Ed25519 over the timestamp header followed by the raw body. A missing header,
 * malformed hex or a bad signature is false; workerd's crypto.subtle verifies Ed25519 itself.
 */
export async function verifyDiscordRequest(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, body: string): Promise<boolean> {
  const key = hexBytes(publicKeyHex);
  if (!key || key.length !== 32) {
    warnMalformedKey();
    return false;
  }
  const signature = signatureHex ? hexBytes(signatureHex) : null;
  if (!signature || signature.length !== 64 || !timestamp) return false;
  try {
    const publicKey = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', publicKey, signature, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}
