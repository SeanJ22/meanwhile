import type { RetrievalEvidence } from "./types.ts";

/** Provider-check evidence is separate from the original response's acquisition date. */
export function sourceCheckIssue(value: unknown, observedAt: string): string | null {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") return "The source check is not an evidence object.";
  const check = value as Record<string, unknown>;
  if (check.httpStatus !== 200 && check.httpStatus !== 304) return "A source check requires an actual HTTP 200 or 304.";
  if (typeof check.rawHash !== "string" || !/^[a-f0-9]{64}$/.test(check.rawHash)) return "The source check lacks its captured response hash.";
  for (const key of ["requestedUrl", "finalUrl"] as const) {
    try { if (typeof check[key] !== "string" || !["http:", "https:"].includes(new URL(check[key]).protocol)) return "The source check requires HTTP source URLs."; }
    catch { return "The source check requires HTTP source URLs."; }
  }
  const checked = typeof check.checkedAt === "string" ? Date.parse(check.checkedAt) : Number.NaN;
  if (!Number.isFinite(checked) || !Number.isFinite(Date.parse(observedAt)) || checked > Date.parse(observedAt)) return "The source check time is invalid or later than its local observation.";
  return null;
}

/** Legacy direct-fetch candidates use their local observation; retained releases name the real provider check. */
export function sourceCheckedAt(retrieval: Pick<RetrievalEvidence, "sourceCheck">, observedAt: string | null | undefined): string | undefined {
  if (typeof observedAt !== "string" || !Number.isFinite(Date.parse(observedAt))) return undefined;
  if (retrieval.sourceCheck === undefined) return observedAt;
  return sourceCheckIssue(retrieval.sourceCheck, observedAt) === null ? retrieval.sourceCheck.checkedAt : undefined;
}
