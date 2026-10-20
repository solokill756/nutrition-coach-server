import { minutesFrom } from "./ai-minutes";

describe("minutesFrom", () => {
  it.each([
    [10, 10],
    [7.6, 8],
    ["10", 10],
    ["10 minutes", 10],
    ["2 minutes", 2],
    ["5 mins.", 5],
    ["1 minute", 1],
    ["1 hour", 60],
    ["1.5 hours", 90],
    ["1 hr 15 min", 75],
    ["1h30m", 90],
    ["PT10M", 10],
    ["  20 Minutes ", 20],
  ])("reads %p as %p minutes", (input, expected) => {
    expect(minutesFrom(input)).toBe(expected);
  });

  it.each([[undefined], [null], [""], ["about a while"], [-5], [Number.NaN], [{}]])(
    "gives null for %p",
    (input) => {
      expect(minutesFrom(input)).toBeNull();
    },
  );
});
