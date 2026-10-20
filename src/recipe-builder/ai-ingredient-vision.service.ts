import { BadRequestException, Injectable } from "@nestjs/common";
import axios from "axios";
import { GeminiVisionClient, InlineImage } from "../ollama/gemini-vision.client";
import { VISION_PROMPTS } from "./constants/vision-prompts";

export type DetectedIngredient = {
  name: string;
  confidence: number;
  notes?: string;
};

@Injectable()
export class AiIngredientVisionService {
  constructor(private readonly gemini: GeminiVisionClient) {}

  async recognizeIngredients(imageUrl: string): Promise<DetectedIngredient[]> {
    const image = await this.downloadImage(imageUrl);

    let raw: string;
    try {
      raw = await this.gemini.generateWithImage(VISION_PROMPTS.INGREDIENT_RECOGNITION, image);
    } catch {
      throw new BadRequestException("Could not recognize ingredients from this image.");
    }
    return this.parseIngredients(raw);
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

    const root = (parsed ?? {}) as { ingredients?: unknown };
    const list = Array.isArray(root.ingredients)
      ? root.ingredients
      : Array.isArray(parsed)
        ? parsed
        : [];

    return list
      .map((item): DetectedIngredient | null => {
        if (typeof item !== "object" || item === null) return null;
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

  private async downloadImage(imageUrl: string): Promise<InlineImage> {
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
}
