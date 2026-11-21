import { config } from "dotenv";
import { resolve } from "node:path";
import { DEFAULT_CONDITION_NUTRIENT_RULES } from "./nutrition/condition-nutrient-rule-seed";
import { ConditionNutrientUnitService } from "./nutrition/condition-nutrient-unit.service";

const { Client } = require("pg");

async function main(): Promise<void> {
  config({ path: resolve(__dirname, "..", ".env"), override: true });
  const client = new Client({
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER || "postgres",
    password: process.env.POSTGRES_PASSWORD || "postgres",
    database: process.env.POSTGRES_DB || "nutrition_rag",
    ssl: process.env.POSTGRES_SSL?.toLowerCase() === "true" ? { rejectUnauthorized: false } : false,
  });
  // Use the same PostgreSQL search path as the application's TypeORM connection.
  const table = '"ConditionNutrientRule"';
  const units = new ConditionNutrientUnitService();

  await client.connect();
  try {
    await client.query("BEGIN");
    // The table has no unique condition/nutrient constraint. Serialize seed runs.
    await client.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
    const existing = await client.query(`SELECT "ConditionKey", "Nutrient" FROM ${table}`);
    // Condition lookups in onboarding use the canonical key as stored in the DB.
    const key = (condition: string, nutrient: string) =>
      `${condition}:${units.normalizeNutrient(nutrient)}`;
    const existingKeys = new Set(existing.rows.map((row: { ConditionKey: string; Nutrient: string }) =>
      key(row.ConditionKey, row.Nutrient),
    ));

    let inserted = 0;
    for (const rule of DEFAULT_CONDITION_NUTRIENT_RULES) {
      if (existingKeys.has(key(rule.conditionKey, rule.nutrient))) continue;
      await client.query(
        `INSERT INTO ${table}
           ("ConditionKey", "Nutrient", "MinAmount", "MaxAmount", "Unit", "RebalanceMode", "IsActive")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [rule.conditionKey, rule.nutrient, rule.minAmount, rule.maxAmount, rule.unit, rule.rebalanceMode, rule.isActive],
      );
      inserted++;
    }
    await client.query("COMMIT");
    console.log(`Condition nutrient rules: inserted ${inserted}, skipped ${DEFAULT_CONDITION_NUTRIENT_RULES.length - inserted} existing.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(`Condition nutrient rule seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}
