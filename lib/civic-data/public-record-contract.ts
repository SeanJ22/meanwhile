import type { PublicRecord } from "./types.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";

export function publicRecordIssue(value: unknown): string | null {
  const row = value as Partial<PublicRecord> | null;
  if (!row || row.kind !== "PUBLIC_RECORD" || !row.id || row.bodyId !== null && typeof row.bodyId !== "string") return "Public record identity is missing.";
  if (!jurisdictionFromOcdId(row.ocdId ?? "") && row.ocdId !== "ocd-division/country:us") return "Public record jurisdiction is unresolved.";
  if (!row.kindLabel?.trim() || !row.title?.trim() || !row.sourceSentence?.trim()) return "Public record title, kind or saved sentence is missing.";
  if (!/^https:\/\//.test(row.sourceUrl ?? "") || !Number.isFinite(Date.parse(row.capturedAt ?? ""))) return "Public record saved source identity is missing.";
  return null;
}

