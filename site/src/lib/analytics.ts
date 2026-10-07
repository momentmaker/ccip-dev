type EventData = Record<string, string | number | boolean>;

interface Umami {
  track(event: string, data?: EventData): void;
}

const reportedFiles = new Set<string>();

export function track(event: string, data?: EventData): void {
  const umami = (globalThis as { window?: { umami?: Umami } }).window?.umami;
  if (!umami) return;
  try {
    umami.track(event, data);
  } catch (err) {
    console.warn(`analytics event ${event} failed`, err);
  }
}

export function trackDataError(file: string): void {
  if (reportedFiles.has(file)) return;
  reportedFiles.add(file);
  track('data_error', { file });
}
