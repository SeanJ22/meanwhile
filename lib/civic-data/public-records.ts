import type { PublicRecord } from "./types.ts";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { scopedManualContractScope } from "./scoped-manual-contracts.ts";
import { addUpdates } from "../control-plane/updates.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import { createHash } from "node:crypto";
import { newFieldManualEntry, readFieldManual, writeFieldManual } from "../control-plane/field-manual.ts";

export function publicRecordIssue(value: unknown): string | null {
  const row = value as Partial<PublicRecord> | null;
  if (!row || row.kind !== "PUBLIC_RECORD" || !row.id || row.bodyId !== null && typeof row.bodyId !== "string") return "Public record identity is missing.";
  if (!jurisdictionFromOcdId(row.ocdId ?? "") && row.ocdId !== "ocd-division/country:us") return "Public record jurisdiction is unresolved.";
  if (!row.kindLabel?.trim() || !row.title?.trim() || !row.sourceSentence?.trim()) return "Public record title, kind or saved sentence is missing.";
  if (!/^https:\/\//.test(row.sourceUrl ?? "") || !Number.isFinite(Date.parse(row.capturedAt ?? ""))) return "Public record saved source identity is missing.";
  return null;
}

export async function readPublicRecords(ocdId: string, options: PromotedCivicDataReadOptions = {}) {
  const read = await readPromotedCivicData<{ kind: "public-records"; records: readonly PublicRecord[] }>("CURATED_READER_RECORD",
    scopedManualContractScope("public-records", ocdId), options);
  if (read.kind === "PROMOTED" && (read.value.kind !== "public-records" || !Array.isArray(read.value.records) ||
    read.value.records.some(row => publicRecordIssue(row) || row.ocdId !== ocdId))) throw new Error("Published public records have invalid source or jurisdiction identity.");
  return read;
}

/** Stable by the source's kind words; retries and different places add it once. */
export async function recordNewPublicKinds(repos: Pick<ControlPlaneRepositories, "adminConfig" | "fieldManual">, records: readonly PublicRecord[], now: string) {
  const manual = await readFieldManual(repos, { role: "SHARED", recordClass: "PUBLIC_RECORD" });
  if (manual.error) throw new Error(manual.error);
  const entries = records.map(row => newFieldManualEntry("public-record-kinds", createHash("sha256")
    .update(row.kindLabel.normalize("NFKC").toLowerCase().trim()).digest("hex"), {
      role: "SHARED", kind: "PUBLIC_RECORD_KIND", title: row.kindLabel, summary: `Source kind: ${row.kindLabel}`, outcome: "YIELDED",
      url: row.sourceUrl, observedAt: now, recordClasses: ["PUBLIC_RECORD"], payload: { kindLabel: row.kindLabel },
    }));
  const known = new Set(manual.store.entries.filter(entry => entry.kind === "PUBLIC_RECORD_KIND").map(entry => entry.id));
  const fresh = entries.filter(entry => !known.has(entry.id));
  await addUpdates(repos, fresh.map(entry => ({ id: `public-kind:${entry.id}`, what: `New kind found: ${entry.title}`,
    at: now, label: "TESTING", evidenceHref: entry.url, after: records.find(row => row.kindLabel === entry.title)?.title })), now);
  const saved = await writeFieldManual(repos, fresh, now);
  if (saved.error) throw new Error(saved.error);
}
