import { ConfigService } from "@nestjs/config";
import { RetrievalService } from "./retrieval.service";
import type { RetrievalHints } from "./retrieval.types";
import { VectorService } from "./vector.service";
import { PostgresRagService } from "./postgres-rag.service";
import { OllamaService } from "../ollama/ollama.service";

function config(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === "RETRIEVAL_QUERY_EXPANSION_ENABLED") return "false";
      return undefined;
    }),
  } as unknown as ConfigService;
}

function vectorService(): VectorService {
  return {
    getQueryEmbedding: jest.fn(async () => [1, 0]),
    docEmbeddingsInPostgres: jest.fn(() => true),
    vectorSearch: jest.fn(async (_embedding: number[], docIds: string[]) =>
      docIds.map((docId, index) => ({ docId, score: 0.9 - index * 0.05, rank: index + 1 })),
    ),
    getCachedEmbedding: jest.fn(() => [1, 0]),
    cosineSimilarity: jest.fn(() => 0.8),
  } as unknown as VectorService;
}

function createService(): RetrievalService {
  const service = new RetrievalService(
    config(),
    vectorService(),
    {} as PostgresRagService,
    { chat: jest.fn() } as unknown as OllamaService,
  );

  const docs = [
    {
      id: "food_banana",
      source: "USDA",
      title: "Bananas, raw",
      content: "Food: Bananas, raw. Carbohydrate 22.8 g. Fiber 2.6 g. Calories 89 kcal.",
      metadata: { domain: "foods", source_type: "foundation_food" },
    },
    {
      id: "condition_diabetes",
      source: "guideline.example",
      title: "Diabetes diet and fruit",
      content: "People with diabetes should manage carbohydrate intake, blood sugar, fiber, and fruit portions.",
      metadata: { domain: "conditions", type: "condition_article" },
    },
    {
      id: "condition_coconut",
      source: "example",
      title: "Coconut water for colds",
      content: "Coconut water may affect blood sugar in people with diabetes.",
      metadata: { domain: "conditions", type: "condition_article" },
    },
    {
      id: "condition_lipids",
      source: "example",
      title: "Chỉ số mỡ máu và cholesterol",
      content: "High cholesterol, LDL, HDL, and triglyceride levels are part of dyslipidemia. Limit trans fat.",
      metadata: { domain: "conditions", type: "condition_article" },
    },
    {
      id: "condition_urine",
      source: "example",
      title: "Màu sắc nước tiểu bất thường",
      content: "Urine color can reflect hydration and kidney symptoms.",
      metadata: { domain: "conditions", type: "condition_article" },
    },
    {
      id: "guide_general",
      source: "who",
      title: "General Nutrition Guidelines for adults",
      content: "Eat at least 400g of fruit and vegetables per day. Limit free sugars and sodium intake.",
      metadata: { domain: "guidelines", type: "guideline_article" },
    },

    {
      id: "safety_allergy_fish",
      source: "cdc",
      title: "Food allergy alert: Fish allergen risk",
      content: "People with fish allergies should avoid consuming any seafood products due to anaphylaxis risk.",
      metadata: { domain: "safety", type: "allergy_alert" },
    },
  ];

  (service as any).docs = docs;
  (service as any).isIndexReady = true;
  (service as any).isVectorReady = false;
  (service as any).hybridMode = "bm25-only";
  (service as any).buildDomainDocIdMap();
  (service as any).buildIndices();

  return service;
}

describe("RetrievalService entity filters", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses unified retrieval when both food and condition hints are present", async () => {
    const service = createService();
    const hints: RetrievalHints = {
      intent: "condition_specific",
      foods: ["banana"],
      conditions: ["diabetes"],
    };

    const results = await service.retrieve("Ăn chuối có tốt cho người tiểu đường không?", 5, hints);

    expect(Array.isArray(results)).toBe(true);
    expect(results.some((result) => result.domain === "foods")).toBe(false);
  });

  it("excludes food-domain documents from retrieval indices regardless of hints", async () => {
    const service = createService();

    expect(service.getIndexedDomains()).not.toContain("foods");

    const results = await service.retrieve("banana nutrition", 5, {
      intent: "food_specific",
      foods: ["banana"],
    });

    expect(results.some((result) => result.id === "food_banana")).toBe(false);
    expect(results.some((result) => result.domain === "foods")).toBe(false);
  });

  it("ranks condition docs highest for condition_specific intent via BM25 boost", async () => {
    const service = createService();
    const hints: RetrievalHints = {
      intent: "condition_specific",
      conditions: ["dyslipidemia"],
    };

    const results = await service.retrieve("Mỡ máu nên hạn chế ăn gì?", 3, hints);

    // condition_lipids contains dyslipidemia / cholesterol / LDL — highest BM25 score
    expect(results.some((result) => result.id === "condition_lipids")).toBe(true);
  });

  it("deduplicates BM25 candidates so the same doc only appears once in results", async () => {
    const service = createService();
    const hints: RetrievalHints = {
      intent: "condition_specific",
    };

    const results = await service.retrieve("cholesterol blood sugar", 10, hints);

    const ids = results.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it("never returns food-domain docs (EXCLUDED_RAG_DOMAINS) regardless of query", async () => {
    const service = createService();

    const results = await service.retrieve("chuoi co nhieu kali", 5, {
      intent: "food_specific",
      foods: ["banana"],
    });

    expect(results.every((result) => result.domain !== "foods")).toBe(true);
  });

  it("restricts results to allowed domains (guidelines only) for food_specific intent without conditions", async () => {
    const service = createService();

    const results = await service.retrieve("nutrition guidelines for fruit", 10, {
      intent: "food_specific",
      hasConditionContext: false,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.domain === "guidelines")).toBe(true);
  });

  it("allows guidelines and conditions domains for food_specific intent when hasConditionContext is true", async () => {
    const service = createService();

    const results = await service.retrieve("diabetes fruit and guidelines", 10, {
      intent: "food_specific",
      hasConditionContext: true,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => ["guidelines", "conditions"].includes(r.domain))).toBe(true);
    expect(results.some((r) => r.domain === "guidelines")).toBe(true);
    expect(results.some((r) => r.domain === "conditions")).toBe(true);
  });

  it("restricts results to safety and conditions domains for safety intent", async () => {
    const service = createService();

    const results = await service.retrieve("allergy diabetes fish risk", 10, {
      intent: "safety",
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => ["safety", "conditions"].includes(r.domain))).toBe(true);
    expect(results.some((r) => r.domain === "safety")).toBe(true);
    expect(results.some((r) => r.domain === "conditions")).toBe(true);
  });

});
