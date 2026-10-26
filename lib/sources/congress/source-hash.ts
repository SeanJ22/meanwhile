import { canonicalCivicDataHash } from "../../civic-data/canonical-hash.ts";
import { sha256 } from "../../civic-data/candidate-builders.ts";
import type { RoutineDataStore, SourceHead } from "../../civic-data/store.ts";
import { FEDERAL_PARSER_VERSION, FEDERAL_RECORD_CLASS, federalScope, type FederalSourceId } from "./targets.ts";
import type { FederalCapture, FederalCounts } from "./types.ts";

export interface FederalSourceInput {
  source: FederalSourceId; partition: string; captures: readonly FederalCapture[];
  cursor?: string; counts?: FederalCounts; completePartition?: boolean; replaceFilingId?: string; dependencyHash?: string;
  countsPrimary?: boolean;
}

function acquisitionAddress(input: FederalSourceInput, capture: FederalCapture): string {
  const url = new URL(capture.url);
  // These captures are exact native objects extracted from an already validated provider page.
  // Moving that same object to another listing page or posting-date query does not change its content.
  if (input.source === "senate-lda" && capture.kind === "contributions" &&
    (input.partition.startsWith("filing:") || input.replaceFilingId || capture.context?.filingId)) return `${url.origin}${url.pathname}`;
  if (input.source === "congress-api" && capture.kind === "members" && capture.context?.bioguideId) {
    for (const key of [...url.searchParams.keys()]) if (/^(?:offset|limit|page|pageSize|page_size|page\[number\]|page\[size\])$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
  }
  return url.href;
}

export function federalSourceInputHash(input: FederalSourceInput) {
  const captures = input.captures.map(capture => ({ url: acquisitionAddress(input, capture), kind: capture.kind, context: capture.context
    ? { ...Object.fromEntries(Object.entries(capture.context).filter(([key]) => key !== "honoreeRosterFailure")),
      ...(capture.context.honoreeRosterFailure !== undefined ? { honoreeRosterUnavailable: true } : {}) } : null,
    bodyHash: sha256(capture.body) })).sort((a, b) => canonicalCivicDataHash(a).localeCompare(canonicalCivicDataHash(b)));
  const sourceKey = `federal-input:${canonicalCivicDataHash({ partition: input.partition,
    captures: captures.map(({ bodyHash: _bodyHash, context, ...capture }) => ({ ...capture,
      context: context ? Object.fromEntries(Object.entries(context).filter(([key]) => !key.startsWith("honoreeRoster"))) : null }))
      .sort((a, b) => canonicalCivicDataHash(a).localeCompare(canonicalCivicDataHash(b))),
    completePartition: Boolean(input.completePartition), replaceFilingId: input.replaceFilingId ?? null })}`;
  return { sourceKey, rawHash: canonicalCivicDataHash({ captures, parserVersion: FEDERAL_PARSER_VERSION, dependencies: input.dependencyHash ?? null }) };
}

export function federalSourceHead(head: SourceHead | null, source: FederalSourceId, partition: string): head is SourceHead {
  return Boolean(head && head.sourceId === source && head.recordClass === FEDERAL_RECORD_CLASS && head.scope === federalScope(source, partition) &&
    head.candidateState === "PROMOTED" && head.acquisitionSucceeded && !head.imported && head.versionId === head.lastKnownGoodVersionId &&
    head.parserVersion === FEDERAL_PARSER_VERSION);
}

export async function federalPartitionState(store: RoutineDataStore, source: FederalSourceId, partition: string) {
  const head = await store.readSourceHead(FEDERAL_RECORD_CLASS, federalScope(source, partition));
  if (!federalSourceHead(head, source, partition)) return null;
  const fields = await store.readPromotionPayloadFields(FEDERAL_RECORD_CLASS, federalScope(source, partition), ["cursor", "counts"]);
  return { head, cursor: typeof fields?.cursor === "string" ? fields.cursor : undefined, counts: fields?.counts as FederalCounts | undefined };
}

/** Only the selected acquisition's keyed hash is read; pending cursor/count changes still publish. */
export async function unchangedFederalSourceInput(store: RoutineDataStore, input: FederalSourceInput) {
  const hash = federalSourceInputHash(input), scope = federalScope(input.source, input.partition);
  const head = await store.readSourceHead(FEDERAL_RECORD_CLASS, scope);
  if (!federalSourceHead(head, input.source, input.partition) || head.rawHashBasis !== "SOURCE_CONTENT_V1" || !store.readSourceChecks) return null;
  const expected = input.captures.map(capture => federalSourceInputHash({ ...input, captures: [capture] }));
  if (!expected.length) return null;
  const checks = await store.readSourceChecks(FEDERAL_RECORD_CLASS, scope, expected.map(row => row.sourceKey));
  if (!expected.every(hash => checks.some(row => row.sourceKey === hash.sourceKey && row.rawHash === hash.rawHash && row.parserVersion === FEDERAL_PARSER_VERSION))) return null;
  if (input.cursor !== undefined || input.counts !== undefined || input.countsPrimary !== undefined) {
    const fields = await store.readPromotionPayloadFields(FEDERAL_RECORD_CLASS, scope, [
      ...(input.cursor !== undefined ? ["cursor"] : []), ...(input.counts !== undefined ? ["counts"] : []),
      ...(input.countsPrimary !== undefined ? ["countsPrimary"] : []),
    ]);
    if (input.cursor !== undefined && fields?.cursor !== input.cursor || input.counts !== undefined && canonicalCivicDataHash(fields?.counts ?? null) !== canonicalCivicDataHash(input.counts)) return null;
    if (input.countsPrimary !== undefined && fields?.countsPrimary !== input.countsPrimary) return null;
  }
  return { head, hash, sourceUrls: [...new Set(checks.flatMap(check => check.sourceUrls))] };
}
