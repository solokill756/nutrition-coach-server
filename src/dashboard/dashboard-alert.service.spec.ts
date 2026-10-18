import { DashboardAlertService, DashboardDailyTotals } from "./dashboard-alert.service";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";

function threshold(
  nutrient: string,
  options: { min?: number | null; max?: number | null; unit?: string; origin?: string; sourceConditionKey?: string | null } = {},
): UserNutritionalThresholdEntity {
  return {
    nutrient,
    minAmount: options.min ?? null,
    maxAmount: options.max ?? null,
    unit: options.unit ?? "g",
    origin: options.origin,
    sourceConditionKey: options.sourceConditionKey,
  } as UserNutritionalThresholdEntity;
}

function totals(overrides: Partial<DashboardDailyTotals> = {}): DashboardDailyTotals {
  return {
    calories: 1000,
    protein: 80,
    carbs: 120,
    fat: 40,
    sodium: 1000,
    fiber: 25,
    sugars: 20,
    saturatedFat: 8,
    cholesterol: 100,
    potassium: 4000,
    calcium: 800,
    iron: 12,
    phosphorus: 500,
    ...overrides,
  };
}

describe("DashboardAlertService", () => {
  const service = new DashboardAlertService();

  it("returns no alerts without thresholds", () => {
    expect(service.buildDailyAlerts("2026-05-22", totals(), [])).toEqual([]);
  });

  it("does not create an alert below or at the limit", () => {
    const alerts = service.buildDailyAlerts("2026-05-22", totals({ sodium: 1863 }), [
      threshold("sodium", { max: 2300, unit: "mg" }),
    ]);

    expect(alerts).toEqual([]);
    expect(
      service.buildDailyAlerts("2026-05-22", totals({ sodium: 2300 }), [
        threshold("sodium", { max: 2300, unit: "mg" }),
      ]),
    ).toEqual([]);
  });

  it("creates a sodium critical alert above the limit", () => {
    const alerts = service.buildDailyAlerts("2026-05-22", totals({ sodium: 2323 }), [
      threshold("sodium", { max: 2300, unit: "mg" }),
    ]);

    expect(alerts[0]).toMatchObject({
      type: "red",
      severity: "critical",
      nutrientType: "sodium",
      percent: 101,
    });
  });

  it("creates saturated fat and cholesterol alerts with units", () => {
    const alerts = service.buildDailyAlerts(
      "2026-05-22",
      totals({ saturatedFat: 21, cholesterol: 320 }),
      [
        threshold("saturatedFat", { max: 20, unit: "g" }),
        threshold("cholesterol", { max: 300, unit: "mg" }),
      ],
    );

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nutrientType: "saturatedFat", severity: "critical", unit: "g" }),
        expect.objectContaining({ nutrientType: "cholesterol", severity: "critical", unit: "mg" }),
      ]),
    );
  });

  it("creates warning alert for protein below minimum target", () => {
    const alerts = service.buildDailyAlerts(
      "2026-05-22",
      totals({ protein: 50 }),
      [
        threshold("protein", { min: 100, unit: "g" }),
      ],
    );

    expect(alerts).toEqual([
      expect.objectContaining({
        nutrientType: "protein",
        severity: "warning",
        title: "Low Protein",
      }),
    ]);
  });

  it("creates warning alerts for fiber and potassium below minimum targets", () => {
    const alerts = service.buildDailyAlerts(
      "2026-05-22",
      totals({ fiber: 10, potassium: 2500 }),
      [
        threshold("fiber", { min: 25, unit: "g" }),
        threshold("potassium", { min: 4700, unit: "mg" }),
      ],
    );

    expect(alerts).toEqual([
      expect.objectContaining({
        id: "2026-05-22:fiber:min",
        type: "yellow",
        severity: "warning",
        nutrientType: "fiber",
        title: "Low Fiber",
        message: "Fiber is below your daily target (10/25 g).",
        percent: 40,
      }),
      expect.objectContaining({
        id: "2026-05-22:potassium:min",
        type: "yellow",
        severity: "warning",
        nutrientType: "potassium",
        title: "Low Potassium",
        message: "Potassium is below your daily target (2500/4700 mg).",
        percent: 53,
      }),
    ]);
  });

  it("does not create fiber or potassium alerts at or above minimum targets", () => {
    const alerts = service.buildDailyAlerts(
      "2026-05-22",
      totals({ fiber: 25, potassium: 4700 }),
      [
        threshold("fiber", { min: 25, unit: "g" }),
        threshold("potassium", { min: 4700, unit: "mg" }),
      ],
    );

    expect(alerts).toEqual([]);
  });

  it("creates sugar critical alerts when above max threshold", () => {
    const alerts = service.buildDailyAlerts("2026-05-22", totals({ sugars: 60 }), [
      threshold("sugars", { max: 50, unit: "g" }),
    ]);

    expect(alerts).toEqual([
      expect.objectContaining({
        nutrientType: "sugars",
        severity: "critical",
        title: "High Sugars",
      }),
    ]);
  });

  it("does not alert on micronutrients below their minimum", () => {
    expect(service.buildDailyAlerts("2026-05-22", totals({ calcium: 600, iron: 8 }), [
      threshold("calcium", { min: 1000, unit: "mg" }),
      threshold("iron", { min: 18, unit: "mg" }),
      threshold("vitaminC", { min: 90, unit: "mg" }),
    ])).toEqual([]);
  });

  it("creates a High Protein alert when the max comes from a condition rule", () => {
    const alerts = service.buildDailyAlerts("2026-05-22", totals({ protein: 80 }), [
      threshold("protein", { max: 70, unit: "g", origin: "admin_rule", sourceConditionKey: "kidney_disease" }),
    ]);
    expect(alerts).toEqual([expect.objectContaining({
      id: "2026-05-22:protein:max", severity: "critical", title: "High Protein", limit: 70,
    })]);
  });

  it("ignores a stale sourceConditionKey on a system protein row", () => {
    expect(service.buildDailyAlerts("2026-05-22", totals({ protein: 130 }), [
      threshold("protein", { max: 112, min: 90, unit: "g", origin: "system", sourceConditionKey: "kidney_disease" }),
    ])).toEqual([]);
  });

  it("ignores the system protein max but still warns below the protein min", () => {
    expect(service.buildDailyAlerts("2026-05-22", totals({ protein: 130 }), [
      threshold("protein", { min: 90, max: 112, unit: "g", origin: "system" }),
    ])).toEqual([]);
    expect(service.buildDailyAlerts("2026-05-22", totals({ protein: 50 }), [
      threshold("protein", { min: 90, max: 112, unit: "g", origin: "system" }),
    ])).toEqual([expect.objectContaining({ id: "2026-05-22:protein:min", title: "Low Protein" })]);
  });

  it("creates a High Phosphorus alert above the max", () => {
    expect(service.buildDailyAlerts("2026-05-22", totals({ phosphorus: 900 }), [
      threshold("phosphorus", { max: 800, unit: "mg", origin: "admin_rule", sourceConditionKey: "kidney_disease" }),
    ])).toEqual([expect.objectContaining({ id: "2026-05-22:phosphorus:max", title: "High Phosphorus", unit: "mg" })]);
  });

  it("does not alert when phosphorus is below the system min", () => {
    expect(service.buildDailyAlerts("2026-05-22", totals({ phosphorus: 300 }), [
      threshold("phosphorus", { min: 700, unit: "mg", origin: "system" }),
    ])).toEqual([]);
  });

  it("normalizes saturated fat threshold names", () => {
    const alerts = service.buildDailyAlerts("2026-05-22", totals({ saturatedFat: 21 }), [
      threshold("saturated_fat", { max: 20, unit: "g" }),
    ]);

    expect(alerts[0]).toMatchObject({
      nutrientType: "saturatedFat",
      severity: "critical",
    });
  });

  it("sorts by severity and nutrient priority, then limits to three alerts", () => {
    const alerts = service.buildDailyAlerts(
      "2026-05-22",
      totals({
        sodium: 2500,
        saturatedFat: 30,
        cholesterol: 400,
        calories: 2300,
        fiber: 10,
      }),
      [
        threshold("calories", { max: 2000, unit: "kcal" }),
        threshold("sodium", { max: 2300, unit: "mg" }),
        threshold("saturatedFat", { max: 20, unit: "g" }),
        threshold("cholesterol", { max: 300, unit: "mg" }),
        threshold("fiber", { min: 25, unit: "g" }),
      ],
    );

    expect(alerts.map((a) => a.nutrientType)).toEqual(["sodium", "saturatedFat", "cholesterol"]);
  });

  describe("buildHealthNutrients", () => {
    it("returns only the alerted bound per nutrient", () => {
      const out = service.buildHealthNutrients(totals({ fiber: 25, sodium: 1000, phosphorus: 500 }), [
        threshold("fiber", { min: 25, max: 40, unit: "g" }),
        threshold("sodium", { min: 500, max: 1500, unit: "mg" }),
        threshold("phosphorus", { min: 700, unit: "mg" }),
      ]);
      expect(out.fiber).toEqual({ current: 25, min: 25, max: null, unit: "g" });
      expect(out.sodium).toEqual({ current: 1000, min: null, max: 1500, unit: "mg" });
      expect(out.phosphorus).toEqual({ current: 500, min: null, max: null, unit: "mg" });
      expect(out.sugars).toEqual({ current: 20, min: null, max: null, unit: "g" });
    });

    it("matches aliased threshold names", () => {
      const out = service.buildHealthNutrients(totals(), [
        threshold("saturated_fat", { max: 20 }),
        threshold("dietary_fiber", { min: 28 }),
        threshold("Phosphorus", { max: 800, unit: "mg" }),
      ]);
      expect(out.saturatedFat.max).toBe(20);
      expect(out.fiber.min).toBe(28);
      expect(out.phosphorus.max).toBe(800);
    });

    it("returns null bounds for every nutrient without thresholds", () => {
      const out = service.buildHealthNutrients(totals(), []);
      for (const v of Object.values(out)) expect([v.min, v.max]).toEqual([null, null]);
      expect(Object.keys(out).sort()).toEqual([
        "cholesterol",
        "fiber",
        "phosphorus",
        "potassium",
        "saturatedFat",
        "sodium",
        "sugars",
      ]);
    });
  });
});
