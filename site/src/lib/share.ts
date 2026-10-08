import { X_HANDLE } from '../config';

export function shareText(headline: string): string {
  return `${headline} — via @${X_HANDLE}`;
}

export function xIntentUrl(text: string, url: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export function menuShift(left: number, right: number, viewportWidth: number, margin: number): number {
  if (left < margin) return margin - left;
  if (right > viewportWidth - margin) return viewportWidth - margin - right;
  return 0;
}
