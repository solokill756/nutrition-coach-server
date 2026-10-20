import { UnprocessableEntityException } from "@nestjs/common";
import { AuthService } from "./auth.service";

function build(stored: unknown = null) {
  const user: any = { id: 7, delFlag: false, displayName: "Lan", mealSplits: stored };
  const appUserRepo: any = {
    findOne: jest.fn(async () => user),
    save: jest.fn(async (u: any) => u),
  };
  const userContextService: any = { invalidateUserCache: jest.fn() };
  const config: any = { get: jest.fn() };
  const unused = {} as never;
  const service = new AuthService(
    config, unused, unused, unused, unused,
    appUserRepo, unused, unused, unused, unused, unused, unused,
    userContextService,
  );
  jest.spyOn(service, "me").mockImplementation(async () => ({ id: 7 }) as any);
  return { service, user, appUserRepo, userContextService };
}

describe("AuthService meal splits", () => {
  it("saves a valid split and clears the cached recipe context", async () => {
    const { service, user, appUserRepo, userContextService } = build();
    const split = { breakfast: 20, lunch: 40, dinner: 35, snack: 5 };
    await service.patchProfile(7, { mealSplits: split } as any);
    expect(user.mealSplits).toEqual(split);
    expect(appUserRepo.save).toHaveBeenCalled();
    expect(userContextService.invalidateUserCache).toHaveBeenCalledWith(7);
  });

  it("resets to the default with null", async () => {
    const { service, user, userContextService } = build({ breakfast: 20, lunch: 40, dinner: 35, snack: 5 });
    await service.patchProfile(7, { mealSplits: null } as any);
    expect(user.mealSplits).toBeNull();
    expect(userContextService.invalidateUserCache).toHaveBeenCalledWith(7);
  });

  it.each([
    ["a total of 95", { breakfast: 20, lunch: 40, dinner: 30, snack: 5 }],
    ["a string number", { breakfast: "25", lunch: 35, dinner: 30, snack: 10 }],
    ["a decimal", { breakfast: 25.5, lunch: 34.5, dinner: 30, snack: 10 }],
  ])("rejects %s with 422 and saves nothing", async (_label, mealSplits) => {
    const { service, appUserRepo, userContextService } = build();
    const err = await service.patchProfile(7, { mealSplits } as any).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toEqual({
      errorKey: "users.errors.invalidMealSplits",
      message: "Meal split must add up to 100%.",
    });
    expect(appUserRepo.save).not.toHaveBeenCalled();
    expect(userContextService.invalidateUserCache).not.toHaveBeenCalled();
  });

  it("leaves the split alone when the field is not sent", async () => {
    const stored = { breakfast: 20, lunch: 40, dinner: 35, snack: 5 };
    const { service, user, userContextService } = build(stored);
    await service.patchProfile(7, { displayName: "Lan Nguyen" } as any);
    expect(user.mealSplits).toEqual(stored);
    expect(userContextService.invalidateUserCache).not.toHaveBeenCalled();
  });

  it("returns the resolved split on the user (default for null or broken values)", () => {
    const { service } = build();
    const toAuthUser = (stored: unknown) =>
      (service as any).toAuthUser({ id: 7, displayName: "Lan", mealSplits: stored });
    expect(toAuthUser(null).mealSplits).toEqual({ breakfast: 25, lunch: 35, dinner: 30, snack: 10 });
    expect(toAuthUser({ breakfast: 90 }).mealSplits).toEqual({ breakfast: 25, lunch: 35, dinner: 30, snack: 10 });
    expect(toAuthUser({ breakfast: 20, lunch: 40, dinner: 35, snack: 5 }).mealSplits).toEqual({
      breakfast: 20,
      lunch: 40,
      dinner: 35,
      snack: 5,
    });
  });
});
