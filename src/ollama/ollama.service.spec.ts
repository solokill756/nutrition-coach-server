import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { createDecipheriv, pbkdf2Sync } from "crypto";
import { OllamaService } from "./ollama.service";

jest.mock("axios");

const mockedAxios = axios as jest.Mocked<typeof axios>;

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key])
  } as unknown as ConfigService;
}

function decryptPlatformData(encryptedData: string, secretKey: string): string {
  const buffer = Buffer.from(encryptedData, "base64");
  const salt = buffer.subarray(0, 16);
  const iv = buffer.subarray(16, 28);
  const encrypted = buffer.subarray(28);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  const authTag = encrypted.subarray(encrypted.length - 16);
  const key = pbkdf2Sync(secretKey, salt, 100000, 32, "sha256");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: 16
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const payload = JSON.parse(decrypted) as { data: string };
  return payload.data;
}

describe("OllamaService platform provider", () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends encrypted platform curl with Gemini key placeholder and ignores local Gemini API key", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: [{ text: "Hello " }, { text: "from Gemini" }]
            }
          }
        ]
      }
    });

    const service = new OllamaService(
      config({
        LLM_PROVIDER: "platform",
        AI_API_URL: "http://platform.example/",
        AI_APP_NAME: "calorie",
        AI_SECRET_KEY: "test-secret",
        GEMINI_API_KEY: "AIza-local-test-key",
        GEMINI_MODEL: "gemini-3-flash-preview"
      })
    );

    const result = await service.chat([
      { role: "system", content: "You are concise." },
      { role: "user", content: "Explain AI." }
    ]);

    expect(result).toBe("Hello from Gemini");
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "http://platform.example/api",
      {
        appName: "calorie",
        data: expect.any(String)
      },
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 180000
      }
    );

    const requestBody = mockedAxios.post.mock.calls[0][1] as { data: string };
    const curlCommand = decryptPlatformData(requestBody.data, "test-secret");

    expect(curlCommand).toContain("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent");
    expect(curlCommand).toContain('-H "Content-Type: application/json"');
    expect(curlCommand).toContain('-H "x-goog-api-key: $GEMINI_API_KEY"');
    expect(curlCommand).not.toContain("AIza-local-test-key");
    expect(curlCommand).toContain(" -d '{");
    expect(curlCommand).toContain("system: You are concise.");
    expect(curlCommand).toContain("user: Explain AI.");
  });

  it("throws when platform secret is missing", async () => {
    const service = new OllamaService(
      config({
        LLM_PROVIDER: "platform",
        AI_API_URL: "http://platform.example"
      })
    );

    await expect(service.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "AI_SECRET_KEY is required when LLM_PROVIDER=platform"
    );
  });

  it("sends platform curl with Gemini key placeholder when no local Gemini key is configured", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: [{ text: "platform managed key" }]
            }
          }
        ]
      }
    });

    const service = new OllamaService(
      config({
        LLM_PROVIDER: "platform",
        AI_API_URL: "http://platform.example",
        AI_SECRET_KEY: "test-secret",
        GEMINI_MODEL: "gemini-3-flash-preview"
      })
    );

    await expect(service.chat([{ role: "user", content: "hello" }])).resolves.toBe(
      "platform managed key"
    );

    const requestBody = mockedAxios.post.mock.calls[0][1] as { data: string };
    const curlCommand = decryptPlatformData(requestBody.data, "test-secret");

    expect(curlCommand).toContain("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent");
    expect(curlCommand).toContain('-H "Content-Type: application/json"');
    expect(curlCommand).toContain('-H "x-goog-api-key: $GEMINI_API_KEY"');
  });

  it("throws when Gemini response has no text", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: []
            }
          }
        ]
      }
    });

    const service = new OllamaService(
      config({
        LLM_PROVIDER: "platform",
        AI_API_URL: "http://platform.example",
        AI_SECRET_KEY: "test-secret",
        GEMINI_API_KEY: "gemini-test-key"
      })
    );

    await expect(service.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "Gemini returned empty response"
    );
  });

  it("calls Gemini API directly when provider is gemini", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: [{ text: "{\"message\":\"hello\"}" }]
            }
          }
        ]
      }
    });

    const service = new OllamaService(
      config({
        LLM_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_MODEL: "gemini-2.5-flash"
      })
    );

    const result = await service.chat([
      { role: "system", content: "Return JSON only." },
      { role: "user", content: "Say hello." }
    ]);

    expect(result).toBe("{\"message\":\"hello\"}");
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Say hello."
              }
            ]
          }
        ],
        systemInstruction: {
          parts: [
            {
              text: "Return JSON only."
            }
          ]
        },
        generationConfig: {
          responseMimeType: "application/json"
        }
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": "gemini-test-key"
        },
        timeout: 180000
      }
    );
  });

  it("throws when Gemini direct API key is missing", async () => {
    const service = new OllamaService(
      config({
        LLM_PROVIDER: "gemini",
        GEMINI_MODEL: "gemini-2.5-flash"
      })
    );

    await expect(service.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "GEMINI_API_KEY is required when LLM_PROVIDER=gemini"
    );
  });

  it("throws a sanitized Gemini API error when direct API returns an error body", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      message: "Request failed with status code 400",
      response: {
        status: 400,
        data: {
          error: {
            status: "INVALID_ARGUMENT",
            message: "API key not valid. Please pass a valid API key."
          }
        }
      }
    });

    const service = new OllamaService(
      config({
        LLM_PROVIDER: "gemini",
        GEMINI_API_KEY: "gemini-test-key",
        GEMINI_MODEL: "gemini-2.5-flash"
      })
    );

    await expect(service.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "Gemini HTTP 400: INVALID_ARGUMENT: API key not valid. Please pass a valid API key."
    );
  });

  it("rejects LLM_PROVIDER=ollama", async () => {
    const service = new OllamaService(
      config({
        LLM_PROVIDER: "ollama",
      }),
    );

    await expect(service.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "LLM_PROVIDER=ollama is no longer supported",
    );
  });
});
