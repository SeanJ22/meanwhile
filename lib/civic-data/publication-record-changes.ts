import { createHash } from "node:crypto";
import { canonicalJson } from "../control-plane/repository/types.ts";

export interface PublicationRecordChange {
  readonly recordId: string;
  readonly readerId: string;
  readonly change: "NEW" | "UPDATED" | "REUSED";
  readonly previousVersionId: string | null;
  readonly previousFactsHash: string | null;
  readonly factsHash: string;
}

// Evidence refresh and exact source aliases do not change the civic fact. The
// accepted record and reader identities remain explicit on each change row.
const PROVENANCE_FIELDS = new Set(["collectedAt", "verifiedAt", "fieldSources", "membershipSource",
  "nativeIds", "personId", "sourceRecordId"]);
function facts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(facts);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PROVENANCE_FIELDS.has(key)).map(([key, field]) => [key, facts(field)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(facts(value))).digest("hex");

export function publicationRecordChanges(input: {
  previousVersionId: string | null;
  accepted: readonly { recordId: string; readerId: string; value: unknown; previous?: unknown }[];
}): { recordChanges: PublicationRecordChange[]; records: { added: number; changed: number; reused: number } } {
  if (new Set(input.accepted.map(row => row.readerId)).size !== input.accepted.length ||
      new Set(input.accepted.map(row => row.recordId)).size !== input.accepted.length) throw Error("PUBLICATION_CHANGE_IDENTITY_COLLISION");
  const recordChanges = input.accepted.map(row => {
    if (row.previous !== undefined && !input.previousVersionId) throw Error("PUBLICATION_CHANGE_PRIOR_VERSION_MISSING");
    const factsHash = hash(row.value);
    const previousFactsHash = row.previous === undefined ? null : hash(row.previous);
    return { recordId: row.recordId, readerId: row.readerId,
      change: previousFactsHash === null ? "NEW" as const : previousFactsHash === factsHash ? "REUSED" as const : "UPDATED" as const,
      previousVersionId: input.previousVersionId, previousFactsHash, factsHash };
  });
  return { recordChanges, records: { added: recordChanges.filter(row => row.change === "NEW").length,
    changed: recordChanges.filter(row => row.change === "UPDATED").length,
    reused: recordChanges.filter(row => row.change === "REUSED").length } };
}
