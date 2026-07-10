/** Parse `X-Tz-Offset-Minutes` (Dart `DateTime.timeZoneOffset.inMinutes`). */
export function parseTzOffsetMinutes(value: string | string[] | undefined | null): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || String(raw).trim() === "") {
    return 0;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(-840, Math.min(840, Math.round(n)));
}
