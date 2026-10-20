import { Module } from "@nestjs/common";
import { OllamaService } from "./ollama.service";
import { GeminiVisionClient } from "./gemini-vision.client";

@Module({
  providers: [OllamaService, GeminiVisionClient],
  exports: [OllamaService, GeminiVisionClient]
})
export class OllamaModule {}
