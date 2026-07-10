import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { PlatformCryptoService } from "../ollama/platform-crypto.service";
import { resolveGeminiModel } from "../ollama/gemini-model.util";
import { VISION_PROMPTS } from "./constants/vision-prompts";

type GeminiPart = { text?: unknown };
type GeminiCandidate = { content?: { parts?: GeminiPart[] } };
type GeminiResponse = { candidates?: GeminiCandidate[] };
type CurlCommandStyle = "plain" | "multiline";
const PLATFORM_GEMINI_API_KEY_PLACEHOLDER = "$GEMINI_API_KEY";

export type DetectedIngredient = {
  name: string;
  confidence: number;
  notes?: string;
};

@Injectable()
export class AiIngredientVisionService {
  private readonly logger = new Logger(AiIngredientVisionService.name);

  constructor(private readonly config: ConfigService) {}

  async recognizeIngredients(imageUrl: string): Promise<DetectedIngredient[]> {
    const provider = this.resolveLlmProvider();
    const apiUrl =
      this.config.get<string>("GEMINI_API_URL") ||
      "https://generativelanguage.googleapis.com/v1beta";
    const model = resolveGeminiModel(
      this.config.get<string>("GEMINI_VISION_MODEL") ||
        this.config.get<string>("GEMINI_MODEL"),
    );
    const image = await this.downloadImage(imageUrl);
    const prompt = this.buildPrompt();

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
      return this.parseIngredients(this.extractText(response.data));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const responseData = (error as { response?: { data?: unknown; status?: number } })?.response;
      if (responseData?.status) {
        this.logger.error(`Gemini ingredient vision HTTP status: ${responseData.status}`);
      }
      const apiError = this.formatErrorData(responseData?.data);
      if (apiError) {
        this.logger.error(`Gemini ingredient vision API error: ${apiError}`);
      }
      if (provider === "platform" && this.isGeminiInvalidJsonPayload(responseData?.data)) {
        this.logger.error("Gemini ingredient vision retrying with multiline curl format");
        try {
          const retryResponse = await this.generateViaPlatform(
            prompt,
            image,
            model,
            PLATFORM_GEMINI_API_KEY_PLACEHOLDER,
            "multiline",
          );
          return this.parseIngredients(this.extractText(retryResponse.data));
        } catch (retryError: unknown) {
          const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
          const retryResponseData = (retryError as { response?: { data?: unknown } })?.response;
          const retryApiError = this.formatErrorData(retryResponseData?.data);
          if (retryApiError) {
            this.logger.error(`Gemini ingredient vision retry API error: ${retryApiError}`);
          }
          this.logger.error(`Gemini ingredient vision retry failed: ${retryMessage}`);
        }
      }
      this.logger.error(`Gemini ingredient vision failed: ${message}`);
      throw new BadRequestException("Could not recognize ingredients from this image.");
    }
  }

  parseIngredients(raw: string): DetectedIngredient[] {
    const trimmed = raw.trim();
    const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return [];
    }

    const root = parsed as { ingredients?: unknown };
    const list = Array.isArray(root.ingredients)
      ? root.ingredients
      : Array.isArray(parsed)
        ? parsed
        : [];

    return list
      .map((item): DetectedIngredient | null => {
        const row = item as Record<string, unknown>;
        const name = String(row.name ?? row.ingredient ?? "").trim();
        if (name.length < 2) {
          return null;
        }
        const rawConfidence = Number(row.confidence ?? 0.7);
        const confidence = Number.isFinite(rawConfidence)
          ? Math.max(0, Math.min(1, rawConfidence))
          : 0.7;
        const notes = row.notes == null ? undefined : String(row.notes).trim();
        return {
          name,
          confidence,
          ...(notes ? { notes } : {}),
        };
      })
      .filter((item): item is DetectedIngredient => item != null)
      .slice(0, 20);
  }

  private async downloadImage(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
    const response = await axios.get<ArrayBuffer>(imageUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 8 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const mimeType = String(response.headers["content-type"] || "image/jpeg").split(";")[0].trim();
    if (!mimeType.startsWith("image/")) {
      throw new BadRequestException("imageUrl must point to an image file.");
    }
    return {
      base64: Buffer.from(response.data).toString("base64"),
      mimeType,
    };
  }

  private async generateViaGemini(
    prompt: string,
    image: { base64: string; mimeType: string },
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
    image: { base64: string; mimeType: string },
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

  private buildPrompt(): string {
    return VISION_PROMPTS.INGREDIENT_RECOGNITION;
  }

  private buildGeminiBody(prompt: string, image: { base64: string; mimeType: string }) {
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
    image: { base64: string; mimeType: string },
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

  private requiredConfig(key: string, message = `${key} is required for ingredient vision.`): string {
    const value = this.config.get<string>(key);
    if (!value || value.trim().length === 0) {
      throw new BadRequestException(message);
    }
    return value.trim();
  }

  private resolveLlmProvider(): "platform" | "gemini" {
    const raw = String(this.config.get<string>("LLM_PROVIDER") || "platform")
      .toLowerCase()
      .trim();

    if (raw === "ollama") {
      throw new BadRequestException(
        "LLM_PROVIDER=ollama is no longer supported. Use platform or gemini.",
      );
    }
    if (raw === "platform") {
      return "platform";
    }
    if (raw === "gemini") {
      return "gemini";
    }

    throw new BadRequestException(`Unsupported LLM_PROVIDER=${raw}. Use platform or gemini.`);
  }

}
