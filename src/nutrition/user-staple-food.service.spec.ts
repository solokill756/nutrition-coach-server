import { ConflictException, NotFoundException } from "@nestjs/common";
import { UserStapleFoodService } from "./user-staple-food.service";

describe("UserStapleFoodService", () => {
  function setup() {
    const stapleRepo: any = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(),
      delete: jest.fn(),
    };
    const foodRepo: any = { find: jest.fn(), findOne: jest.fn() };
    const service = new UserStapleFoodService(stapleRepo, foodRepo);
    return { service, stapleRepo, foodRepo };
  }

  it("listWithFood returns ordered foods", async () => {
    const { service, stapleRepo, foodRepo } = setup();
    stapleRepo.find.mockResolvedValueOnce([{ foodId: 2 }, { foodId: 1 }]);
    foodRepo.find.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const out = await service.listWithFood(1);
    expect(out.map((x: any) => x.id)).toEqual([2, 1]);
  });

  it("add validates duplicate via stapleRepo", async () => {
    const { service, stapleRepo } = setup();
    stapleRepo.findOne.mockResolvedValueOnce({ userId: 1, foodId: 8 });
    await expect(service.add(1, 8)).rejects.toBeInstanceOf(ConflictException);

    stapleRepo.findOne.mockResolvedValueOnce(null);
    await expect(service.add(1, 8)).resolves.toBeUndefined();
  });

  it("remove throws when not affected", async () => {
    const { service, stapleRepo } = setup();
    stapleRepo.delete.mockResolvedValueOnce({ affected: 0 });
    await expect(service.remove(1, 10)).rejects.toBeInstanceOf(NotFoundException);
  });
});
