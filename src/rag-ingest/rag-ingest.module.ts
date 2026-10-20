import { Module } from "@nestjs/common";
import { OllamaModule } from "../ollama/ollama.module";
import { RetrievalModule } from "../retrieval/retrieval.module";
import { DoclingClient } from "./docling.client";
import { ImageTranscriberService } from "./image-transcriber.service";
import { RagFileStorageService } from "./rag-file-storage.service";
import { RagIngestPipeline } from "./rag-ingest.pipeline";
import { RagIngestWorker } from "./rag-ingest.worker";
import { RagStoreService } from "./rag-store.service";
import { GeminiTagger } from "./taggers/gemini-tagger";
import { JevTagger } from "./taggers/jev-tagger";
import { TaggingService } from "./taggers/tagging.service";

@Module({
  imports: [RetrievalModule, OllamaModule],
  providers: [
    RagFileStorageService,
    RagStoreService,
    DoclingClient,
    ImageTranscriberService,
    JevTagger,
    GeminiTagger,
    TaggingService,
    RagIngestPipeline,
    RagIngestWorker,
  ],
  exports: [RagStoreService, RagFileStorageService, TaggingService, DoclingClient],
})
export class RagIngestModule {}
