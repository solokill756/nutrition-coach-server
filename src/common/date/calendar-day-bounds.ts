/** Client calendar day YYYY-MM-DD with optional tz offset (minutes east of UTC, Dart-compatible). */
export function normalizeDateKey(dateKey: string): string {
  const d = String(dateKey ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new Error(`Invalid dateKey: ${dateKey}`);
  }
  return d;
}

/**
 * Inclusive UTC instants for a client calendar day.
 * tzOffsetMinutes: same as `DateTime.timeZoneOffset.inMinutes` (UTC+7 => 420).
 */
export function calendarDayBounds(
  dateKey: string,
  tzOffsetMinutes = 0,
): { start: Date; end: Date } {
  const d = normalizeDateKey(dateKey);
  const offsetMs = tzOffsetMinutes * 60 * 1000;
  const start = new Date(Date.parse(`${d}T00:00:00.000Z`) - offsetMs);
  const end = new Date(Date.parse(`${d}T23:59:59.999Z`) - offsetMs);
  return { start, end };
}

/** Map an instant to the client's calendar date key. */
export function localDateKeyFromInstant(d: Date, tzOffsetMinutes = 0): string {
  const adjusted = new Date(d.getTime() + tzOffsetMinutes * 60 * 1000);
  return adjusted.toISOString().slice(0, 10);
}

export function localDateKeyNow(tzOffsetMinutes = 0): string {
  return localDateKeyFromInstant(new Date(), tzOffsetMinutes);
}

/** Client `YYYY-MM-DD` when provided; otherwise today's key in client timezone. */
export function resolveClientDateKey(
  clientDate?: string,
  tzOffsetMinutes = 0,
): string {
  const raw = String(clientDate ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  return localDateKeyNow(tzOffsetMinutes);
}

/** Iterate calendar date keys from `fromKey` through `toKey` (inclusive). */
export function eachCalendarDateKey(fromKey: string, toKey: string): string[] {
  const from = normalizeDateKey(fromKey);
  const to = normalizeDateKey(toKey);
  const out: string[] = [];
  let t = Date.parse(`${from}T12:00:00.000Z`);
  const end = Date.parse(`${to}T12:00:00.000Z`);
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}
