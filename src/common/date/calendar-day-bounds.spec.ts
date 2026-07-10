import {
  calendarDayBounds,
  localDateKeyFromInstant,
  resolveClientDateKey,
} from "./calendar-day-bounds";

describe("calendarDayBounds", () => {
  it("uses UTC midnight bounds when offset is 0", () => {
    const { start, end } = calendarDayBounds("2026-06-18", 0);
    expect(start.toISOString()).toBe("2026-06-18T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-18T23:59:59.999Z");
  });

  it("includes early-morning VN local logs on the local calendar day (UTC+7)", () => {
    const { start, end } = calendarDayBounds("2026-06-18", 420);
    const startedAt = new Date("2026-06-17T18:30:00.000Z");
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(startedAt.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(start.toISOString()).toBe("2026-06-17T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-18T16:59:59.999Z");
  });

  it("maps instant to local date key with offset", () => {
    const instant = new Date("2026-06-17T18:30:00.000Z");
    expect(localDateKeyFromInstant(instant, 420)).toBe("2026-06-18");
    expect(localDateKeyFromInstant(instant, 0)).toBe("2026-06-17");
  });

  it("resolveClientDateKey prefers explicit date", () => {
    expect(resolveClientDateKey("2026-06-17", 420)).toBe("2026-06-17");
    expect(resolveClientDateKey(" 2026-06-17 ", 420)).toBe("2026-06-17");
  });
});
