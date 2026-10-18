import axios from "axios";
import { RAG_TAXONOMY } from "../rag-taxonomy";
import { emptyTags } from "../rag-taxonomy";
import { JevTagger } from "./jev-tagger";
import { GeminiTagger } from "./gemini-tagger";
import { TaggingService } from "./tagging.service";
import type { TagResult } from "./tagger.types";

jest.mock("axios");
const axiosPost = axios.post as jest.Mock;

const totalTaxonomyTags = Object.values(RAG_TAXONOMY).reduce((n, items) => n + items.length, 0);

function cfg(values: Record<string, string | undefined> = {}) {
  const defaults: Record<string, string | undefined> = { TYPESAFE_API_KEY: "test-key" };
  const all = { ...defaults, ...values };
  return { get: (k: string) => all[k] } as any;
}

const okBody = {
  data: {
    answers: {
      domain: { type: "choice", choice: "conditions", probabilities: { conditions: 0.99, guidelines: 0.01, safety: 0 } },
      conditions__diabetes: { type: "noul", noul: 0.99 },
      allergens__shellfish: { type: "noul", noul: 0.96 },
      allergens__peanuts: { type: "noul", noul: 0.01 },
    },
  },
};

const result = (tagger: "jev" | "gemini", domain: TagResult["domain"] = "guidelines"): TagResult => ({
  domain,
  tags: emptyTags(),
  scores: {},
  tagger,
});

describe("JevTagger", () => {
  let tagger: JevTagger;
  beforeEach(() => {
    axiosPost.mockReset();
    tagger = new JevTagger(cfg());
    jest.spyOn(tagger as any, "sleep").mockResolvedValue(undefined);
  });

  it("builds one choice + one noul per taxonomy tag and applies the threshold", async () => {
    axiosPost.mockResolvedValue(okBody);
    const r = await tagger.tag("Người bệnh tiểu đường… dị ứng tôm cua…");
    const [url, body, opts] = axiosPost.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(opts.headers.Authorization).toBe("Bearer test-key");
    expect(body.model).toBe("jev-latest");
    expect(body.questions.domain.type).toBe("choice");
    expect(body.questions.allergens__shellfish.type).toBe("noul");
    expect(Object.keys(body.questions)).toHaveLength(1 + totalTaxonomyTags);
    expect(r).toMatchObject({
      domain: "conditions",
      tagger: "jev",
      tags: { conditions: ["diabetes"], allergens: ["shellfish"] },
    });
    expect(r.scores["allergens:peanuts"]).toBe(0.01);
    expect(r.scores["domain:conditions"]).toBe(0.99);
    expect(r.scores["conditions:hypertension"]).toBe(0);
  });

  it("truncates state to 6000 chars", async () => {
    axiosPost.mockResolvedValue(okBody);
    await tagger.tag("x".repeat(9000));
    expect(axiosPost.mock.calls[0][1].state).toHaveLength(6000);
  });

  it("retries on 429 then succeeds, with 1s/2s backoff", async () => {
    const err = { response: { status: 429 } };
    axiosPost.mockRejectedValueOnce(err).mockRejectedValueOnce(err).mockResolvedValueOnce(okBody);
    const r = await tagger.tag("text");
    expect(axiosPost).toHaveBeenCalledTimes(3);
    expect((tagger as any).sleep.mock.calls.map((c: number[]) => c[0])).toEqual([1000, 2000]);
    expect(r.domain).toBe("conditions");
  });

  it("gives up after 4 attempts on network errors", async () => {
    axiosPost.mockRejectedValue(new Error("ECONNRESET"));
    await expect(tagger.tag("text")).rejects.toThrow();
    expect(axiosPost).toHaveBeenCalledTimes(4);
    expect((tagger as any).sleep.mock.calls.map((c: number[]) => c[0])).toEqual([1000, 2000, 4000]);
  });

  it("throws immediately on a non-429 4xx", async () => {
    axiosPost.mockRejectedValue({ response: { status: 400, data: "bad" } });
    await expect(tagger.tag("text")).rejects.toBeDefined();
    expect(axiosPost).toHaveBeenCalledTimes(1);
  });

  it("fails when the domain answer is missing or invalid", async () => {
    axiosPost.mockResolvedValue({ data: { answers: { conditions__diabetes: { type: "noul", noul: 1 } } } });
    await expect(tagger.tag("text")).rejects.toThrow(/domain/);
    axiosPost.mockResolvedValue({ data: { answers: { domain: { type: "choice", choice: "bogus", probabilities: {} } } } });
    await expect(tagger.tag("text")).rejects.toThrow(/domain/);
  });

  it("honours RAG_TAG_THRESHOLD", async () => {
    const t = new JevTagger(cfg({ RAG_TAG_THRESHOLD: "0.99" }));
    axiosPost.mockResolvedValue(okBody);
    const r = await t.tag("text");
    expect(r.tags.allergens).toEqual([]);
    expect(r.tags.conditions).toEqual(["diabetes"]);
  });
});

