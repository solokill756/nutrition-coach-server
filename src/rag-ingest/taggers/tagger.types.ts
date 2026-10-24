import type { RagDomain, RagTags } from "../rag-taxonomy";

export type TagResult = {
  domain: RagDomain;
  tags: RagTags;
  /** Keys: "domain:<key>" or "<group>:<key>". */
  scores: Record<string, number>;
  tagger: "jev" | "gemini";
};

/** A chunk to tag. Title and heading are context only: a table often names its condition or group only in the heading. */
export type TagInput = {
  text: string;
  documentTitle: string;
  headingPath: string;
};

export interface RagTagger {
  readonly name: "jev" | "gemini";
  tag(input: TagInput): Promise<TagResult>;
}

/**
 * The text a tagger sees: title and heading lines, then the passage, at most maxChars long.
 * Only the passage is truncated. With no title and no heading it is the passage alone.
 */
export function tagInputText(input: TagInput, maxChars: number): string {
  const context = [
    input.documentTitle.trim() ? `Document title: ${input.documentTitle.trim()}` : "",
    input.headingPath.trim() ? `Section: ${input.headingPath.trim()}` : "",
  ].filter((line) => line !== "");
  if (context.length === 0) return input.text.slice(0, maxChars);
  const prefix = `${context.join("\n")}\n\nPassage:\n`;
  return prefix + input.text.slice(0, Math.max(0, maxChars - prefix.length));
}
