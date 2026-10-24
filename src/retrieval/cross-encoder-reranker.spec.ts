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

  it("returns the scores the model gives, clamped to 0..1", async () => {
    const chat = jest.fn().mockResolvedValue('[{"id":"a","score":0.9},{"id":"b","score":3}]');
    const reranker = new CrossEncoderReranker({ chat } as unknown as OllamaService, config);
    const scores = await reranker.rerank("salt", [doc("a"), doc("b")]);
    expect([...scores.entries()]).toEqual([["a", 0.9], ["b", 1]]);
  });
});
