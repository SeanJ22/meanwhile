/**
 * Killable Reader-delivery evidence boundary for the standing data plane.
 * This process never acquires a publisher, creates a source candidate, moves a
 * pointer, or changes LKG. It only reads canonical promotions and appends
 * typed Reader observations to the already-promoted candidate event stream.
 */
import { MEETING_PARTITION_CONTRACTS, observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  routineReaderRepairRecord,
  serializeRoutineReaderRepairRecord,
} from "../lib/civic-data/reader-repair-protocol.ts";
import {
  repairMeetingReaderProjectionReadbacks,
  repairRoutineReaderProjectionReadback,
} from "../lib/civic-data/reader-verification.ts";
import { preparePublishedMeetingSnapshot, readPreparedMeetingsProjection } from "../lib/meetings/prepared-snapshot.ts";
import {
  publishReaderEdgeArtifacts,
  purgeReaderCacheTags,
  READER_MANIFEST_CACHE_TAG,
  type PublishReaderExtras,
  type PublishAuthority,
} from "../lib/meetings/edge-serving.ts";
import { refreshCommentAccessFromPromoted, readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { currentCommentAccess } from "../lib/registry/comment-access.ts";
import { readEverydayRoutingProjection } from "../lib/routing/everyday-data-plane.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { readOfficialStateLegislatorsProjection } from "../lib/state-rollcalls/legislators.ts";
import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from "../lib/state-rollcalls/authority.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { assignment, present, requiredAssignment } from "./cli-args.mts";

function safeFailure(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[credentials-redacted]@")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" | ")
    .slice(0, 4_000) || "Reader repair failed without a diagnostic.";
}

const argv = process.argv.slice(2);
const meetingAggregate = present(argv, "meeting-aggregate");
const contractId = assignment(argv, "contract")?.trim() ?? null;
const observedAt = requiredAssignment(argv, "observed-at", "READER_REPAIR_ARGUMENT_MISSING");
const observedMs = Date.parse(observedAt);
if (!Number.isFinite(observedMs) || new Date(observedMs).toISOString() !== observedAt) {
  throw new Error(`READER_REPAIR_OBSERVED_AT_INVALID:${observedAt}`);
}
if (meetingAggregate === (contractId !== null && contractId !== "")) {
  throw new Error("READER_REPAIR_DOMAIN_ARGUMENT_INVALID");
}

installNeonRequestDeadline();
const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");
const store = new PostgresRoutineDataStore();

let failed = false;
if (meetingAggregate) {
  const results = await repairMeetingReaderProjectionReadbacks(
    store,
    MEETING_PARTITION_CONTRACTS,
    observedAt,
  );
  for (const result of results) {
    const contract = MEETING_PARTITION_CONTRACTS.find(({ id }) => id === result.contractId);
    if (!contract) throw new Error(`READER_REPAIR_MEETING_RESULT_UNKNOWN:${result.contractId}`);
    failed ||= !result.ok;
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(
      contract,
      result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: safeFailure(result.error) },
    )));
  }

  // D-PREP: after the per-partition readbacks, publish the composed reader
  // snapshot the reader actually serves — composed ONCE here, in the background,
  // never on the visitor's request. Idempotent + monotonic + last-valid-safe
  // (see preparePublishedMeetingSnapshot). A composition failure writes nothing,
  // so the last valid snapshot keeps serving; it is surfaced as a domain failure
  // (exit 2) so admin sees it, and the publication lag is readable from the
  // prepared row's coupling versus the live partitions.
  const prepared = await preparePublishedMeetingSnapshot(store, observedAt);
  if (prepared.status === "FAILED") {
    failed = true;
    process.stderr.write(`PREPARED_MEETING_SNAPSHOT_FAILED: ${safeFailure(prepared.error)}\n`);
  } else if (prepared.status === "NOT_COMPOSABLE") {
    process.stderr.write(`PREPARED_MEETING_SNAPSHOT_NOT_COMPOSABLE: ${safeFailure(prepared.detail)}\n`);
  }

  // PDC-9: publish the composed snapshot as GEOGRAPHIC edge artifacts so the
  // reader serves ready-to-display data from the CDN edge — no database wake,
  // no 124-partition compose per visit, and new data appears without a rebuild.
  // Reads the prepared row (one cheap query, no recompose), partitions it by
  // state, writes the immutable artifacts and flips the manifest with a monotonic
  // CAS, then purges the manifest cache tag for instant switchover. Idempotent
  // (unchanged data republishes nothing) and last-valid-safe (a failure leaves
  // the previous manifest serving). Degrades to SKIPPED when the runner has no
  // Netlify credentials — the reader then falls back to the DB prepared row.
  try {
    const readBack = await readPreparedMeetingsProjection({ store });
    if (readBack.kind === "PROMOTED") {
      // The other ready-to-display families the reader serves, read here (the
      // single clock, production DB) so the visitor never reads them from the DB.
      // A failed read leaves them out of the manifest; the reader then falls back
      // to its own DB read for that family — never a hard failure of the publish.
      let extras: PublishReaderExtras | undefined;
      try {
        await refreshCommentAccessFromPromoted();
        const commentAccess = currentCommentAccess();
        const routing = await readEverydayRoutingProjection();
        extras = { commentAccess, everydayRouting: routing.kind === "PROMOTED" ? routing.value : null };
      } catch (error) {
        process.stderr.write(`READER_EDGE_EXTRAS_SKIPPED: ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      // The large authority families (registry-runtime, federal-directory,
      // campaign-sites): publish each promoted, validated value (production DB)
      // as its own compressed NATIONAL artifact ONLY when it validates. A
      // failed/absent read simply omits that family (the reader falls back to the
      // DB for it), never a hard failure of the publish.
      const authority: PublishAuthority = {};
      try {
        const rt = await readRegistryRuntimeProjection();
        if (rt.kind === "PROMOTED" && rt.metadata.versionId) authority["registry-runtime"] = { value: rt.value, versionId: rt.metadata.versionId };
        else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: registry-runtime kind=${rt.kind}\n`);
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: registry-runtime ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      try {
        const fd = await readFederalDirectoryProjection();
        if (fd.kind === "PROMOTED" && fd.metadata.versionId) authority["federal-directory"] = { value: fd.value, versionId: fd.metadata.versionId };
        else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: federal-directory kind=${fd.kind}\n`);
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: federal-directory ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      try {
        const cs = await readCuratedReaderProjection("campaign-sites");
        if (cs.kind === "PROMOTED" && cs.metadata.versionId) authority["campaign-sites"] = { value: cs.value, versionId: cs.metadata.versionId };
        else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: campaign-sites kind=${cs.kind}\n`);
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: campaign-sites ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      // State legislators: one artifact holding the promoted read model per scope
      // (the pilot state chambers). Each scope that fails/absent is simply omitted;
      // the reader falls back to the DB for that scope only.
      try {
        const legislators: Record<string, OfficialStateLegislatorReadModel> = {};
        const versions: string[] = [];
        for (const target of OFFICIAL_STATE_LEGISLATOR_TARGETS) {
          const scope = target.jurisdiction;
          try {
            const sl = await readOfficialStateLegislatorsProjection(scope);
            if (sl.kind === "PROMOTED" && sl.metadata.versionId) {
              legislators[scope] = sl.value;
              versions.push(`${scope}=${sl.metadata.versionId}`);
            }
          } catch (error) {
            process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: state-legislators/${scope} ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
          }
        }
        if (versions.length > 0) authority["state-legislators"] = { value: legislators, versionId: versions.sort().join("|") };
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: state-legislators ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      const edge = await publishReaderEdgeArtifacts(
        readBack.value,
        {
          sourceThrough: readBack.metadata.sourceThrough,
          retrievedAt: readBack.metadata.retrievedAt,
          promotedThrough: readBack.metadata.promotedAt,
        },
        { now: observedAt, ...(extras ? { extras } : {}), ...(Object.keys(authority).length > 0 ? { authority } : {}) },
      );
      if (edge.status === "FAILED") {
        failed = true;
        process.stderr.write(`READER_EDGE_PUBLISH_FAILED: ${safeFailure(edge.error)}\n`);
      } else if (edge.status === "NOT_COMPOSABLE") {
        process.stderr.write(`READER_EDGE_PUBLISH_NOT_COMPOSABLE: ${safeFailure(edge.detail)}\n`);
      } else if (edge.status === "PUBLISHED") {
        const purge = await purgeReaderCacheTags([READER_MANIFEST_CACHE_TAG]);
        console.log(JSON.stringify({ readerEdge: "PUBLISHED", sequence: edge.sequence, scopes: edge.scopes, meetings: edge.meetings, purged: purge.purged }));
      } else {
        console.log(JSON.stringify({ readerEdge: edge.status, ...("sequence" in edge ? { sequence: edge.sequence } : {}) }));
      }
    }
  } catch (error) {
    failed = true;
    process.stderr.write(`READER_EDGE_PUBLISH_FAILED: ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
  }
} else {
  const contracts = [
    ...observableRoutineContracts(),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  ];
  const contract = contracts.find(({ id }) => id === contractId);
  if (!contract || contract.readerProjection === null) {
    throw new Error(`READER_REPAIR_CONTRACT_UNKNOWN_OR_NOT_APPLICABLE:${contractId ?? "missing"}`);
  }
  if (MEETING_PARTITION_CONTRACTS.some(({ id }) => id === contract.id)) {
    throw new Error(`READER_REPAIR_MEETING_REQUIRES_AGGREGATE:${contract.id}`);
  }
  try {
    const result = await repairRoutineReaderProjectionReadback(store, contract, observedAt);
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(
      contract,
      { ok: true, value: result },
    )));
  } catch (error) {
    failed = true;
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(
      contract,
      { ok: false, error: safeFailure(sanitizedErrorDiagnostic(error)) },
    )));
  }
}

if (failed) process.exitCode = 2;
