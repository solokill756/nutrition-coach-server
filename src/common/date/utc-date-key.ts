/** UTC calendar date YYYY-MM-DD — align with DiaryService / dashboard water row. */
export function utcDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
