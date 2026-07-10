import {
  buildConditionRelatedThresholds,
  formatThresholdMinMax,
} from "./condition-related-thresholds";

const normalize = (n: string) => n.trim().replace(/[_\s-]/g, "").toLowerCase();

describe("buildConditionRelatedThresholds", () => {
  it("returns empty when user has no matching condition rules", () => {
    expect(
      buildConditionRelatedThresholds(
        ["hypertension"],
        [{ nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg" }],
        [],
        normalize,
      ),
    ).toEqual([]);
  });

  it("keeps only nutrients linked to active conditions with user min/max", () => {
    const out = buildConditionRelatedThresholds(
      ["diabetes"],
      [
        { nutrient: "sodium", minAmount: null, maxAmount: 2300, unit: "mg" },
        { nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g" },
        { nutrient: "protein", minAmount: 80, maxAmount: 120, unit: "g" },
      ],
      [
        { conditionKey: "diabetes", nutrient: "carbs", minAmount: 130, maxAmount: null, unit: "g" },
        { conditionKey: "diabetes", nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g" },
      ],
      normalize,
    );

    expect(out).toEqual([
      { nutrient: "sugars", minAmount: null, maxAmount: 25, unit: "g" },
      { nutrient: "carbs", minAmount: 130, maxAmount: null, unit: "g" },
    ]);
  });

  it("falls back to rule min/max when user threshold row is missing", () => {
    const out = buildConditionRelatedThresholds(
      ["hypertension"],
      [{ nutrient: "protein", minAmount: 80, maxAmount: 120, unit: "g" }],
      [{ conditionKey: "hypertension", nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg" }],
      normalize,
    );

    expect(out).toEqual([
      { nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg" },
    ]);
  });
});

describe("formatThresholdMinMax", () => {
  it("formats min and max with unit", () => {
    expect(
      formatThresholdMinMax({ nutrient: "sodium", minAmount: 500, maxAmount: 1500, unit: "mg" }),
    ).toBe("sodium min 500 mg max 1500 mg");
  });
});
