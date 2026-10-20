import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import { DataSource } from "typeorm";
import { LogFoodSchemaRepairService } from "./log-food-schema-repair.service";

// The SQL patch files live under scripts/sql/patches (not guaranteed to exist in every
// checkout/CI image), so the spec supplies the patch content itself and stays hermetic.
const EXERCISE_PATCH_FILE = "exercise_add_is_verified.sql";
const EXERCISE_PATCH_SQL = `-- add verification flag
ALTER TABLE "Exercise" ADD COLUMN IF NOT EXISTS "IsVerified" boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "IX_Exercise_Admin_DelFlag_IsVerified_Name" ON "Exercise" ("DelFlag", "IsVerified", "Name");`;

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

describe("LogFoodSchemaRepairService", () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => p.endsWith(EXERCISE_PATCH_FILE));
    (fs.readFileSync as jest.Mock).mockReturnValue(EXERCISE_PATCH_SQL);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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
