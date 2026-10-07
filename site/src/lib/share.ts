import { X_HANDLE } from '../config';

export function shareText(headline: string): string {
  return `${headline} — via @${X_HANDLE}`;
}

export function xIntentUrl(text: string, url: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}
