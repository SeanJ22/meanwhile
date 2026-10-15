import type { BallotSourceCorpusReference } from "./types.ts";

export function sourceCorpusReferenceValid(value: unknown): value is BallotSourceCorpusReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>, vault = row.vault as Record<string, unknown> | undefined;
  return row.format === "ballot-source-corpus@1" && typeof row.state === "string" && /^[A-Z]{2}$/.test(row.state) &&
    typeof row.electionId === "string" && !!row.electionId.trim() &&
    typeof row.sourceHash === "string" && /^[a-f0-9]{64}$/.test(row.sourceHash) &&
    Number.isSafeInteger(row.documentCount) && (row.documentCount as number) > 0 &&
    typeof row.reviewedAt === "string" && Number.isFinite(Date.parse(row.reviewedAt)) &&
    typeof row.reviewedBy === "string" && !!row.reviewedBy.trim() &&
    !!vault && typeof vault === "object" && vault.contentType === "application/x-ndjson" &&
    Number.isSafeInteger(vault.byteLength) && (vault.byteLength as number) > 0 && typeof vault.key === "string" &&
    new RegExp(`^project/freshness/source/ballot-corpus-${row.state.toLowerCase()}/\\d{4}/\\d{2}/\\d{2}/[^/]+/sha256-${row.sourceHash}\\.ndjson$`).test(vault.key) &&
    !vault.key.split("/").some(part => part === "." || part === ".." || part.includes("\\")) &&
    !["text", "documents", "entries"].some(field => field in row);
}
