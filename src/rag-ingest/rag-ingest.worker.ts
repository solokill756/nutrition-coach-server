import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { RagIngestPipeline } from "./rag-ingest.pipeline";
import { RagStoreService } from "./rag-store.service";

const INTERVAL_NAME = "rag-ingest-worker";
const DEFAULT_POLL_MS = 5000;

function shortMessage(err: unknown): string {
  const raw = typeof (err as { message?: unknown } | null)?.message === "string" ? (err as Error).message : "unknown error";
  return raw.replace(/\s+/g, " ").trim().slice(0, 200);
}

@Injectable()
export class RagIngestWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RagIngestWorker.name);
  private busy = false;
  private handle: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: RagStoreService,
    private readonly pipeline: RagIngestPipeline,
    private readonly registry: SchedulerRegistry,
    private readonly config: ConfigService
  ) {}

  // Not onModuleInit: the RAG tables are created by other modules' onModuleInit hooks.
  async onApplicationBootstrap(): Promise<void> {
    try {
      const reset = await this.store.resetRunningJobs();
      if (reset > 0) this.logger.log(`Re-queued ${reset} interrupted ingest job(s)`);
      if (this.config.get<string>("RAG_INGEST_WORKER_ENABLED") === "false") {
        this.logger.log("RAG ingest worker is disabled");
        return;
      }
      const configured = Number(this.config.get<string>("RAG_INGEST_POLL_MS"));
      const pollMs = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_POLL_MS;
      this.handle = setInterval(() => void this.tick(), pollMs);
      this.registry.addInterval(INTERVAL_NAME, this.handle);
    } catch (err) {
      this.logger.error(`RAG ingest worker failed to start: ${shortMessage(err)}`);
      if (this.handle) {
        clearInterval(this.handle);
        this.handle = null;
      }
    }
  }

  onModuleDestroy(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
    try {
      if (this.registry.doesExist("interval", INTERVAL_NAME)) this.registry.deleteInterval(INTERVAL_NAME);
    } catch {
      // already gone
    }
  }

  /** Claims at most one job. A tick that arrives while another is running is skipped. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const job = await this.store.claimNextJob();
      if (job) await this.pipeline.run(job);
    } catch (err) {
      this.logger.error(`RAG ingest tick failed: ${shortMessage(err)}`);
    } finally {
      this.busy = false;
    }
  }
}
