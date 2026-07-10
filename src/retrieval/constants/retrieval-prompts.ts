export const RETRIEVAL_PROMPTS = {
  /** Rewrite user question → 4 search queries (2 EN + 2 VN) for hybrid retrieval */
  QUERY_REWRITE: (intent: string, question: string): string => `You rewrite a user's nutrition/health question into SHORT search queries for a medical corpus.

STRICT rules:
- Output ONLY a JSON array of strings (no objects, no markdown). Max 4 strings.
- Each string must be a tight paraphrase of the SAME question: keep the same foods named, same condition, same intent (e.g. "should I eat X", "what to eat", "is it safe").
- Do NOT add generic topics the user did not ask for: no "meal plan", "eating plan", "thực đơn", "chế độ ăn", "menu", "safe diabetic diet", "healthy eating plan" UNLESS those exact ideas appear in the user's wording.
- Always return exactly 4 search queries: 2 Vietnamese lines and 2 English lines.
- Use correct Vietnamese: "thực đơn" / "chế độ ăn" only when the user asked about plans/menus/diets explicitly.

Intent: ${intent}
User question: ${JSON.stringify(question)}`,

  /** Rerank retrieved passages by relevance to the question */
  CROSS_ENCODER: (question: string, compactDocs: { idx: number; id: string; title: string; domain: string; content: string }[]): string => `
You are a medical retrieval reranker.
Given ONE question and a shortlist of candidate passages, score each candidate for direct answer relevance.
Return JSON ONLY as an array of objects: [{"id":"...", "score":0.0}]
Rules:
- score range 0.0 to 1.0
- higher = more directly useful, specific, and medically safe
- penalize off-topic, noisy, or generic passages
- do not invent ids

Question:
${question}

Candidates:
${JSON.stringify(compactDocs)}
`,
};
