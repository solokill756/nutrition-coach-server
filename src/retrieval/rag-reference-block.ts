import type { RetrievalResult } from "./retrieval.types";

export type RagReference = Pick<RetrievalResult, "title" | "content" | "source" | "link" | "page" | "blockKind">;

const CUT_MARKER = "[…]";

/**
 * Prompt "Reference" section shared by Recipe Builder and Dashboard AI.
 *
 * Chunks go in whole, in the order given (best first), until `maxChars` is
 * spent. A chunk that does not fit is skipped rather than cut, because a table
 * row cut mid-way ("Protein: 60–") is a wrong number the model will repeat.
 * Only a first chunk that alone exceeds the budget is cut, at a line or
 * sentence boundary. `used` lists what went in, numbered [1..n] in the text.
 */
export function buildRagReferenceBlock<T extends RagReference>(
  refs: T[],
  maxChars: number,
): { text: string; used: T[] } {
  const entries: string[] = [];
  const used: T[] = [];
  let length = 0;

  for (const ref of refs) {
    const header = `[${used.length + 1}] ${ref.title}${formatLabels(ref)}`;
    const content = ref.content.trim();
    const separator = entries.length > 0 ? 2 : 0;
    let entry = `${header}\n${content}`;

    if (length + separator + entry.length > maxChars) {
      if (entries.length > 0) continue;
      const cut = cutAtBoundary(content, maxChars - header.length - 2 - CUT_MARKER.length);
      if (!cut) continue;
      entry = `${header}\n${cut}\n${CUT_MARKER}`;
    }

    entries.push(entry);
    used.push(ref);
    length += separator + entry.length;
  }

  return { text: entries.length > 0 ? entries.join("\n\n") : "None.", used };
}

function formatLabels(ref: RagReference): string {
  const labels: string[] = [];
  if (ref.page != null) labels.push(`page ${ref.page}`);
  if (ref.blockKind === "table") labels.push("table");
  if (ref.blockKind === "image") labels.push("transcribed from an image");
  const source = ref.link ?? ref.source;
  if (source) labels.push(`source: ${source}`);
  return labels.length > 0 ? ` (${labels.join("; ")})` : "";
}

/** Cut points, best first: before a line break, after a sentence end, before a space. */
const BOUNDARIES: Array<{ pattern: RegExp; keep: number }> = [
  { pattern: /\n/g, keep: 0 },
  { pattern: /[.!?](?=\s)/g, keep: 1 },
  { pattern: /\s/g, keep: 0 },
];

/** Longest prefix within `max` chars that ends at a line, sentence or word end. */
function cutAtBoundary(content: string, max: number): string {
  if (max <= 0) return "";
  const window = content.slice(0, max + 1);
  for (const { pattern, keep } of BOUNDARIES) {
    let end = 0;
    for (const match of window.matchAll(pattern)) {
      const candidate = match.index + keep;
      if (candidate <= max) end = candidate;
    }
    if (end > 0) return content.slice(0, end).trimEnd();
  }
  return "";
}
