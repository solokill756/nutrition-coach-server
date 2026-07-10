import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { LogFoodSchemaRepairService } from "./log-food-schema-repair.service";

describe("LogFoodSchemaRepairService", () => {
  it("applies the exercise verification schema patch on bootstrap", async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue(undefined),
    } as unknown as DataSource;
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const service = new LogFoodSchemaRepairService(dataSource, config);

    await service.onApplicationBootstrap();

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE "Exercise"'),
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('"IX_Exercise_Admin_DelFlag_IsVerified_Name"'),
    );
  });
});
