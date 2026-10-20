import { planChunkMerge } from "./chunk-merge-planner";

const ex = (k: string, h: string | null, locked = false) => ({
  id: `d-${k}`,
  chunkKey: k,
  sourceContentHash: h,
  isManuallyEdited: locked,
});

describe("planChunkMerge", () => {
  it("plans every case", () => {
    const plan = planChunkMerge(
      [ex("a", "1"), ex("b", "1"), ex("c", "1", true), ex("d", "1", true), ex("e", "1"), ex("f", "1", true)],
      [
        { chunkKey: "a", sourceContentHash: "1" },
        { chunkKey: "b", sourceContentHash: "2" },
        { chunkKey: "c", sourceContentHash: "2" },
        { chunkKey: "d", sourceContentHash: "1" },
        { chunkKey: "g", sourceContentHash: "1" },
      ]
    );
    expect(plan).toEqual({
      insertKeys: ["g"],
      replaceKeys: ["b"],
      unchangedKeys: ["a", "d"],
      flagReviewKeys: ["c"],
      flagReviewMissingIds: ["d-f"],
      deleteIds: ["d-e"],
    });
  });

  it("treats a null stored source hash as changed", () => {
    const plan = planChunkMerge([ex("a", null), ex("b", null, true)], [
      { chunkKey: "a", sourceContentHash: "1" },
      { chunkKey: "b", sourceContentHash: "1" },
    ]);
    expect(plan.replaceKeys).toEqual(["a"]);
    expect(plan.flagReviewKeys).toEqual(["b"]);
  });

  it("handles empty inputs", () => {
    expect(planChunkMerge([], [])).toEqual({
      insertKeys: [],
      replaceKeys: [],
      unchangedKeys: [],
      flagReviewKeys: [],
      flagReviewMissingIds: [],
      deleteIds: [],
    });
    expect(planChunkMerge([], [{ chunkKey: "x", sourceContentHash: "1" }]).insertKeys).toEqual(["x"]);
  });
});
