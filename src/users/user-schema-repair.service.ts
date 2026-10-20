import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";

/**
 * Adds AppUser columns newer than a database (production runs without
 * synchronize). Idempotent. Set USER_AUTO_SCHEMA=false to skip.
 */
@Injectable()
export class UserSchemaRepairService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UserSchemaRepairService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const raw = this.config.get<string>("USER_AUTO_SCHEMA");
    if (raw === "0" || String(raw).toLowerCase() === "false") return;
    try {
      await this.dataSource.query(
        'ALTER TABLE "AppUser" ADD COLUMN IF NOT EXISTS "MealSplits" jsonb',
      );
    } catch (error) {
      this.logger.warn(`AppUser schema repair skipped: ${(error as Error).message}`);
    }
  }
}
