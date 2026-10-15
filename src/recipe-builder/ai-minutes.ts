const UNIT = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)(?![a-z])/g;

/**
 * Reads a duration the LLM wrote, as whole minutes. Models answer with 10,
 * "10", "10 minutes", "1 hour", "1h30m" or "PT10M" even when asked for a
 * number; anything without a readable amount is null.
 */
export function minutesFrom(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text));

  let total = 0;
  let found = false;
  for (const [, amount, unit] of text.matchAll(UNIT)) {
    found = true;
    total += Number(amount) * (unit.startsWith("h") ? 60 : 1);
  }
  return found ? Math.round(total) : null;
}
