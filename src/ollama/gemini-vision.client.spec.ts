import axios from "axios";
import { ConfigService } from "@nestjs/config";
import { GeminiVisionClient } from "./gemini-vision.client";
import { PlatformCryptoService } from "./platform-crypto.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

const image = { base64: "aW1n", mimeType: "image/png" };
const okResponse = (text: string) => ({
  data: { candidates: [{ content: { parts: [{ text }] } }] },
});

function makeClient(values: Record<string, string>) {
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  return new GeminiVisionClient(config);
}

describe("GeminiVisionClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls generateContent with api key header and inline_data for gemini provider", async () => {
    mockedAxios.post.mockResolvedValueOnce(okResponse('{"a":1}') as never);
    const client = makeClient({
      LLM_PROVIDER: "gemini",
      GEMINI_API_KEY: "secret",
      GEMINI_API_URL: "https://gemini.test/v1beta/",
      GEMINI_VISION_MODEL: "gemini-3.1-flash-lite",
    });

    const out = await client.generateWithImage("describe", image);

    expect(out).toBe('{"a":1}');
    const [url, body, options] = mockedAxios.post.mock.calls[0] as [string, any, any];
    expect(url).toBe("https://gemini.test/v1beta/models/gemini-3.1-flash-lite:generateContent");
    expect(options.headers["x-goog-api-key"]).toBe("secret");
    expect(body.contents[0].parts[1].inline_data).toEqual({
      mime_type: "image/png",
      data: "aW1n",
    });
    expect(body.generationConfig).toEqual({
      temperature: 0.1,
      responseMimeType: "application/json",
    });
  });

  it("posts an encrypted curl command to AI_API_URL for platform provider", async () => {
    const encrypt = jest.spyOn(PlatformCryptoService, "encrypt").mockReturnValue("ENC");
    mockedAxios.post.mockResolvedValueOnce(okResponse("hello") as never);
    const client = makeClient({
      LLM_PROVIDER: "platform",
      AI_API_URL: "https://platform.test/",
      AI_SECRET_KEY: "sk",
      AI_APP_NAME: "myapp",
    });

    const out = await client.generateWithImage("describe", image);

    expect(out).toBe("hello");
    expect(encrypt).toHaveBeenCalledWith(expect.stringContaining("curl"), "sk");
    const [url, body] = mockedAxios.post.mock.calls[0] as [string, any];
    expect(url).toBe("https://platform.test/api");
    expect(body).toEqual({ appName: "myapp", data: "ENC" });
    encrypt.mockRestore();
  });

  it("retries exactly once with multiline curl on invalid JSON payload error", async () => {
    const encrypt = jest.spyOn(PlatformCryptoService, "encrypt").mockReturnValue("ENC");
    mockedAxios.post
      .mockRejectedValueOnce({
        message: "Request failed",
        response: {
          status: 400,
          data: "Invalid JSON payload received. Root element must be a message.",
        },
      })
      .mockResolvedValueOnce(okResponse("retried") as never);
    const client = makeClient({
      LLM_PROVIDER: "platform",
      AI_API_URL: "https://platform.test",
      AI_SECRET_KEY: "sk",
    });

    const out = await client.generateWithImage("describe", image);

    expect(out).toBe("retried");
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(encrypt.mock.calls[0][0]).not.toContain("\\\n");
    expect(encrypt.mock.calls[1][0]).toContain("\\\n");
    encrypt.mockRestore();
  });

  it("throws when Gemini returns an empty response", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { candidates: [] } } as never);
    const client = makeClient({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" });

    await expect(client.generateWithImage("describe", image)).rejects.toThrow(
      "Gemini returned empty response",
    );
  });
});
