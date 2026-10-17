import { canonicalCivicDataJson } from "./changes.ts";
import type { ManualSourceClass, ManualSourceSetReceipt } from "./types.ts";
import type { SourceScopedHeldFact } from "./manual-source-isolation.ts";
import type { Provenance } from "../sources/types.ts";
import { provenanceKind } from "../officials/verification.ts";
import type { SourceKind } from "../control-plane/promotion/source-kinds.ts";

const RANK: Readonly<Record<SourceKind, number>> = { OFFICIAL: 7, FILING: 6, CAMPAIGN: 5, VOTER_GUIDE: 4, NEWS: 3, REFERENCE: 0, FORUM: 0, OTHER: 0 };
export function receiptSourceKind(kind: ManualSourceClass): SourceKind {
  return ({ OFFICIAL_PUBLISHER: "OFFICIAL", ELECTION_AUTHORITY: "OFFICIAL", CANDIDATE_CONTROLLED: "CAMPAIGN", REFERENCE_PUBLISHER: "REFERENCE" } as const)[kind as "OFFICIAL_PUBLISHER" | "ELECTION_AUTHORITY" | "CANDIDATE_CONTROLLED" | "REFERENCE_PUBLISHER"] ?? kind as SourceKind;
}

/** Higher standing wins, then the newer read. A conflict never delays a fact. */
export function preferCurrentSource(current: Provenance, prior: Provenance): boolean {
  const rank = RANK[provenanceKind(current)] - RANK[provenanceKind(prior)];
  if (rank !== 0) return rank > 0;
  const time = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
  return time(current.collectedAt) >= time(prior.collectedAt);
}
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function sourceFor(record: Record<string, unknown>, field: string, receipt: ManualSourceSetReceipt): Provenance {
  const path = field.split(".");
  const nested = path.slice(0, -1).reduce((value, key) => row(value[key]), record);
  const fieldSource = row(row(record.fieldSources)[field] ?? row(record.fieldSources)[path.at(-1)!]);
  record = { ...record, ...nested };
  const url = typeof fieldSource.sourceUrl === "string" ? fieldSource.sourceUrl : typeof record.sourceUrl === "string" ? record.sourceUrl : typeof record.url === "string" ? record.url : null;
  const source = receipt.sources.find(source => source.finalUrl === url || source.requestedUrl === url);
  return { sourceUrl: url, sourceOrg: typeof fieldSource.sourceOrg === "string" ? fieldSource.sourceOrg : source?.publisher ?? "",
    collectedAt: typeof fieldSource.collectedAt === "string" ? fieldSource.collectedAt : typeof record.collectedAt === "string" ? record.collectedAt : source?.retrievedAt ?? "",
    verifiedAt: typeof fieldSource.verifiedAt === "string" ? fieldSource.verifiedAt : null,
    ...(source ? { kind: receiptSourceKind(source.sourceClass) } : typeof fieldSource.kind === "string" ? { kind: fieldSource.kind as SourceKind } : {}),
    ...(typeof fieldSource.quote === "string" ? { quote: fieldSource.quote } : {}) };
}
const META = new Set(["id", "bodyId", "ocdId", "sourceUrl", "sourceOrg", "collectedAt", "verifiedAt", "fieldSources", "kind"]);

export function resolveRecordConflicts(current: Record<string, unknown> & { id: string }, prior: Record<string, unknown> & { id: string },
  currentReceipt: ManualSourceSetReceipt, priorReceipt: ManualSourceSetReceipt): { record: typeof current; conflicts: SourceScopedHeldFact[] } {
  const record = { ...current }, fieldSources = { ...row(current.fieldSources) };
  const conflicts: SourceScopedHeldFact[] = [];
  const walk = (incomingRow: Record<string, unknown>, oldRow: Record<string, unknown>, prefix = ""): Record<string, unknown> => {
    const result = { ...incomingRow };
    for (const key of new Set([...Object.keys(incomingRow), ...Object.keys(oldRow)])) {
      if (META.has(key)) continue;
      const incoming = incomingRow[key];
      const old = oldRow[key], field = prefix + key;
      if (incoming === null || incoming === undefined) {
        if (old !== null && old !== undefined && current.kind === prior.kind) {
          result[key] = old;
          const source = sourceFor(prior, field, priorReceipt);
          fieldSources[field] = source;
          conflicts.push({ key: `${current.id}:${field}`, code: "SOURCE_FIELD_HELD_LKG",
            detail: `${field}: the latest source supplies no verified replacement; the earlier verified value remains.`,
            record: { memberId: current.id, field, value: old, source } });
        }
        continue;
      }
      if (old === undefined || old === null || canonicalCivicDataJson(old) === canonicalCivicDataJson(incoming)) continue;
      if (typeof incoming === "object" && !Array.isArray(incoming) && typeof old === "object" && !Array.isArray(old)) {
        result[key] = walk(row(incoming), row(old), field + "."); continue;
      }
      const freshSource = sourceFor(current, field, currentReceipt), oldSource = sourceFor(prior, field, priorReceipt);
      const freshWins = preferCurrentSource(freshSource, oldSource);
      result[key] = freshWins ? incoming : old;
      fieldSources[field] = freshWins ? freshSource : oldSource;
      conflicts.push({ key: `${current.id}:${field}`, code: "CONFLICT_SUPERSEDED",
        detail: `${field}: kept the ${provenanceKind(freshWins ? freshSource : oldSource).toLowerCase()} source, then the newer read on a tie.`,
        record: { memberId: current.id, field, value: freshWins ? old : incoming, source: freshWins ? oldSource : freshSource } });
    }
    return result;
  };
  Object.assign(record, walk(current, prior));
  return { record: conflicts.length ? { ...record, fieldSources } : current, conflicts };
}
