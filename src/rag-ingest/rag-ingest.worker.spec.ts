import { RagIngestWorker } from "./rag-ingest.worker";

function setup(env: Record<string, string> = {}) {
  const order: string[] = [];
  const store: any = {
    resetRunningJobs: jest.fn(async () => {
      order.push("reset");
      return 0;
    }),
    claimNextJob: jest.fn().mockResolvedValue(null),
  };
  const pipeline: any = { run: jest.fn().mockResolvedValue(undefined) };
  const registry: any = {
    addInterval: jest.fn(() => order.push("register")),
    doesExist: jest.fn().mockReturnValue(true),
    deleteInterval: jest.fn(),
  };
  const config: any = { get: (k: string) => env[k] };
  const worker = new RagIngestWorker(store, pipeline, registry, config);
  return { worker, store, pipeline, registry, order };
}

describe("RagIngestWorker", () => {
  afterEach(() => jest.restoreAllMocks());

  it("resets running jobs before registering the interval on bootstrap", async () => {
    const s = setup();
    await s.worker.onApplicationBootstrap();
    expect(s.order).toEqual(["reset", "register"]);
    expect(s.registry.addInterval).toHaveBeenCalledWith(expect.any(String), expect.anything());
    clearInterval(s.registry.addInterval.mock.calls[0][1]);
  });

  it("uses RAG_INGEST_POLL_MS for the interval", async () => {
    const spy = jest.spyOn(global, "setInterval");
    const s = setup({ RAG_INGEST_POLL_MS: "1234" });
    await s.worker.onApplicationBootstrap();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), 1234);
    clearInterval(s.registry.addInterval.mock.calls[0][1]);
  });

  it("does not register the interval when RAG_INGEST_WORKER_ENABLED=false", async () => {
    const s = setup({ RAG_INGEST_WORKER_ENABLED: "false" });
    await s.worker.onApplicationBootstrap();
    expect(s.store.resetRunningJobs).toHaveBeenCalled();
    expect(s.registry.addInterval).not.toHaveBeenCalled();
  });

  it("does not crash bootstrap when the DB fails", async () => {
    const s = setup();
    s.store.resetRunningJobs.mockRejectedValue(new Error("no table"));
    await expect(s.worker.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it("tick claims one job and runs it", async () => {
    const s = setup();
    const job = { id: "1" };
    s.store.claimNextJob.mockResolvedValue(job);
    await s.worker.tick();
    expect(s.pipeline.run).toHaveBeenCalledWith(job);
  });

  it("tick does nothing when no job is pending", async () => {
    const s = setup();
    await s.worker.tick();
    expect(s.pipeline.run).not.toHaveBeenCalled();
  });

  it("skips a tick while another is busy", async () => {
    const s = setup();
    let release!: () => void;
    s.store.claimNextJob.mockResolvedValue({ id: "1" });
    s.pipeline.run.mockImplementation(() => new Promise<void>((r) => (release = r)));
    const first = s.worker.tick();
    await new Promise((r) => setImmediate(r));
    await s.worker.tick();
    expect(s.store.claimNextJob).toHaveBeenCalledTimes(1);
    release();
    await first;
    s.pipeline.run.mockResolvedValue(undefined);
    await s.worker.tick();
    expect(s.store.claimNextJob).toHaveBeenCalledTimes(2);
  });

  it("tick swallows errors and frees the busy flag", async () => {
    const s = setup();
    s.store.claimNextJob.mockRejectedValueOnce(new Error("db"));
    await expect(s.worker.tick()).resolves.toBeUndefined();
    await s.worker.tick();
    expect(s.store.claimNextJob).toHaveBeenCalledTimes(2);
  });
});
