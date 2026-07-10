import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectDataSource } from "@nestjs/typeorm";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DataSource } from "typeorm";

const PATCH_FILES = [
  "logfood_add_missing_columns.sql",
  "logfood_copy_legacy_sodium_to_sodiummg.sql",
  "daily_diary_status_add_note.sql",
  "food_add_detailed_nutrients.sql",
  "daily_nutrition_summary_add_detailed_nutrients.sql",
  "exercise_add_is_verified.sql",
  "condition_nutrient_rules.sql",
] as const;

const ALWAYS_PATCH_FILES = [
  "drop_user_device_token.sql",
  "drop_user_threshold_notification.sql",
  "user_notifications.sql",
] as const;

/**
 * Legacy DBs may be missing columns the TypeORM entities expect.
 * Runs SQL patches under `scripts/sql/patches/` at boot (idempotent).
 * Set LOGFOOD_AUTO_SCHEMA=false to skip.
 */
@Injectable()
export class LogFoodSchemaRepairService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LogFoodSchemaRepairService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const file of ALWAYS_PATCH_FILES) {
      await this.tryApplyPatch(file);
    }

    const raw = this.config.get<string>("LOGFOOD_AUTO_SCHEMA");
    if (raw === "0" || String(raw).toLowerCase() === "false") {
      this.logger.log("LOGFOOD_AUTO_SCHEMA disabled — skipping LogFood column patch");
      return;
    }

    for (const file of PATCH_FILES) {
      await this.tryApplyPatch(file);
    }
  }

  private resolvePatchPath(file: string): string | undefined {
    const candidates = [
      join(process.cwd(), "scripts", "sql", "patches", file),
      join(__dirname, "..", "..", "scripts", "sql", "patches", file),
    ];
    return candidates.find((p) => existsSync(p));
  }

  private stripSqlComments(sql: string): string {
    return sql
      .split("\n")
      .filter((line) => {
        const t = line.trim();
        return t.length > 0 && !t.startsWith("--");
      })
      .join("\n")
      .trim();
  }

  private async tryApplyPatch(file: string): Promise<void> {
    const path = this.resolvePatchPath(file);
    if (!path) {
      this.logger.warn(`${file} not found — skip`);
      return;
    }
    try {
      const executable = this.stripSqlComments(readFileSync(path, "utf8"));
      if (!executable) {
        return;
      }
      const statements = executable
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await this.dataSource.query(`${statement};`);
      }
      this.logger.log(`Schema patch applied (${path})`);
    } catch (e) {
      this.logger.error(
        `LogFood patch failed (${file}): ${(e as Error).message}. Run manually: scripts/sql/patches/${file}`,
        (e as Error).stack,
      );
    }
  }
}
