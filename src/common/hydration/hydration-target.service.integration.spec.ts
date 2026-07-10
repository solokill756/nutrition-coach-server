import { HydrationTargetService } from "./hydration-target.service";

describe("HydrationTargetService", () => {
  function makeService(params: {
    userWeight?: number | null;
    latestLogWeight?: string | null;
  }) {
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        sex: "male",
        weight: params.userWeight ?? null,
        fitnessLevel: "sedentary",
      }),
    };
    const weightService = {
      historyDescending: jest.fn().mockResolvedValue(
        params.latestLogWeight == null
          ? []
          : [{ weightKg: params.latestLogWeight }],
      ),
    };

    return {
      service: new HydrationTargetService(userRepo as never, weightService as never),
      userRepo,
      weightService,
    };
  }

  it("uses the latest weight log before profile weight", async () => {
    const { service, weightService } = makeService({
      userWeight: 80,
      latestLogWeight: "60.00",
    });

    await expect(service.getTargetMlForUser(1)).resolves.toBe(2100);
    expect(weightService.historyDescending).toHaveBeenCalledWith(1, 1);
  });

  it("falls back to profile weight when no weight log exists", async () => {
    const { service } = makeService({
      userWeight: 80,
      latestLogWeight: null,
    });

    await expect(service.getTargetMlForUser(1)).resolves.toBe(2800);
  });
});
