import axios from "axios";
import { ConfigService } from "@nestjs/config";
import { AiIngredientVisionService } from "./ai-ingredient-vision.service";
import { GeminiVisionClient } from "../ollama/gemini-vision.client";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("AiIngredientVisionService", () => {
  const config: ConfigService = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        LLM_PROVIDER: "gemini",
        GEMINI_API_KEY: "k",
      };
      return map[key];
    }),
  } as unknown as ConfigService;
  const service = new AiIngredientVisionService(new GeminiVisionClient(config));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("parses Gemini JSON ingredient payloads", () => {
    const result = service.parseIngredients(
      '{"ingredients":[{"name":"chicken breast","confidence":0.91},{"name":"egg","confidence":2}]}',
    );

    expect(result).toEqual([
      { name: "chicken breast", confidence: 0.91 },
      { name: "egg", confidence: 1 },
    ]);
  });

  it("returns an empty list for malformed JSON", () => {
    expect(service.parseIngredients("not json")).toEqual([]);
  });

  it("recognizes ingredients from image url", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: Buffer.from("img"),
      headers: { "content-type": "image/jpeg" },
    } as never);
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        candidates: [
          { content: { parts: [{ text: '{"ingredients":[{"name":"tomato","confidence":0.8}]}' }] } },
        ],
      },
    } as never);

    const out = await service.recognizeIngredients("https://example.com/a.jpg");
    expect(out).toEqual([{ name: "tomato", confidence: 0.8 }]);
    expect(mockedAxios.post).toHaveBeenCalled();
  });

  it("throws bad request when image content-type is not image", async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: Buffer.from("x"),
      headers: { "content-type": "text/plain" },
    } as never);

    await expect(service.recognizeIngredients("https://example.com/a.txt")).rejects.toBeTruthy();
  });
});
