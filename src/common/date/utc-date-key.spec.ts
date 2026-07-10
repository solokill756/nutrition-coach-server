import { utcDateKey } from "./utc-date-key";

describe("utcDateKey", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns YYYY-MM-DD in UTC for a provided date", () => {
    const d = new Date("2026-05-31T23:30:00.000-07:00");
    expect(utcDateKey(d)).toBe("2026-06-01");
  });

  it("returns today's UTC key when date is omitted", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-31T10:00:00.000Z"));

    expect(utcDateKey()).toBe("2026-05-31");
  });
});
