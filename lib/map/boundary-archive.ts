export const BOUNDARY_ARCHIVE_FALLBACK = "/api/boundaries/census-2025-b24d0345381f69be.pmtiles";
export const BOUNDARY_ARCHIVE_URL = (typeof process === "undefined" ? undefined : process.env.NEXT_PUBLIC_BOUNDARY_PMTILES_URL) || BOUNDARY_ARCHIVE_FALLBACK;

/** Byte ranges for the immutable national PMTiles file. No whole-archive reads. */
export function boundaryRange(value: string | null): { start: number; end: number } | null {
  const match = /^bytes=(\d+)-(\d+)$/.exec(value ?? "");
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2]);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start
    ? { start, end } : null;
}

export const BOUNDARY_CACHE_HEADERS = {
  "Content-Type": "application/vnd.pmtiles",
  "Accept-Ranges": "bytes",
  "Cache-Control": "public, max-age=31536000, immutable",
  "Netlify-CDN-Cache-Control": "public, durable, max-age=31536000, immutable",
  "Vary": "Range",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, ETag",
} as const;
