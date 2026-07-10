import { describe, expect, it } from "@jest/globals";
import { calculateCaloriesBurned } from "./calories.util";

describe("calculateCaloriesBurned", () => {  it("uses MET and weight", () => {
    expect(
      calculateCaloriesBurned({
        met: 8,
        defaultCalPerMin: null,
        weightKg: 65,
        minutesPerformed: 30,
      }),
    ).toBe(260);
  });

  it("uses DefaultCalPerMin when MET path unavailable", () => {
    expect(
      calculateCaloriesBurned({
        met: null,
        defaultCalPerMin: 10,
        weightKg: null,
        minutesPerformed: 20,
      }),
    ).toBe(200);
  });

  it("throws when insufficient data", () => {
    expect(() =>
      calculateCaloriesBurned({
        met: null,
        defaultCalPerMin: null,
        weightKg: 70,
        minutesPerformed: 15,
      }),
    ).toThrow();
  });
});
