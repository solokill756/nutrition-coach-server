import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { PlatformCryptoService } from "./platform-crypto.service";
import { resolveGeminiModel } from "./gemini-model.util";

type GeminiPart = { text?: unknown };
type GeminiCandidate = { content?: { parts?: GeminiPart[] } };
type GeminiResponse = { candidates?: GeminiCandidate[] };
type CurlCommandStyle = "plain" | "multiline";

const PLATFORM_GEMINI_API_KEY_PLACEHOLDER = "$GEMINI_API_KEY";

export type InlineImage = { base64: string; mimeType: string };

@Injectable()
export class GeminiVisionClient {
  private readonly logger = new Logger(GeminiVisionClient.name);

  constructor(private readonly config: ConfigService) {}

  async generateWithImage(prompt: string, image: InlineImage): Promise<string> {
    const provider = this.resolveLlmProvider();
    const apiUrl =
      this.config.get<string>("GEMINI_API_URL") ||
      "https://generativelanguage.googleapis.com/v1beta";
    const model = resolveGeminiModel(
      this.config.get<string>("GEMINI_VISION_MODEL") ||
        this.config.get<string>("GEMINI_MODEL"),
    );

    try {
      const response = provider === "platform"
        ? await this.generateViaPlatform(
          prompt,
          image,
          model,
          PLATFORM_GEMINI_API_KEY_PLACEHOLDER,
          "plain",
        )
        : await this.generateViaGemini(
          prompt,
          image,
          apiUrl,
          model,
          this.requiredConfig("GEMINI_API_KEY"),
        );
      return this.extractText(response.data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const responseData = (error as { response?: { data?: unknown; status?: number } })?.response;
      if (responseData?.status) {
        this.logger.error(`Gemini vision HTTP status: ${responseData.status}`);
      }
      const apiError = this.formatErrorData(responseData?.data);
      if (apiError) {
        this.logger.error(`Gemini vision API error: ${apiError}`);
      }
      if (provider === "platform" && this.isGeminiInvalidJsonPayload(responseData?.data)) {
        this.logger.error("Gemini vision retrying with multiline curl format");
        try {
          const retryResponse = await this.generateViaPlatform(
            prompt,
            image,
            model,
            PLATFORM_GEMINI_API_KEY_PLACEHOLDER,
            "multiline",
          );
          return this.extractText(retryResponse.data);
        } catch (retryError: unknown) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          const retryResponseData = (retryError as { response?: { data?: unknown } })?.response;
          const retryApiError = this.formatErrorData(retryResponseData?.data);
          if (retryApiError) {
            this.logger.error(`Gemini vision retry API error: ${retryApiError}`);
          }
          this.logger.error(`Gemini vision retry failed: ${retryMessage}`);
        }
      }
      this.logger.error(`Gemini vision failed: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }
  }

  private async generateViaGemini(
    prompt: string,
    image: InlineImage,
    apiUrl: string,
    model: string,
    apiKey: string,
  ) {
    return axios.post<GeminiResponse>(
      `${apiUrl.replace(/\/+$/, "")}/models/${model}:generateContent`,
      this.buildGeminiBody(prompt, image),
      {
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        timeout: 180000,
      },
    );
  }

  private async generateViaPlatform(
    prompt: string,
    image: InlineImage,
    model: string,
    apiKey: string | undefined,
    style: CurlCommandStyle,
  ) {
    const aiApiUrl = this.requiredConfig("AI_API_URL", "AI_API_URL is required when LLM_PROVIDER=platform");
    const secretKey = this.requiredConfig("AI_SECRET_KEY", "AI_SECRET_KEY is required when LLM_PROVIDER=platform");
    const appName = this.config.get<string>("AI_APP_NAME") || "calorie";
    const curlCommand = this.buildGeminiCurlCommand(prompt, image, model, apiKey, style);
    const encryptedData = PlatformCryptoService.encrypt(curlCommand, secretKey);

    return axios.post<GeminiResponse>(
      `${aiApiUrl.replace(/\/+$/, "")}/api`,
      {
        appName,
        data: encryptedData,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 180000,
      },
    );
  }

  private buildGeminiBody(prompt: string, image: InlineImage) {
    return {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: image.mimeType,
                data: image.base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    };
  }

  private buildGeminiCurlCommand(
    prompt: string,
    image: InlineImage,
    model: string,
    apiKey: string | undefined,
    style: CurlCommandStyle,
  ): string {
    if (style === "multiline") {
      const apiKeyHeader = apiKey
        ? `  -H ${this.shellSingleQuote(`x-goog-api-key: ${apiKey}`)} \\\n`
        : "";
      return `curl "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent" \\
  -H ${this.shellSingleQuote("Content-Type: application/json")} \\
${apiKeyHeader}  -X POST \\
  -d ${this.shellSingleQuote(JSON.stringify(this.buildGeminiBody(prompt, image)))}`;
    }

    const command = [
      "curl",
      "-X",
      "POST",
      this.shellDoubleQuote(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`),
      "-H",
      this.shellDoubleQuote("Content-Type: application/json"),
      "-d",
      this.shellSingleQuote(this.jsonForSingleQuotedCurlData(this.buildGeminiBody(prompt, image))),
    ];

    if (apiKey) {
      command.splice(6, 0, "-H", this.shellDoubleQuote(`x-goog-api-key: ${apiKey}`));
    }

    return command.join(" ");
  }

  private shellSingleQuote(value: string): string {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }

  private shellDoubleQuote(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  private jsonForSingleQuotedCurlData(value: unknown): string {
    return JSON.stringify(value).replace(/'/g, "\\u0027");
  }

  private formatErrorData(data: unknown): string | undefined {
    if (data == null) {
      return undefined;
    }

    const text = typeof data === "string" ? data : JSON.stringify(data);
    return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
  }

  private isGeminiInvalidJsonPayload(data: unknown): boolean {
    const text = this.formatErrorData(data) || "";
    return text.includes("Invalid JSON payload received") && text.includes("Root element must be a message");
  }

  private extractText(data: GeminiResponse): string {
    const text = data.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text)
      .filter((partText): partText is string => typeof partText === "string" && partText.trim().length > 0)
      .join("")
      .trim();
    if (!text) {
      throw new Error("Gemini returned empty response");
    }
    return text;
  }

  private requiredConfig(key: string, message = `${key} is required for Gemini vision.`): string {
    const value = this.config.get<string>(key);
    if (!value || value.trim().length === 0) {
      throw new Error(message);
    }
    return value.trim();
  }

  private resolveLlmProvider(): "platform" | "gemini" {
    const raw = String(this.config.get<string>("LLM_PROVIDER") || "platform")
      .toLowerCase()
      .trim();

    if (raw === "ollama") {
      throw new Error("LLM_PROVIDER=ollama is no longer supported. Use platform or gemini.");
    }
    if (raw === "platform" || raw === "gemini") {
      return raw;
    }

    throw new Error(`Unsupported LLM_PROVIDER=${raw}. Use platform or gemini.`);
  }
}
