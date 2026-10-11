import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ExerciseLogsService } from "./exercise-logs.service";

describe("ExerciseLogsService", () => {
  function setup() {
    const logRepo: any = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: x.id ?? 11, ...x })),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };
    const exerciseRepo: any = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    const userRepo: any = { findOne: jest.fn() };
    const weightService: any = { historyDescending: jest.fn().mockResolvedValue([]) };
    const service = new ExerciseLogsService(logRepo, exerciseRepo, userRepo, weightService);
    return { service, logRepo, exerciseRepo, userRepo, weightService };
  }

  it("create throws when exercise not found", async () => {
    const { service, exerciseRepo } = setup();
    exerciseRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.create(1, { exerciseId: 5, minutesPerformed: 10 } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("create throws when exercise is unverified and owned by another user", async () => {
    const { service, exerciseRepo } = setup();
    exerciseRepo.findOne.mockResolvedValueOnce({ id: 5, name: "Run", met: "8", isVerified: false, userId: 2 });
    await expect(service.create(1, { exerciseId: 5, minutesPerformed: 10 } as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("create throws when startedAt invalid", async () => {
    const { service, exerciseRepo, userRepo } = setup();
    exerciseRepo.findOne.mockResolvedValueOnce({ id: 5, name: "Run", type: "cardio", met: "8", defaultCalPerMin: null, isVerified: true });
    userRepo.findOne.mockResolvedValueOnce({ id: 1, weight: 60 });
    await expect(service.create(1, { exerciseId: 5, minutesPerformed: 10, startedAt: "bad" } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("create/list/summary/softDelete success", async () => {
    const { service, logRepo, exerciseRepo, userRepo, weightService } = setup();
    exerciseRepo.findOne.mockResolvedValue({ id: 5, name: "Run", type: "cardio", met: "8", defaultCalPerMin: null, isVerified: true });
    userRepo.findOne.mockResolvedValue({ id: 1, weight: 60 });
    weightService.historyDescending.mockResolvedValueOnce([{ weightKg: "65" }]);

    const created = await service.create(1, { exerciseId: 5, minutesPerformed: 30, source: "manual" } as any);
    expect(created.exercise.name).toBe("Run");
    expect(created.caloriesBurned).toBe(260);

    logRepo.findAndCount.mockResolvedValueOnce([[{ id: 1, exerciseId: 5, startedAt: new Date("2026-05-30T10:00:00.000Z"), minutesPerformed: "30", caloriesBurned: "210", source: "manual" }], 1]);
    exerciseRepo.find.mockResolvedValueOnce([{ id: 5, name: "Run", type: "cardio" }]);
    const list = await service.list(1, { from: "2026-05-01", to: "2026-05-31", page: 1, limit: 10 } as any);
    expect(list.total).toBe(1);

    logRepo.find.mockResolvedValueOnce([
      {
        id: 1,
        exerciseId: 5,
        startedAt: new Date("2026-05-30T10:00:00.000Z"),
        minutesPerformed: "30",
        caloriesBurned: "210",
        source: "manual",
      },
    ]);
    exerciseRepo.find.mockResolvedValueOnce([{ id: 5, name: "Run", type: "cardio" }]);
    const sumToday = await service.summaryToday(1, "2026-05-30");
    expect(sumToday.totalLogs).toBe(1);
    expect(sumToday.items).toHaveLength(1);
    expect(sumToday.items[0].exerciseName).toBe("Run");

    logRepo.find.mockResolvedValueOnce([
      { caloriesBurned: "100", minutesPerformed: "20", startedAt: new Date("2026-05-30T01:00:00.000Z") },
      { caloriesBurned: "50", minutesPerformed: "10", startedAt: new Date("2026-05-31T01:00:00.000Z") },
    ]);
    const sum = await service.summaryRange(1, { from: "2026-05-30", to: "2026-05-31" } as any);
    expect(sum.totalCaloriesBurned).toBe(150);
    expect(sum.daily).toHaveLength(2);

    logRepo.findOne.mockResolvedValueOnce({ id: 9, userId: 1, delFlag: false });
    await expect(service.softDelete(1, 9)).resolves.toEqual({ success: true });
  });
});
