import { DomainDoc, RetrievalHints } from "./retrieval.types";

const MIN_TOKEN_LENGTH = 2;
const EXPANSION_STOPWORDS = new Set([
  "toi", "ban", "minh", "co", "khong", "gi", "the", "a", "an",
  "nen", "duoc", "va", "la", "mot", "cua", "cho", "voi", "ve",
  "is", "are", "can", "could", "should", "what", "how", "why", "for", "with",
]);

const NOISY_SOURCE_TYPES = new Set(["branded_food", "survey", "catalog"]);
const NOISY_TYPES = new Set(["product_list", "ingredient_list", "product_nutrition"]);
export const EXCLUDED_RAG_DOMAINS = new Set(["foods", "research"]);

/** Normalize text for matching: lowercase, strip diacritics, etc. */
export function normalizeForMatching(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Unicode-aware tokenizer for Vietnamese. */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return normalizeForMatching(text)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LENGTH && !/^\d+$/.test(t));
}

export function extractLink(doc: DomainDoc): string | undefined {
  const metadata = doc.metadata || {};
  const candidates = [
    metadata.reference, metadata.reference_url, metadata.url,
    metadata.source_url, metadata.link, metadata.canonical_url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }
  const fdcId = metadata.fdc_id;
  if (typeof fdcId === "number" || typeof fdcId === "string") {
    return `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${fdcId}/nutrients`;
  }
  return undefined;
}

export function getSourceKey(doc: DomainDoc): string {
  const link = extractLink(doc);
  if (link) {
    try { return new URL(link).hostname.toLowerCase(); } catch { /* fallback */ }
  }
  return String(doc.source || "unknown").toLowerCase();
}

export function getCategoryKey(doc: DomainDoc): string {
  const metadata = doc.metadata || {};
  const sourceType = String(metadata.source_type || "").toLowerCase();
  const type = String(metadata.type || "").toLowerCase();
  const domain = String(metadata.domain || "unknown").toLowerCase();
  return `${domain}:${sourceType || type || "generic"}`;
}

export function titleSimilarity(a: string, b: string): number {
  const aTokens = tokenizeTitleForSimilarity(a);
  const bTokens = tokenizeTitleForSimilarity(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of aTokens) { if (bTokens.has(token)) intersection++; }
  const union = aTokens.size + bTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenizeTitleForSimilarity(value: string): Set<string> {
  return new Set(normalizeForMatching(value).split(/\s+/).filter((t) => t.length > 3));
}

export function hasNearDuplicateTitle(
  selected: Array<{ doc: DomainDoc; score: number }>,
  candidate: { doc: DomainDoc; score: number }
): boolean {
  for (const item of selected) {
    if (titleSimilarity(item.doc.title, candidate.doc.title) > 0.8) return true;
  }
  return false;
}

export function getDomainBoost(domain: string, hints: RetrievalHints): number {
  const intent = hints.intent || "general";
  const hasConditionContext = Boolean(hints.hasConditionContext);
  if (intent === "food_specific") {
    if (domain === "guidelines") return 1.15;
    if (domain === "conditions") return hasConditionContext ? 1.05 : 0.95;
    if (domain === "safety") return hasConditionContext ? 1.0 : 0.9;
    return 1.0;
  }
  if (intent === "condition_specific") {
    if (domain === "conditions") return 1.4;
    if (domain === "guidelines") return 1.1;
    if (domain === "safety") return 1.1;
    return 1.0;
  }
  if (intent === "safety") {
    if (domain === "safety") return 1.45;
    if (domain === "conditions") return 1.25;
    if (domain === "guidelines") return 1.05;
    return 0.95;
  }
  return 1.0;
}

export function getIntentPriority(domain: string, hints: RetrievalHints): number {
  const intent = hints.intent || "general";
  if (intent === "food_specific") {
    if (domain === "guidelines") return 1.12;
    if (domain === "conditions") return 1.0;
    return 1;
  }
  if (intent === "condition_specific") {
    if (domain === "conditions") return 1.35;
    if (domain === "guidelines") return 1.15;
    return 1;
  }
  if (intent === "safety") {
    if (domain === "safety") return 1.4;
    if (domain === "guidelines") return 1.25;
    if (domain === "conditions") return 1.2;
    return 1;
  }
  return 1;
}

export function getAllowedDomains(hints: RetrievalHints): Set<string> | null {
  const intent = hints.intent;
  if (!intent) return null;
  const allowed = new Set<string>();
  const hasCondition = Boolean(hints.hasConditionContext);
  if (intent === "safety") {
    allowed.add("safety"); allowed.add("conditions");
  } else if (intent === "condition_specific") {
    allowed.add("conditions"); allowed.add("guidelines");
  } else if (intent === "food_specific") {
    allowed.add("guidelines");
    if (hasCondition) allowed.add("conditions");
  } else if (intent === "general") {
    allowed.add("guidelines");
  }
  return allowed;
}

export function isChunkDoc(doc: DomainDoc): boolean {
  return Boolean(doc.doc_id || doc.metadata?.chunk_index || doc.metadata?.chunk_total);
}

export function getParentId(doc: DomainDoc): string | undefined {
  return doc.doc_id || (isChunkDoc(doc) ? doc.id.replace(/-chunk-\d+$/i, "") : undefined);
}

export function getChunkIndex(doc: DomainDoc): number | undefined {
  const raw = doc.metadata?.chunk_index;
  return typeof raw === "number" ? raw : undefined;
}

export function getChunkTotal(doc: DomainDoc): number | undefined {
  const raw = doc.metadata?.chunk_total;
  return typeof raw === "number" ? raw : undefined;
}

export function normalizeDocDomain(doc: DomainDoc): DomainDoc {
  const meta = { ...(doc.metadata || {}) } as Record<string, unknown> & { domain?: string };
  const root = doc as unknown as { category?: string };
  const fromMetaCat = meta.category != null ? String(meta.category).trim() : "";
  const fromRootCat = root.category != null ? String(root.category).trim() : "";
  const existing = meta.domain != null ? String(meta.domain).trim() : "";
  if (!existing && (fromMetaCat || fromRootCat)) {
    meta.domain = fromMetaCat || fromRootCat;
  }
  return { ...doc, metadata: meta as DomainDoc["metadata"] };
}

export function excludeFoodDomainDocs(docs: DomainDoc[]): DomainDoc[] {
  return docs
    .map(normalizeDocDomain)
    .filter((doc) => {
      const domain = String(doc.metadata?.domain || "").toLowerCase().trim();
      return !EXCLUDED_RAG_DOMAINS.has(domain);
    });
}

export function isNoisyDoc(doc: DomainDoc): boolean {
  const meta = doc.metadata || {};
  return NOISY_SOURCE_TYPES.has(String(meta.source_type || "")) ||
         NOISY_TYPES.has(String(meta.type || ""));
}
