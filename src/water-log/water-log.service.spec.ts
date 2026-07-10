import { BadRequestException } from "@nestjs/common";
import { WaterLogService } from "./water-log.service";

function createService() {
  const waterRepo: any = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn(async (x) => x),
    create: jest.fn((x) => x),
  };
  const hydrationTargetService: any = {
    getTargetMlForUser: jest.fn().mockResolvedValue(2000),
  };
  const service = new WaterLogService(waterRepo, hydrationTargetService);
  return { service, waterRepo };
}

describe("WaterLogService", () => {
  it("getDay returns payload", async () => {
    const { service, waterRepo } = createService();
    waterRepo.findOne.mockResolvedValueOnce({ amountMl: "500" });
    const out = await service.getDay(1, "2026-05-31");
    expect(out.amountMl).toBe(500);
    expect(out.targetMl).toBe(2000);
  });

  it("addAmount validates range", async () => {
    const { service } = createService();
    await expect(service.addAmount(1, 20)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("addAmount creates when no row and updates when row exists", async () => {
    const { service, waterRepo } = createService();
    waterRepo.findOne.mockResolvedValueOnce(null);
    const c = await service.addAmount(1, 200, "2026-05-31");
    expect(c.todayTotalMl).toBe(200);
    waterRepo.findOne.mockResolvedValueOnce({ amountMl: "300" });
    const u = await service.addAmount(1, 200, "2026-05-31");
    expect(u.todayTotalMl).toBe(500);
  });

  it("setDayTotal validates range", async () => {
    const { service } = createService();
    await expect(service.setDayTotal(1, "2026-05-31", 30000)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("history validates date range and maps rows", async () => {
    const { service, waterRepo } = createService();
    await expect(service.history(1, "2026-06-01", "2026-05-01")).rejects.toBeInstanceOf(BadRequestException);
    waterRepo.find.mockResolvedValueOnce([{ date: "2026-05-31", amountMl: "777" }]);
    const rows = await service.history(1, "2026-05-01", "2026-05-31");
    expect(rows[0].amountMl).toBe(777);
  });
});

