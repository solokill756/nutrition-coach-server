import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { PlatformCryptoService } from "./platform-crypto.service";
import { DEFAULT_GEMINI_MODEL, resolveGeminiModel } from "./gemini-model.util";

type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GeminiPart = {
  text?: unknown;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiPart[];
  };
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};

type GeminiErrorResponse = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type HttpErrorLike = {
  message?: string;
  response?: {
    status?: number;
    data?: unknown;
  };
};

type CurlCommandStyle = "plain" | "multiline";
const PLATFORM_GEMINI_API_KEY_PLACEHOLDER = "$GEMINI_API_KEY";
type LlmProvider = "platform" | "gemini";

@Injectable()
export class OllamaService implements OnModuleInit {
  private isWarmedUp = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.logRuntimeConfig();

    if (!this.shouldWarmup()) {
      console.log("[LLM] Warmup skipped");
      return;
    }

    this.warmup().catch((err: Error) => {
      console.warn("[LLM] Warmup failed (non-critical):", err.message);
    });
  }

  async warmup(): Promise<void> {
    if (this.isWarmedUp) return;

    console.log("[LLM] Starting warmup...");
    const startTime = Date.now();

    try {
      await this.chat([
        {
          role: "user",
          content: "Say 'ready' in one word"
        }
      ]);
      const elapsed = Date.now() - startTime;
      this.isWarmedUp = true;
      console.log(`[LLM] Warmup complete in ${elapsed}ms`);
    } catch (error) {
      console.error("[LLM] Warmup error:", error);
      throw error;
    }
  }

  async chat(messages: Message[]): Promise<string> {
    const provider = this.resolveLlmProvider();
    console.log(`[LLM] Provider selected: ${provider}`);

    if (provider === "platform") {
      return this.chatViaPlatform(messages);
    }

    return this.chatViaGemini(messages);
  }

  private resolveLlmProvider(): LlmProvider {
    const raw = String(this.config.get<string>("LLM_PROVIDER") || "platform")
      .toLowerCase()
      .trim();

    if (raw === "ollama") {
      throw new Error(
        "LLM_PROVIDER=ollama is no longer supported. Use platform or gemini.",
      );
    }
    if (raw === "platform") {
      return "platform";
    }
    if (raw === "gemini") {
      return "gemini";
    }

    throw new Error(`Unsupported LLM_PROVIDER=${raw}. Use platform or gemini.`);
  }

  private shouldWarmup(): boolean {
    const raw = this.config.get<string>("LLM_WARMUP_ENABLED");
    return raw != null && raw.trim().length > 0 && raw.toLowerCase() === "true";
  }

  private async chatViaPlatform(messages: Message[]): Promise<string> {
    const aiApiUrl = this.requiredConfig("AI_API_URL");
    const secretKey = this.requiredConfig("AI_SECRET_KEY");
    const appName = this.config.get<string>("AI_APP_NAME") || "calorie";
    const model = resolveGeminiModel(this.config.get<string>("GEMINI_MODEL"));

    const totalStart = Date.now();
    console.log(`[PLATFORM_LLM] Chat request #${Math.random().toString(36).slice(-5).toUpperCase()}`);
    console.log(`[PLATFORM_LLM]    App: ${appName} | Model: ${model} | Endpoint: ${aiApiUrl}`);
    console.log("[PLATFORM_LLM]    Gemini key: platform-placeholder");
    console.log(`[PLATFORM_LLM]    Messages: ${messages.length} | User prompt length: ${messages[messages.length - 1]?.content?.length || 0} chars`);

    try {
      const reqStart = Date.now();
      const response = await this.postPlatformGemini(
        aiApiUrl,
        appName,
        secretKey,
        this.buildGeminiCurlCommand(messages, model, PLATFORM_GEMINI_API_KEY_PLACEHOLDER, "plain"),
      );

      const content = this.extractGeminiText(response.data);
      const reqElapsed = Date.now() - reqStart;
      const totalElapsed = Date.now() - totalStart;

      console.log("[PLATFORM_LLM] SUCCESS!");
      console.log(`[PLATFORM_LLM]    Request time: ${reqElapsed}ms`);
      console.log(`[PLATFORM_LLM]    Response length: ${content.length} chars`);
      console.log(`[PLATFORM_LLM]    Total time: ${totalElapsed}ms`);

      return content;
    } catch (error: unknown) {
      const totalElapsed = Date.now() - totalStart;
      const err = error as HttpErrorLike;
      console.error(`[PLATFORM_LLM] ERROR after ${totalElapsed}ms`);
      console.error(`[PLATFORM_LLM]    Message: ${err.message}`);
      if (err.response?.status) {
        console.error(`[PLATFORM_LLM]    HTTP Status: ${err.response.status}`);
      }
      const platformError = this.formatErrorData(err.response?.data);
      if (platformError) {
        console.error(`[PLATFORM_LLM]    API Error: ${platformError}`);
      }
      if (this.isGeminiInvalidJsonPayload(err.response?.data)) {
        console.error("[PLATFORM_LLM]    Retrying with multiline curl format");
        try {
          const retryResponse = await this.postPlatformGemini(
            aiApiUrl,
            appName,
            secretKey,
            this.buildGeminiCurlCommand(messages, model, PLATFORM_GEMINI_API_KEY_PLACEHOLDER, "multiline"),
          );
          return this.extractGeminiText(retryResponse.data);
        } catch (retryError: unknown) {
          const retryErr = retryError as HttpErrorLike;
          console.error(`[PLATFORM_LLM]    Retry failed: ${retryErr.message}`);
          const retryPlatformError = this.formatErrorData(retryErr.response?.data);
          if (retryPlatformError) {
            console.error(`[PLATFORM_LLM]    Retry API Error: ${retryPlatformError}`);
          }
        }
      }
      throw error;
    }
  }

  private async chatViaGemini(messages: Message[]): Promise<string> {
    const apiKey = this.requiredConfig(
      "GEMINI_API_KEY",
      "GEMINI_API_KEY is required when LLM_PROVIDER=gemini",
    );
    const apiUrl =
      this.config.get<string>("GEMINI_API_URL") ||
      "https://generativelanguage.googleapis.com/v1beta";
    const model = resolveGeminiModel(this.config.get<string>("GEMINI_MODEL"));

    // Extract system instruction if present
    const systemMessage = messages.find((m) => m.role === "system");
    const systemInstruction = systemMessage
      ? { parts: [{ text: systemMessage.content }] }
      : undefined;

    // Build contents payload (excluding system messages)
    const userMessages = messages.filter((m) => m.role !== "system");
    const contents = userMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : m.role,
      parts: [{ text: m.content }]
    }));

    // Detect if JSON mode is requested
    const needsJson = messages.some((m) =>
      m.content.toLowerCase().includes("json") ||
      m.content.toLowerCase().includes("output valid json")
    );
    const generationConfig = needsJson
      ? { responseMimeType: "application/json" }
      : undefined;

    const body: any = {
      contents
    };
    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }
    if (generationConfig) {
      body.generationConfig = generationConfig;
    }

    const totalStart = Date.now();
    console.log(`[GEMINI] Chat request #${Math.random().toString(36).slice(-5).toUpperCase()}`);
    console.log(`[GEMINI]    Model: ${model} | Endpoint: ${apiUrl}`);
    console.log(`[GEMINI]    API key: ${this.maskSecret(apiKey)}`);
    console.log(`[GEMINI]    Messages: ${messages.length} | User prompt length: ${messages[messages.length - 1]?.content?.length || 0} chars`);

    let responseData: GeminiResponse | undefined;
    let reqElapsed = 0;

    try {
      let attempt = 0;
      const maxAttempts = 3;
      while (attempt < maxAttempts) {
        attempt++;
        try {
          const reqStart = Date.now();
          const response = await axios.post<GeminiResponse>(
            `${apiUrl.replace(/\/+$/, "")}/models/${model}:generateContent`,
            body,
            {
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
              },
              timeout: 180000
            }
          );
          responseData = response.data;
          reqElapsed = Date.now() - reqStart;
          break; // Success
        } catch (error: any) {
          if (error.response?.status === 429 && attempt < maxAttempts) {
            const retryAfterSec = 5;
            console.warn(
              `[GEMINI] ⚠️ Rate limit exceeded (429). Retrying in ${retryAfterSec} seconds (attempt ${attempt}/${maxAttempts})...`
            );
            await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
            continue;
          }
          throw error;
        }
      }

      if (!responseData) {
        throw new Error("No response data from Gemini");
      }

      const content = this.extractGeminiText(responseData);
      const totalElapsed = Date.now() - totalStart;

      console.log("[GEMINI] SUCCESS!");
      console.log(`[GEMINI]    Request time: ${reqElapsed}ms`);
      console.log(`[GEMINI]    Response length: ${content.length} chars`);
      console.log(`[GEMINI]    Total time: ${totalElapsed}ms`);

      return content;
    } catch (error: unknown) {
      const totalElapsed = Date.now() - totalStart;
      const err = error as HttpErrorLike;
      const geminiError = this.extractGeminiErrorMessage(err.response?.data);
      console.error(`[GEMINI] ERROR after ${totalElapsed}ms`);
      console.error(`[GEMINI]    Message: ${err.message}`);
      if (err.response?.status) {
        console.error(`[GEMINI]    HTTP Status: ${err.response.status}`);
      }
      if (geminiError) {
        console.error(`[GEMINI]    API Error: ${geminiError}`);
      }

      throw new Error(this.buildProviderErrorMessage("Gemini", err, geminiError));
    }
  }

  private async postPlatformGemini(
    aiApiUrl: string,
    appName: string,
    secretKey: string,
    curlCommand: string,
  ) {
    const encryptedData = PlatformCryptoService.encrypt(curlCommand, secretKey);
    return axios.post<GeminiResponse>(
      `${aiApiUrl.replace(/\/+$/, "")}/api`,
      {
        appName,
        data: encryptedData
      },
      {
        headers: {
          "Content-Type": "application/json"
        },
        timeout: 180000
      }
    );
  }

  private buildGeminiCurlCommand(messages: Message[], model: string, apiKey: string | undefined, style: CurlCommandStyle): string {
    const prompt = this.buildGeminiPrompt(messages);
    const body = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ]
    };

    if (style === "multiline") {
      const apiKeyHeader = apiKey
        ? `  -H ${this.shellSingleQuote(`x-goog-api-key: ${apiKey}`)} \\\n`
        : "";
      return `curl "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent" \\
  -H ${this.shellSingleQuote("Content-Type: application/json")} \\
${apiKeyHeader}  -X POST \\
  -d ${this.shellSingleQuote(JSON.stringify(body))}`;
    }

    const command = [
      "curl",
      "-X",
      "POST",
      this.shellDoubleQuote(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`),
      "-H",
      this.shellDoubleQuote("Content-Type: application/json"),
      "-d",
      this.shellSingleQuote(this.jsonForSingleQuotedCurlData(body)),
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

  private logRuntimeConfig(): void {
    const configured = String(this.config.get<string>("LLM_PROVIDER") || "platform").toLowerCase();
    const model = resolveGeminiModel(this.config.get<string>("GEMINI_MODEL"));
    const directKey = this.config.get<string>("GEMINI_API_KEY") || "";
    const platformUrl = this.config.get<string>("AI_API_URL") || "";

    console.log(
      `[LLM] Runtime config provider=${configured} geminiModel=${model} ` +
        `(default=${DEFAULT_GEMINI_MODEL}) ` +
        `geminiKey=${this.maskSecret(directKey)} platformUrl=${platformUrl || "(empty)"} ` +
        `(LLM: platform|gemini only; Ollama is embeddings-only via OLLAMA_BASE_URL)`,
    );
  }

  private maskSecret(value: string | undefined): string {
    const trimmed = value?.trim() || "";
    if (!trimmed) {
      return "missing";
    }
    if (trimmed.length <= 8) {
      return `present(len=${trimmed.length})`;
    }
    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}(len=${trimmed.length})`;
  }

  private extractGeminiText(data: GeminiResponse): string {
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

  private extractGeminiErrorMessage(data: unknown): string | undefined {
    const error = (data as GeminiErrorResponse | undefined)?.error;
    const parts = [error?.status, error?.message].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0,
    );

    return parts.length > 0 ? parts.join(": ") : undefined;
  }

  private buildProviderErrorMessage(
    provider: string,
    error: HttpErrorLike,
    providerMessage?: string,
  ): string {
    const status = error.response?.status ? `HTTP ${error.response.status}` : "request failed";
    const detail = providerMessage || error.message || "unknown error";
    return `${provider} ${status}: ${detail}`;
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

  private requiredConfig(
    key: string,
    message = `${key} is required when LLM_PROVIDER=platform`,
  ): string {
    const value = this.config.get<string>(key);

    if (!value || value.trim().length === 0) {
      throw new Error(message);
    }

    return value.trim();
  }

  private buildGeminiPrompt(messages: Message[]): string {
    return messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");
  }
}
