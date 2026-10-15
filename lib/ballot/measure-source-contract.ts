import type { MeasureSourceReference } from "./types.ts";

export function measureSourceReferenceValid(value: unknown): value is MeasureSourceReference {
  const seen = new Set<object>();
  const valid = (input: unknown, depth: number): boolean => {
    if (!input || typeof input !== "object" || Array.isArray(input) || depth > 8 || seen.has(input)) return false;
    seen.add(input);
    const row = input as Record<string, unknown>, vault = row.vault as Record<string, unknown> | undefined;
    if ("text" in row || typeof row.sourceUrl !== "string" || typeof row.sourceHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(row.sourceHash) || typeof row.publisher !== "string" || !row.publisher.trim() ||
        typeof row.retrievedAt !== "string" || !Number.isFinite(Date.parse(row.retrievedAt)) ||
        !vault || typeof vault !== "object" || typeof vault.key !== "string" || typeof vault.contentType !== "string" ||
        !vault.contentType.trim() || !Number.isSafeInteger(vault.byteLength) || (vault.byteLength as number) < 1 ||
        !new RegExp(`^project/freshness/source/[^/]+/\\d{4}/\\d{2}/\\d{2}/[^/]+/sha256-${row.sourceHash}\\.[a-z0-9]+$`).test(vault.key) ||
        vault.key.split("/").some(part => part === "." || part === ".." || part.includes("\\"))) return false;
    try { const url = new URL(row.sourceUrl); if (url.protocol !== "https:" || url.username || url.password) return false; }
    catch { return false; }
    if (row.originals !== undefined && (!Array.isArray(row.originals) || !row.originals.length || !row.originals.every(original => valid(original, depth + 1)))) return false;
    seen.delete(input);
    return true;
  };
  return valid(value, 0);
}
