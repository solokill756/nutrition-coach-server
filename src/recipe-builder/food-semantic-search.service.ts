import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { VectorService } from "../retrieval/vector.service";

export type FoodCandidate = {
  foodId: number;
  foodName: string;
  brandName: string;
  servingSize: number;
  servingUnit: string;
  calories: number;
  proteinG: number;
  totalCarbohydratesG: number;
  totalFatG: number;
  sodiumMg: number;
  isVerified: boolean;
  score: number;
};

@Injectable()
export class FoodSemanticSearchService implements OnModuleInit {
  private readonly logger = new Logger(FoodSemanticSearchService.name);
  private readonly tableName = "food_embeddings";

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly vectorService: VectorService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureSchema();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`food_embeddings schema not ready; keyword fallback will be used. ${message}`);
    }
  }

  async searchIngredient(name: string, topK = 5): Promise<FoodCandidate[]> {
    const query = name.trim();
    if (query.length < 2) {
      return [];
    }
    const safeTopK = Math.min(Math.max(Number(topK) || 5, 3), 5);

    try {
      const embedding = await this.vectorService.getFoodQueryEmbedding(query);
      const rows = await this.dataSource.query(
        `
          SELECT
            f."Id" AS "foodId",
            f."food_name" AS "foodName",
            COALESCE(f."Category", '') AS "brandName",
            COALESCE(f."ServingSize", 100) AS "servingSize",
            COALESCE(f."ServingUnit", 'g') AS "servingUnit",
            COALESCE(f."Calories", 0) AS "calories",
            COALESCE(f."ProteinG", 0) AS "proteinG",
            COALESCE(f."TotalCarbohydratesG", 0) AS "totalCarbohydratesG",
            COALESCE(f."TotalFatG", 0) AS "totalFatG",
            COALESCE(f."SodiumMg", 0) AS "sodiumMg",
            COALESCE(f."IsVerified", false) AS "isVerified",
            GREATEST(0, 1 - (e.embedding <=> $1::vector)) AS "score"
          FROM ${this.tableRef(this.tableName)} e
          JOIN "Food" f ON f."Id" = e.food_id
          WHERE COALESCE(f."Category", '') NOT ILIKE '%AI Estimated%'
          ORDER BY e.embedding <=> $1::vector
          LIMIT $2
        `,
        [this.vectorLiteral(embedding), safeTopK],
      );

      const candidates = rows.map((row: Record<string, unknown>) => this.toCandidate(row));
      if (candidates.length > 0) {
        return candidates;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Semantic food search failed for "${query}"; using keyword fallback. ${message}`);
    }

    return this.keywordFallback(query, safeTopK);
  }

  async searchIngredients(
    ingredients: Array<{ clientIngredientId?: string; name: string; confidence?: number; notes?: string }>,
    topK = 5,
  ) {
    return Promise.all(
      ingredients.map(async (ingredient, index) => ({
        clientIngredientId: ingredient.clientIngredientId || `ingredient-${index + 1}`,
        detectedName: ingredient.name,
        confidence: ingredient.confidence ?? 1,
        ...(ingredient.notes ? { notes: ingredient.notes } : {}),
        candidates: await this.searchIngredient(ingredient.name, topK),
      })),
    );
  }

  async batchSearchIngredients(
    ingredients: Array<{ clientIngredientId?: string; name: string; confidence?: number; notes?: string }>,
    topK = 5,
  ) {
    const safeTopK = Math.min(Math.max(Number(topK) || 5, 3), 5);

    try {
      // Step 1: Generate all embeddings in parallel
      const embeddings = await Promise.all(
        ingredients.map(({ name }) => this.vectorService.getFoodQueryEmbedding(name.trim())),
      );

      // Step 2: Single batch query
      const table = this.tableRef(this.tableName);
      const sql = `
        WITH input_queries AS (
          SELECT
            unnest($1::vector(768)[]) AS query_vec,
            unnest($2::text[]) AS ingredient_name
        )
        SELECT
          iq.ingredient_name,
          fe.food_id,
          f."food_name" AS "foodName",
          COALESCE(f."Category", '') AS "brandName",
          COALESCE(f."ServingSize", 100) AS "servingSize",
          COALESCE(f."ServingUnit", 'g') AS "servingUnit",
          COALESCE(f."Calories", 0) AS "calories",
          COALESCE(f."ProteinG", 0) AS "proteinG",
          COALESCE(f."TotalCarbohydratesG", 0) AS "totalCarbohydratesG",
          COALESCE(f."TotalFatG", 0) AS "totalFatG",
          COALESCE(f."SodiumMg", 0) AS "sodiumMg",
          COALESCE(f."IsVerified", false) AS "isVerified",
          GREATEST(0, 1 - (fe.embedding <=> iq.query_vec)) AS "score"
        FROM input_queries iq
        CROSS JOIN LATERAL (
          SELECT fe2.food_id, fe2.embedding
          FROM ${table} fe2
          WHERE 1=1
          ORDER BY fe2.embedding <=> iq.query_vec
          LIMIT $3
        ) fe
        JOIN "Food" f ON f."Id" = fe.food_id
        WHERE COALESCE(f."Category", '') NOT ILIKE '%AI Estimated%'
        ORDER BY iq.ingredient_name, fe.embedding <=> iq.query_vec
      `;

      const rows = await this.dataSource.query(sql, [
        `[${embeddings.map(v => `[${v.join(",")}]`).join(",")}]`,
        ingredients.map(i => i.name.trim()),
        safeTopK,
      ]);

      // Step 3: Group results by ingredient_name
      return this.groupBatchResults(ingredients, rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Batch semantic search failed; falling back to individual queries. ${message}`);
      return this.searchIngredients(ingredients, topK);
    }
  }

  private groupBatchResults(
    ingredients: Array<{ clientIngredientId?: string; name: string; confidence?: number; notes?: string }>,
    rows: Record<string, unknown>[],
  ) {
    const grouped = new Map<string, FoodCandidate[]>();
    for (const row of rows) {
      const name = String(row.ingredient_name ?? "");
      if (!grouped.has(name)) {
        grouped.set(name, []);
      }
      grouped.get(name)!.push(this.toCandidate(row));
    }

    return ingredients.map((ingredient, index) => ({
      clientIngredientId: ingredient.clientIngredientId || `ingredient-${index + 1}`,
      detectedName: ingredient.name,
      confidence: ingredient.confidence ?? 1,
      ...(ingredient.notes ? { notes: ingredient.notes } : {}),
      candidates: grouped.get(ingredient.name.trim()) ?? [],
    }));
  }

  private async ensureSchema(): Promise<void> {
    const dim = Number(this.config.get<string>("POSTGRES_VECTOR_DIM") || 768);
    const indexType = String(this.config.get<string>("POSTGRES_VECTOR_INDEX_TYPE") || "hnsw").toLowerCase();
    const table = this.tableRef(this.tableName);

    await this.dataSource.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        food_id bigint PRIMARY KEY REFERENCES "Food"("Id") ON DELETE CASCADE,
        embedding vector(${dim}) NOT NULL,
        model text NOT NULL DEFAULT 'nomic-embed-text',
        content_hash text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    if (indexType === "ivfflat") {
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_food_embeddings_vector_ivfflat
        ON ${table}
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);
    } else {
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_food_embeddings_vector_hnsw
        ON ${table}
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
      `);
    }

    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_food_embeddings_model ON ${table}(model)`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS idx_food_embeddings_updated_at ON ${table}(updated_at DESC)`);
  }

  private async keywordFallback(query: string, topK: number): Promise<FoodCandidate[]> {
    const rows = await this.dataSource.query(
      `
        SELECT
          f."Id" AS "foodId",
          f."food_name" AS "foodName",
          COALESCE(f."Category", '') AS "brandName",
          COALESCE(f."ServingSize", 100) AS "servingSize",
          COALESCE(f."ServingUnit", 'g') AS "servingUnit",
          COALESCE(f."Calories", 0) AS "calories",
          COALESCE(f."ProteinG", 0) AS "proteinG",
          COALESCE(f."TotalCarbohydratesG", 0) AS "totalCarbohydratesG",
          COALESCE(f."TotalFatG", 0) AS "totalFatG",
          COALESCE(f."SodiumMg", 0) AS "sodiumMg",
          COALESCE(f."IsVerified", false) AS "isVerified",
          CASE
            WHEN lower(f."food_name") = lower($1) THEN 0.78
            WHEN f."food_name" ILIKE $2 THEN 0.68
            ELSE 0.5
          END AS "score"
        FROM "Food" f
        WHERE f."food_name" ILIKE $3
          AND COALESCE(f."Category", '') NOT ILIKE '%AI Estimated%'
        ORDER BY
          CASE
            WHEN lower(f."food_name") = lower($1) THEN 0
            WHEN f."food_name" ILIKE $2 THEN 1
            ELSE 2
          END,
          f."Id" ASC
        LIMIT $4
      `,
      [query, `${query}%`, `%${query}%`, topK],
    );
    return rows.map((row: Record<string, unknown>) => this.toCandidate(row));
  }

  private toCandidate(row: Record<string, unknown>): FoodCandidate {
    return {
      foodId: Number(row.foodId ?? 0),
      foodName: String(row.foodName ?? ""),
      brandName: String(row.brandName ?? ""),
      servingSize: Number(row.servingSize ?? 100),
      servingUnit: String(row.servingUnit ?? "g"),
      calories: Number(row.calories ?? 0),
      proteinG: Number(row.proteinG ?? 0),
      totalCarbohydratesG: Number(row.totalCarbohydratesG ?? 0),
      totalFatG: Number(row.totalFatG ?? 0),
      sodiumMg: Number(row.sodiumMg ?? 0),
      isVerified: Boolean(row.isVerified),
      score: Number(row.score ?? 0),
    };
  }

  private quoteIdent(name: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid SQL identifier: ${name}`);
    }
    return `"${name}"`;
  }

  private tableRef(tableName: string): string {
    const schema = this.config.get<string>("POSTGRES_SCHEMA") || "public";
    return `${this.quoteIdent(schema)}.${this.quoteIdent(tableName)}`;
  }

  private vectorLiteral(embedding: number[]): string {
    return `[${embedding.join(",")}]`;
  }
}

