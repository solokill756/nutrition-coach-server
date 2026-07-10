import { DEFAULT_GEMINI_MODEL, resolveGeminiModel } from "./gemini-model.util";

describe("resolveGeminiModel", () => {
  it("defaults to gemini-3.1-flash-lite", () => {
    expect(resolveGeminiModel(undefined)).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveGeminiModel("")).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("normalizes human-readable and legacy model names", () => {
    expect(resolveGeminiModel("Gemini 3.1 Flash Lite")).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveGeminiModel("gemini-3-flash-preview")).toBe(DEFAULT_GEMINI_MODEL);
  });

  it("passes through explicit api model ids", () => {
    expect(resolveGeminiModel("gemini-3.1-flash-lite")).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveGeminiModel("custom-model-id")).toBe("custom-model-id");
  });
});
