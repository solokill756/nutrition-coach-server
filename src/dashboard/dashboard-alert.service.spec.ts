import { DashboardAlertService, DashboardDailyTotals } from "./dashboard-alert.service";
import { UserNutritionalThresholdEntity } from "../nutrition/entities/user-nutritional-threshold.entity";

function threshold(
  nutrient: string,
  options: { min?: number | null; max?: number | null; unit?: string } = {},
): UserNutritionalThresholdEntity {
  return {
    nutrient,
    minAmount: options.min ?? null,
    maxAmount: options.max ?? null,
    unit: options.unit ?? "g",
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

  it("creates warning alerts for calcium and iron below minimum targets", () => {
    const alerts = service.buildDailyAlerts(
      "2026-05-22",
      totals({ calcium: 600, iron: 8 }),
      [
        threshold("calcium", { min: 1000, unit: "mg" }),
        threshold("iron", { min: 18, unit: "mg" }),
      ],
    );

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nutrientType: "calcium",
          severity: "warning",
          title: "Low Calcium",
        }),
        expect.objectContaining({
          nutrientType: "iron",
          severity: "warning",
          title: "Low Iron",
        }),
      ]),
    );
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
});
