import type { PublishedElectionField } from "./election-fields.ts";
import type { CuratedReaderProjection } from "./manual-projections.ts";
import type { PublishedSourceCheck } from "./source-checks.ts";

export const ballotNavigationSourceKey = (scope: string, requestedUrl: string) => `${scope}|${new URL(requestedUrl).href}`;

/** A separately checked page advances only fields validated against those exact source bytes and inputs. */
export function ballotNavigationSourceCheckOverlay(projection: CuratedReaderProjection, checks: readonly PublishedSourceCheck[]): CuratedReaderProjection {
  if (!checks.length) return projection;
  const byKey = new Map(checks.map(check => [check.sourceKey, check]));
  let changed = false;
  const records = projection.records.map(record => {
    if (record.kind !== "ELECTION_FIELD") return record;
    // A conflict can retain a field from another source capture; the incoming page cannot freshen that field.
    if (record.fieldSources && typeof record.fieldSources === "object" && Object.keys(record.fieldSources).length) return record;
    const field = record as unknown as PublishedElectionField, value = field.value;
    const check = value.sourceKey ? byKey.get(value.sourceKey) : undefined;
    if (!check || check.rawHash !== value.sourceHash || !check.sourceUrls.includes(value.url) ||
      !check.jurisdictionIds.includes(value.divisionId) || !Number.isFinite(Date.parse(check.checkedAt)) ||
      Date.parse(check.checkedAt) <= Date.parse(value.verifiedAt) || Date.parse(check.checkedAt) < Date.parse(value.collectedAt)) return record;
    changed = true;
    return { ...record, value: { ...value, verifiedAt: check.checkedAt } };
  });
  return changed ? { ...projection, records } : projection;
}
