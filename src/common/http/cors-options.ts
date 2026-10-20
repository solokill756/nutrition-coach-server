import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

/** Parses CORS_ORIGINS ("https://a.com, https://b.com") into exact Origin values. */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
}

/**
 * Credentialed CORS for the listed origins. With none configured, keep the
 * old open CORS so an environment that has not set CORS_ORIGINS keeps working.
 */
export function buildCorsOptions(raw: string | undefined): CorsOptions {
  const origins = parseOrigins(raw);
  return origins.length > 0 ? { origin: origins, credentials: true } : {};
}
