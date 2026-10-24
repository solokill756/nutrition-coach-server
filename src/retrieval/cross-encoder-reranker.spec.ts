import { ConfigService } from "@nestjs/config";
import { OllamaService } from "../ollama/ollama.service";
import { CrossEncoderReranker } from "./cross-encoder-reranker";
import type { DomainDoc } from "./retrieval.types";

function candidatesSent(chat: jest.Mock): { id: string; content: string }[] {
  const prompt: string = chat.mock.calls[0][0][1].content;
  return JSON.parse(prompt.slice(prompt.indexOf("Candidates:") + "Candidates:".length).trim());
}

const doc = (id: string): DomainDoc =>
  ({ id, source: "s", title: `Title ${id}`, content: `${id} `.repeat(400), metadata: { domain: "guidelines" } }) as DomainDoc;

describe("CrossEncoderReranker", () => {
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  // #37: a ~12k-char prompt (10 passages x 900 chars) made the LLM rerank take 16-20 s.
  it("sends at most 6 candidates, in the given order, each cut to 500 characters", async () => {
    const chat = jest.fn().mockResolvedValue("[]");
    const reranker = new CrossEncoderReranker({ chat } as unknown as OllamaService, config);
    await reranker.rerank("salt", ["a", "b", "c", "d", "e", "f", "g", "h"].map(doc));
    const sent = candidatesSent(chat);
    expect(sent.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    for (const c of sent) expect(c.content.length).toBeLessThanOrEqual(500);
  });

  describe("timeout", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    // #37: the LLM rerank took 16-20 s; past the timeout the existing order is used.
    it("gives up after 5 s by default and returns no scores", async () => {
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const chat = jest.fn(() => new Promise<string>(() => undefined));
      const reranker = new CrossEncoderReranker({ chat } as unknown as OllamaService, config);
      const result = reranker.rerank("salt", [doc("a")]);
      await jest.advanceTimersByTimeAsync(4999);
      let settled = false;
      void result.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect((await result).size).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("rerank"), expect.stringContaining("timed out after 5000 ms"));
    });

    it("honours RETRIEVAL_CROSS_ENCODER_TIMEOUT_MS", async () => {
      jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const chat = jest.fn(() => new Promise<string>(() => undefined));
      const custom = { get: jest.fn((k: string) => (k === "RETRIEVAL_CROSS_ENCODER_TIMEOUT_MS" ? "1200" : undefined)) } as unknown as ConfigService;
      const reranker = new CrossEncoderReranker({ chat } as unknown as OllamaService, custom);
      const result = reranker.rerank("salt", [doc("a")]);
      await jest.advanceTimersByTimeAsync(1200);
      expect((await result).size).toBe(0);
    });
  });

  it("returns the scores the model gives, clamped to 0..1", async () => {
    const chat = jest.fn().mockResolvedValue('[{"id":"a","score":0.9},{"id":"b","score":3}]');
    const reranker = new CrossEncoderReranker({ chat } as unknown as OllamaService, config);
    const scores = await reranker.rerank("salt", [doc("a"), doc("b")]);
    expect([...scores.entries()]).toEqual([["a", 0.9], ["b", 1]]);
  });
});
