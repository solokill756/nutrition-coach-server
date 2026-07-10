import { BadRequestException } from "@nestjs/common";
import { diaryBestStreak, diaryCurrentStreak, ProgressService } from "./progress.service";

describe("ProgressService streak helpers", () => {
  it("diaryCurrentStreak counts backward from anchor", () => {
    const m = new Map<string, boolean>([
      ["2026-05-10", true],
      ["2026-05-11", true],
      ["2026-05-12", false],
      ["2026-05-13", true],
    ]);
    expect(diaryCurrentStreak(m, "2026-05-13", "2026-05-01")).toBe(1);
    expect(diaryCurrentStreak(m, "2026-05-11", "2026-05-01")).toBe(2);
  });

  it("diaryBestStreak finds longest run", () => {
    const m = new Map<string, boolean>([
      ["2026-05-01", true],
      ["2026-05-02", true],
      ["2026-05-04", true],
      ["2026-05-05", true],
      ["2026-05-06", true],
    ]);
    expect(diaryBestStreak(m)).toBe(3);
  });
});

function createProgressService() {
  const diaryService: any = {
    getRange: jest.fn().mockResolvedValue([
      { date: "2026-05-30", totalCalories: 2000, exerciseCaloriesBurned: 300 },
      { date: "2026-05-31", totalCalories: 2200, exerciseCaloriesBurned: 100 },
    ]),
  };
  const waterRepo: any = {
    find: jest.fn().mockResolvedValue([
      { date: "2026-05-30", amountMl: 1800 },
      { date: "2026-05-31", amountMl: 1000 },
    ]),
  };
  const statusRepo: any = {
    find: jest.fn().mockResolvedValue([
      { date: "2026-05-30", isCompleted: true },
      { date: "2026-05-31", isCompleted: true },
    ]),
  };
  const goalRepo: any = {
    findOne: jest.fn().mockResolvedValue({ targetCalories: 2300 }),
  };
  const weightService: any = {
    latestByDay: jest.fn().mockResolvedValue(new Map([["2026-05-31", 61.2]])),
  };
  const hydrationTargetService: any = {
    getTargetMlForUser: jest.fn().mockResolvedValue(2000),
  };

  const service = new ProgressService(
    diaryService,
    waterRepo,
    statusRepo,
    goalRepo,
    weightService,
    hydrationTargetService,
  );

  return { service, diaryService };
}

describe("ProgressService getTrends", () => {
  it("throws for invalid date format", async () => {
    const { service } = createProgressService();
    await expect(service.getTrends(1, "2026/05/01", "2026-05-31")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws when from > to", async () => {
    const { service } = createProgressService();
    await expect(service.getTrends(1, "2026-06-01", "2026-05-31")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("builds trend rows and summary", async () => {
    const { service } = createProgressService();
    const out = await service.getTrends(1, "2026-05-30", "2026-05-31");

    expect(out.days).toHaveLength(2);
    expect(out.days[0]).toMatchObject({
      date: "2026-05-30",
      caloriesIn: 2000,
      caloriesBurned: 300,
      netCalories: 1700,
      waterMl: 1800,
      diaryCompleted: true,
      calorieTarget: 2300,
    });
    expect(out.days[1].weightKg).toBe(61.2);
    expect(out.summary.bestStreak).toBeGreaterThanOrEqual(1);
    expect(out.summary.adherenceScore).toBeGreaterThan(0);
  });
});
