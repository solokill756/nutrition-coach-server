/** Default chat model for platform + direct Gemini API. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

const GEMINI_MODEL_ALIASES: Record<string, string> = {
  "gemini 3.1 flash lite": DEFAULT_GEMINI_MODEL,
  "gemini 3.1 flash-lite": DEFAULT_GEMINI_MODEL,
  "gemini-3.1-flash-lite-preview": DEFAULT_GEMINI_MODEL,
  "gemini-3-flash-preview": DEFAULT_GEMINI_MODEL,
  "gemini-2.5-flash": DEFAULT_GEMINI_MODEL,
};

/** Maps env display names / legacy ids to a valid Gemini API model id. */
export function resolveGeminiModel(configured?: string | null): string {
  const raw = configured?.trim();
  if (!raw) {
    return DEFAULT_GEMINI_MODEL;
  }

  const aliasKey = raw.toLowerCase().replace(/\s+/g, " ").trim();
  return GEMINI_MODEL_ALIASES[aliasKey] ?? raw;
}
