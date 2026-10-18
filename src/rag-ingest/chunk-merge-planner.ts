export type ExistingChunkState = {
  id: string;
  chunkKey: string;
  sourceContentHash: string | null;
  isManuallyEdited: boolean;
};

export type ChunkMergePlan = {
  /** New keys. */
  insertKeys: string[];
  /** Not manually edited and the source content changed. */
  replaceKeys: string[];
  /** Source content unchanged (edited by hand or not). */
  unchangedKeys: string[];
  /** Manually edited and source content changed: keep content, set needs_review, update source_content_hash. */
  flagReviewKeys: string[];
  /** Manually edited and no longer in the new version: keep, set needs_review. */
  flagReviewMissingIds: string[];
  /** Not manually edited and no longer in the new version. */
  deleteIds: string[];
};

export function planChunkMerge(
  existing: ExistingChunkState[],
  drafts: { chunkKey: string; sourceContentHash: string }[]
): ChunkMergePlan {
  const plan: ChunkMergePlan = {
    insertKeys: [],
    replaceKeys: [],
    unchangedKeys: [],
    flagReviewKeys: [],
    flagReviewMissingIds: [],
    deleteIds: [],
  };
  const existingByKey = new Map(existing.map((chunk) => [chunk.chunkKey, chunk]));
  const draftKeys = new Set(drafts.map((draft) => draft.chunkKey));

  for (const draft of drafts) {
    const current = existingByKey.get(draft.chunkKey);
    if (!current) {
      plan.insertKeys.push(draft.chunkKey);
    } else if (current.sourceContentHash === draft.sourceContentHash) {
      plan.unchangedKeys.push(draft.chunkKey);
    } else if (current.isManuallyEdited) {
      plan.flagReviewKeys.push(draft.chunkKey);
    } else {
      plan.replaceKeys.push(draft.chunkKey);
    }
  }

  for (const chunk of existing) {
    if (draftKeys.has(chunk.chunkKey)) continue;
    if (chunk.isManuallyEdited) plan.flagReviewMissingIds.push(chunk.id);
    else plan.deleteIds.push(chunk.id);
  }

  return plan;
}
