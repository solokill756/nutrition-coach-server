import type { RagDomain, RagTags } from "../rag-taxonomy";

export type TagResult = {
  domain: RagDomain;
  tags: RagTags;
  /** Keys: "domain:<key>" or "<group>:<key>". */
  scores: Record<string, number>;
  tagger: "jev" | "gemini";
};

export interface RagTagger {
  readonly name: "jev" | "gemini";
  tag(text: string): Promise<TagResult>;
}
