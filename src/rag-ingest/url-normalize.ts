const TRACKING_PARAMS = new Set(["fbclid", "gclid"]);

/**
 * Canonical form of a source URL used for duplicate detection and storage.
 * http/https only; lowercase host, no #hash, no utm_*, fbclid or gclid, no trailing "/" (except the root path),
 * remaining query parameters sorted. Returns null for anything that is not a valid http(s) URL.
 */
export function normalizeSourceUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  const kept = [...url.searchParams.entries()].filter(([key]) => {
    const k = key.toLowerCase();
    return !k.startsWith("utm_") && !TRACKING_PARAMS.has(k);
  });
  kept.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);

  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}