describe("GeminiTagger", () => {
  it("drops tags outside the taxonomy", async () => {
    const chat = jest.fn().mockResolvedValue(
      "```json\n" + JSON.stringify({ domain: "conditions", conditions: ["diabetes", "cancer"], allergens: [], goals: [], nutrients: ["sugar"] }) + "\n```",
    );
    const r = await new GeminiTagger({ chat } as any).tag("text");
    expect(r).toMatchObject({ domain: "conditions", tagger: "gemini", tags: { conditions: ["diabetes"], nutrients: ["sugar"] } });
    expect(r.scores["conditions:diabetes"]).toBe(1);
    expect(r.scores["domain:conditions"]).toBe(1);
  });

  it("falls back to guidelines for an invalid domain", async () => {
    const chat = jest.fn().mockResolvedValue(JSON.stringify({ domain: "nope", conditions: [] }));
    const r = await new GeminiTagger({ chat } as any).tag("text");
    expect(r.domain).toBe("guidelines");
  });

  it("throws on unparseable JSON", async () => {
    const chat = jest.fn().mockResolvedValue("not json at all");
    await expect(new GeminiTagger({ chat } as any).tag("text")).rejects.toThrow();
  });
});

describe("TaggingService", () => {
  const mk = (jevImpl: (t: string) => Promise<TagResult>, gemImpl?: (t: string) => Promise<TagResult>, config = cfg()) => {
    const jev = { name: "jev", tag: jest.fn(jevImpl) } as any;
    const gemini = { name: "gemini", tag: jest.fn(gemImpl ?? (async () => result("gemini"))) } as any;
    return { jev, gemini, svc: new TaggingService(jev, gemini, config) };
  };

  it("switches to Gemini after 3 consecutive Jev failures", async () => {
    const { jev, gemini, svc } = mk(async () => {
      throw new Error("down");
    });
    const progress = jest.fn();
    const { results, warnings } = await svc.tagAll(["a", "b", "c", "d", "e"], progress);
    expect(jev.tag).toHaveBeenCalledTimes(3);
    expect(gemini.tag).toHaveBeenCalledTimes(5);
    expect(results.every((r) => r?.tagger === "gemini")).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("switched to Gemini");
    expect(warnings[0]).toContain("chunk 3");
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it("does not switch when Jev failures are not consecutive", async () => {
    let i = 0;
    const { jev, gemini, svc } = mk(async () => {
      if (i++ % 2 === 0) throw new Error("flaky");
      return result("jev");
    });
    const { results, warnings } = await svc.tagAll(["a", "b", "c", "d", "e", "f"]);
    expect(jev.tag).toHaveBeenCalledTimes(6);
    expect(gemini.tag).toHaveBeenCalledTimes(3);
    expect(results.map((r) => r?.tagger)).toEqual(["gemini", "jev", "gemini", "jev", "gemini", "jev"]);
    expect(warnings).toEqual([]);
  });

  it("returns null when both taggers fail for a chunk", async () => {
    const { svc } = mk(
      async () => {
        throw new Error("jev");
      },
      async () => {
        throw new Error("gem");
      },
    );
    const { results } = await svc.tagAll(["a"]);
    expect(results).toEqual([null]);
  });

  it("uses only Gemini when RAG_TAGGER=gemini", async () => {
    const { jev, gemini, svc } = mk(async () => result("jev"), undefined, cfg({ RAG_TAGGER: "gemini" }));
    const { results, warnings } = await svc.tagAll(["a", "b"]);
    expect(jev.tag).not.toHaveBeenCalled();
    expect(gemini.tag).toHaveBeenCalledTimes(2);
    expect(results.every((r) => r?.tagger === "gemini")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("uses Gemini with a warning when TYPESAFE_API_KEY is missing", async () => {
    const { jev, svc } = mk(async () => result("jev"), undefined, cfg({ TYPESAFE_API_KEY: "" }));
    const { results, warnings } = await svc.tagAll(["a"]);
    expect(jev.tag).not.toHaveBeenCalled();
    expect(results[0]?.tagger).toBe("gemini");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("TYPESAFE_API_KEY");
  });

  it("tagOne tries Jev, falls back to Gemini, throws when both fail", async () => {
    const a = mk(async () => result("jev"));
    expect((await a.svc.tagOne("x")).tagger).toBe("jev");
    const b = mk(async () => {
      throw new Error("x");
    });
    expect((await b.svc.tagOne("x")).tagger).toBe("gemini");
    const c = mk(
      async () => {
        throw new Error("x");
      },
      async () => {
        throw new Error("y");
      },
    );
    await expect(c.svc.tagOne("x")).rejects.toThrow();
  });
});
