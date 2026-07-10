import { DiaryService } from "./diary.service";

function createService() {
  const logRepo: any = { find: jest.fn().mockResolvedValue([]) };
  const statusRepo: any = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((x) => x),
    save: jest.fn(),
  };
  const waterRepo: any = { findOne: jest.fn().mockResolvedValue({ amountMl: 500 }) };
  const exerciseLogRepo: any = { find: jest.fn().mockResolvedValue([]) };
  const exerciseRepo: any = { find: jest.fn().mockResolvedValue([]) };
  const logFoodService: any = {
    mapRowsToApiItems: jest.fn().mockResolvedValue([]),
    mealIntToSlug: jest.fn((m: number) => (m === 2 ? "lunch" : m === 3 ? "dinner" : m === 4 ? "snack" : "breakfast")),
  };
  const hydrationTargetService: any = { getTargetMlForUser: jest.fn().mockResolvedValue(2000) };
  const goalRepo: any = {
    findOne: jest.fn().mockResolvedValue({ targetCalories: 2000 }),
  };

  const service = new DiaryService(
    logRepo,
    statusRepo,
    waterRepo,
    exerciseLogRepo,
    exerciseRepo,
    goalRepo,
    logFoodService,
    hydrationTargetService,
  );

  return {
    service,
    logRepo,
    statusRepo,
    waterRepo,
    exerciseLogRepo,
    exerciseRepo,
    logFoodService,
  };
}

describe("DiaryService", () => {
  it("getDay aggregates meal and nutrition totals", async () => {
    const { service, logRepo, logFoodService } = createService();
    const rows = [
      {
        meal: 1,
        calories: "300",
        proteinG: "10",
        totalCarbohydratesG: "40",
        totalFatG: "8",
        sodiumMg: "100",
        dietaryFibersG: "5",
        sugarsG: "6",
        saturatedFatG: "2",
        cholesterolMg: "10",
        potassiumMg: "200",
        loggedAt: new Date("2026-05-31T09:00:00.000Z"),
      },
    ];
    logRepo.find.mockResolvedValueOnce(rows);
    logFoodService.mapRowsToApiItems.mockResolvedValueOnce([{ id: 1, foodName: "A" }]);

    const out = await service.getDay(1, "2026-05-31");
    expect(out.totalCalories).toBe(300);
    expect(out.targetCalories).toBe(2000);
    expect(out.caloriesRemaining).toBe(1700);
    expect((out.mealGroups as any[])[0].logs).toHaveLength(1);
    expect((out.waterLog as any).targetMl).toBe(2000);
  });

  it("getRange returns day-by-day aggregates", async () => {
    const { service, logRepo, exerciseLogRepo } = createService();
    logRepo.find.mockResolvedValueOnce([
      {
        loggedAt: new Date("2026-05-31T10:00:00.000Z"),
        calories: "500",
        proteinG: "20",
        totalCarbohydratesG: "60",
        totalFatG: "15",
        sodiumMg: "200",
        dietaryFibersG: "7",
        sugarsG: "10",
        saturatedFatG: "3",
        cholesterolMg: "20",
        potassiumMg: "250",
      },
    ]);
    exerciseLogRepo.find.mockResolvedValueOnce([
      { startedAt: new Date("2026-05-31T12:00:00.000Z"), caloriesBurned: "150" },
    ]);

    const out = await service.getRange(1, "2026-05-31", "2026-06-01");
    expect(out).toHaveLength(2);
    expect((out[0] as any).totalCalories).toBe(500);
    expect((out[0] as any).exerciseCaloriesBurned).toBe(150);
    expect((out[1] as any).totalCalories).toBe(0);
  });

  it("getDay includes early-morning exercise on local calendar day (UTC+7)", async () => {
    const { service, exerciseLogRepo, exerciseRepo } = createService();
    exerciseLogRepo.find.mockResolvedValueOnce([
      {
        id: 9,
        exerciseId: 3,
        startedAt: new Date("2026-06-17T18:30:00.000Z"),
        caloriesBurned: "200",
        minutesPerformed: "30",
      },
    ]);
    exerciseRepo.find.mockResolvedValueOnce([{ id: 3, name: "Run", delFlag: false }]);

    const out = await service.getDay(1, "2026-06-18", 420);
    expect((out as any).exerciseCaloriesBurned).toBe(200);
    expect((out as any).exercises).toHaveLength(1);
  });

  it("setCompleted creates when missing", async () => {
    const { service, statusRepo } = createService();
    statusRepo.findOne.mockResolvedValueOnce(null);
    await service.setCompleted(1, "2026-05-31", true);
    expect(statusRepo.create).toHaveBeenCalled();
    expect(statusRepo.save).toHaveBeenCalled();
  });

  it("setNote updates existing row and trims", async () => {
    const { service, statusRepo } = createService();
    statusRepo.findOne.mockResolvedValueOnce({ id: 2, note: null, isCompleted: false });
    await service.setNote(1, "2026-05-31", "  hello  ");
    expect(statusRepo.save).toHaveBeenCalledWith(expect.objectContaining({ note: "hello" }));
  });
});

