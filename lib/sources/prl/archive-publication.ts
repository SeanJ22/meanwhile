import { normalizedHash, sha256 } from "../../civic-data/candidate-builders.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../../civic-data/types.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import { prlDataset } from "./inventory.ts";
import { prlReceiptViolations, type PrlIngestReceipt } from "./receipt.ts";
import { readPromotedEdgeFirst } from "../../registry/runtime-edge.ts";
import { authorityFor } from "../../civic-data/source-authority.ts";
import { PRL_CONTRACT } from "./data-plane.ts";

export const PRL_ARCHIVE_SCOPE = "US:prl:archive-releases";
export interface PrlArchiveProjection { formatVersion: 1; datasets: Record<string, PrlIngestReceipt> }
export function prlArchiveProblems(value: PrlArchiveProjection): string[] {
  if (value?.formatVersion !== 1 || !value.datasets || !Object.keys(value.datasets).length) return ["No completed PRL release is held."];
  return Object.entries(value.datasets).flatMap(([id, receipt]) => [
    ...prlReceiptViolations(receipt),
    ...(!prlDataset(id) || receipt.datasetId !== id ? ["Unregistered PRL dataset."] : []),
    ...(!authorityFor("prl", "PRL_ARCHIVE", receipt.sourceFinalUrl ?? receipt.sourceUrl).ok ? ["PRL archive redirected outside its registered source."] : []),
    ...(receipt.target === "archive" && (!receipt.objectRoot || !receipt.objectRoot.startsWith(`${id}/${receipt.sourceSha256}/`) ||
      !Number.isInteger(receipt.subjectCount) || !receipt.subjectCount) ? ["PRL archive lacks its completed person partitions."] : []),
  ]);
}
export function prlArchiveCandidate(input: { projection: PrlArchiveProjection; receipt: PrlIngestReceipt; checkedAt: string }): RoutineCandidate {
  const { projection, receipt, checkedAt } = input, violations = prlArchiveProblems(projection);
  const records = Object.values(projection.datasets).map(record => ({ key: `dataset:${record.datasetId}`, record }));
  const newestSource = Object.values(projection.datasets).sort((left, right) => left.fetchedAt.localeCompare(right.fetchedAt)).at(-1)!;
  const sourceThrough = newestSource.fetchedAt;
  return {
    id: `cv-${sha256(`prl-archives:${normalizedHash(projection)}:${checkedAt}`).slice(0, 32)}`,
    sourceId: "prl", recordClass: "PRL_ARCHIVE", scope: PRL_ARCHIVE_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence("prl", "PRL_ARCHIVE", PRL_ARCHIVE_SCOPE),
    retrieval: { succeeded: true, requestedUrl: newestSource.sourceUrl, finalUrl: newestSource.sourceFinalUrl ?? newestSource.sourceUrl, httpStatus: 200,
      retrievedAt: newestSource.fetchedAt, rawHash: sha256(records.map(row => row.record.sourceSha256).sort().join("\n")) },
    normalization: { succeeded: !violations.length, parserVersion: PRL_CONTRACT.parserVersion, schemaVersion: "prl-archives/1",
      normalizedHash: normalizedHash(projection), normalizedPayloadHash: normalizedHash(projection),
      inputRecords: records.length, outputRecords: records.length, droppedRecords: 0, missingRequiredFields: [] },
    identities: records.map(({ record }) => ({ subjectId: `prl:${record.datasetId}`, jurisdiction: "US",
      identifiers: { dataset_id: record.datasetId }, matchBasis: "OFFICIAL_ID" as const, ambiguous: false })),
    temporal: { version: sourceThrough, expectedVersion: sourceThrough, sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "PRL attributed archive records with native person indexes", violations },
    horizon: { kind: "BOUNDED", query: receipt.sourceUrl, returnedRecords: records.length, declaredTotal: null, paginationComplete: true, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "PRL native-person archive reader", passed: !violations.length, detail: "Only completed immutable releases enter the existing reader manifest." }],
    normalizedPayload: projection, readModel: projection, civicRecords: records, excludedFacts: [],
  };
}
export async function readPrlArchiveProjection(options: PromotedCivicDataReadOptions = {}) {
  const readTyped = async (readOptions: PromotedCivicDataReadOptions) => {
    const read = await readPromotedCivicData<PrlArchiveProjection>("PRL_ARCHIVE", PRL_ARCHIVE_SCOPE, readOptions);
    if (read.kind === "PROMOTED" && (read.metadata.sourceId !== "prl" || prlArchiveProblems(read.value).length)) throw new Error("PRL_ARCHIVE_PROJECTION_INVALID");
    return read;
  };
  if (options.store || options.edge || options.bypassCache) return readTyped(options);
  return readPromotedEdgeFirst("PRL_ARCHIVE", PRL_ARCHIVE_SCOPE, edgeOptions => readTyped({ ...options, ...edgeOptions }), "The PRL archive manifest");
}
