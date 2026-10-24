import { Logger } from "@nestjs/common";
import { UserReferenceService } from "./user-reference.service";
import type { PersonalizedRagQueryInput } from "./personalized-rag-query";
import type { RetrievalResult } from "./retrieval.types";

const input: PersonalizedRagQueryInput = {
  purpose: "dashboard_suggestion",
  profile: { sex: "male", dietType: null, allergies: [], fitnessLevel: "moderate" },
  goalTypes: ["weight_loss"],
  healthDetailed: [],
  conditionRelatedThresholds: [],
};

function result(score: number, content = "content"): RetrievalResult {
  return { id: `id-${score}`, source: "src", title: `T${score}`, content, domain: "d", score };
}

function build(topK: string | undefined, retrieve: jest.Mock) {
  const config = { get: jest.fn((key: string) => (key === "TOP_K" ? topK : undefined)) };
  return new UserReferenceService({ retrieve } as any, config as any);
}

describe("UserReferenceService", () => {
  beforeAll(() => Logger.overrideLogger(false));
  afterAll(() => Logger.overrideLogger(["log", "warn", "error"]));

  it("uses TOP_K default 6", async () => {
    const retrieve = jest.fn().mockResolvedValue([]);
    await build(undefined, retrieve).retrieve(input);
    expect(retrieve.mock.calls[0][1]).toBe(6);
  });

  it("uses TOP_K from config", async () => {
    const retrieve = jest.fn().mockResolvedValue([]);
    await build("9", retrieve).retrieve(input);
    expect(retrieve.mock.calls[0][1]).toBe(9);
  });

  it("drops results below 0.6", async () => {
    const retrieve = jest.fn().mockResolvedValue([result(0.9), result(0.59), result(0.6)]);
    const out = await build(undefined, retrieve).retrieve(input);
    expect(out.used.map((r) => r.score)).toEqual([0.9, 0.6]);
  });

  it("caps reference text at 6000 chars", async () => {
    const retrieve = jest
      .fn()
      .mockResolvedValue(Array.from({ length: 5 }, () => result(0.9, "x".repeat(2500))));
    const out = await build(undefined, retrieve).retrieve(input);
    expect(out.text.length).toBeLessThanOrEqual(6000);
    expect(out.used.length).toBeGreaterThan(0);
  });

  it("keeps the LLM rerank unless the caller skips it", async () => {
    const retrieve = jest.fn().mockResolvedValue([]);
    const service = build(undefined, retrieve);
    await service.retrieve(input);
    await service.retrieve(input, { skipCrossEncoder: true });
    expect(retrieve.mock.calls[0][2].skipCrossEncoder).toBeUndefined();
    expect(retrieve.mock.calls[1][2].skipCrossEncoder).toBe(true);
  });

  it("returns None when retrieval fails", async () => {
    const retrieve = jest.fn().mockRejectedValue(new Error("boom"));
    const out = await build(undefined, retrieve).retrieve(input);
    expect(out).toEqual({ text: "None.", used: [] });
  });
});
