import { buildRagReferenceBlock, type RagReference } from "./rag-reference-block";

function ref(overrides: Partial<RagReference> = {}): RagReference {
  return {
    title: "Guide › Sodium",
    content: "Keep sodium under 2000 mg per day.",
    source: "guide.pdf",
    ...overrides,
  };
}

describe("buildRagReferenceBlock", () => {
  it("returns None and no references when nothing was retrieved", () => {
    expect(buildRagReferenceBlock([], 1000)).toEqual({ text: "None.", used: [] });
  });

  it("keeps the whole chunk instead of a short prefix", () => {
    const content = "Row. ".repeat(300).trim();
    const { text, used } = buildRagReferenceBlock([ref({ content })], 5000);
    expect(text).toContain(content);
    expect(used).toHaveLength(1);
  });

  it("labels page, block kind and source", () => {
    const { text } = buildRagReferenceBlock(
      [ref({ page: 12, blockKind: "table", link: "https://example.org/g.pdf" })],
      1000,
    );
    expect(text.split("\n")[0]).toBe(
      "[1] Guide › Sodium (page 12; table; source: https://example.org/g.pdf)",
    );
  });

  it("marks image chunks as transcriptions and leaves plain text unlabelled", () => {
    const { text } = buildRagReferenceBlock(
      [ref({ blockKind: "image" }), ref({ title: "Other", blockKind: "text" })],
      1000,
    );
    expect(text).toContain("[1] Guide › Sodium (transcribed from an image; source: guide.pdf)");
    expect(text).toContain("[2] Other (source: guide.pdf)");
  });

  it("drops a chunk that does not fit rather than cutting it, and keeps numbering dense", () => {
    const big = ref({ title: "Big", content: "x".repeat(400) });
    const { text, used } = buildRagReferenceBlock(
      [ref({ title: "A" }), big, ref({ title: "C" })],
      300,
    );
    expect(used.map((r) => r.title)).toEqual(["A", "C"]);
    expect(text).not.toContain("xxx");
    expect(text).toContain("[2] C");
  });

  it("cuts an oversized first chunk at a line boundary, never inside a row", () => {
    const rows = Array.from({ length: 40 }, (_, i) => `Group ${i}; Protein: 60–70 g`).join("\n");
    const { text, used } = buildRagReferenceBlock([ref({ content: rows })], 300);
    expect(used).toHaveLength(1);
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text.endsWith("[…]")).toBe(true);
    const body = text.split("\n").slice(1, -1);
    for (const line of body) expect(line).toMatch(/^Group \d+; Protein: 60–70 g$/);
  });
});
