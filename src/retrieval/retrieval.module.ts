import { Module } from "@nestjs/common";
import { RetrievalService } from "./retrieval.service";
import { PostgresRagService } from "./postgres-rag.service";
import { UserReferenceService } from "./user-reference.service";
import { VectorService } from "./vector.service";
import { RagEvaluateController } from "./rag-evaluate.controller";

import { OllamaModule } from "../ollama/ollama.module";

@Module({
  imports: [OllamaModule],
  controllers: [RagEvaluateController],
  providers: [VectorService, PostgresRagService, RetrievalService, UserReferenceService],
  exports: [RetrievalService, VectorService, PostgresRagService, UserReferenceService]
})
export class RetrievalModule {}
