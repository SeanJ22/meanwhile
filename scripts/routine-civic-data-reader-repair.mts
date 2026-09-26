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
import { readMeetingsProjection, type MeetingsProjectionReadResult } from "../lib/meetings/snapshot.ts";
import {
  publishReaderEdgeArtifacts,
  publishReaderEdgeChecks,
  purgeReaderCacheTags,
  READER_MANIFEST_CACHE_TAG,
  servedAuthorityVersion,
  type PublishReaderExtras,
  type PublishAuthority,
  type PublishAuthorityCarried,
  type PublishAuthorityValue,
  type PublishRegistrations,
} from "../lib/meetings/edge-serving.ts";
import { resolveReaderArtifactWriteStore } from "../lib/meetings/edge-store.ts";
import type { AuthorityFamily, ReaderManifest } from "../lib/meetings/edge-artifacts.ts";
import type { RoutineRecordClass } from "../lib/civic-data/types.ts";
import { refreshCommentAccessFromPromoted, readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { currentCommentAccess } from "../lib/registry/comment-access.ts";
import { readEverydayRoutingProjection } from "../lib/routing/everyday-data-plane.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { readCensusGeographyProjection } from "../lib/census-geography/reader.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../lib/census-geography/publication.ts";
import { REGISTRATION_SCOPES, registrationEdgePlan } from "../lib/registration/edge.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { readOfficialStateLegislatorsProjection } from "../lib/state-rollcalls/legislators.ts";
import { combinedOutcomeVersionId, combineOutcomeProjections, readMesaOutcomeProjection, readOutcomeProjection } from "../lib/outcomes/store.ts";
import { MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, PIMA_LEGISTAR_OUTCOMES_CONTRACT } from "../lib/outcomes/data-plane.ts";
import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from "../lib/state-rollcalls/authority.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readPromotedEdgeFamilies } from "../lib/civic-data/promoted-edge-publication.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { installFatalLine } from "../lib/ops/fatal-line.ts";
import { stageLine, traceMethodCalls } from "../lib/ops/stage-trace.ts";
import { assignment, present, requiredAssignment } from "./cli-args.mts";
import { readerEdgeCarriesForward } from "./lib/reader-edge-current.ts";
import { censusEdgePublication } from "./lib/census-edge-publication.ts";
import { readerVerifierClosureAttestor } from "./lib/reader-verifier-attestation.ts";

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

// An error nothing caught ends this child through one sanitized RCD_FATAL line
// naming its step (lib/ops/fatal-line.ts). Without it the supervisor quoted the
// last eight stderr lines, which for an uncaught throw are stack frames: the
// 2026-09-25T23:01Z runtime-authority refusals recorded no reason at all.
let step = "reading the Reader repair arguments";
installFatalLine("routine-civic-data-reader-repair", () => step);

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

// A one-contract child writes stage lines to stderr, so a child the runner
// kills leaves the step it stopped in as its failure detail
// (lib/ops/stage-trace.ts). Protocol records stay on stdout.
const stage = meetingAggregate
  ? null
  : (what: string): void => {
    step = what;
    process.stderr.write(`${stageLine("READER_REPAIR_STAGE", what)}\n`);
  };
step = `modules loaded for ${contractId ?? "the meeting aggregate"}`;
stage?.(`modules loaded for ${contractId}`);

installNeonRequestDeadline();
step = "admitting the production write";
const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");
step = meetingAggregate ? "repairing the meeting aggregate" : `repairing ${contractId}`;
const store = stage
  ? traceMethodCalls(new PostgresRoutineDataStore(), "store", stage)
  : new PostgresRoutineDataStore();

let failed = false;
// A receipt from an earlier commit carries to this one when no typed Reader
// code changed between them; otherwise the Reader re-reads (R31, 2026-09-25).
// Every runner handoff once re-read every Reader (195.3 MB on an isolated copy).
const attestor = readerVerifierClosureAttestor();
if (meetingAggregate) {
  // One composition of every partition per pass, made only when something
  // needs it: the Reader readbacks of newly promoted versions and the prepared
  // snapshot's republication ask for exactly the same read, and a pass that
  // promoted a partition needs both. Each once composed on its own (about
  // 24 MB from the reader database apiece). A failed composition is not kept,
  // so the second consumer tries again as it did before.
  let composing: Promise<MeetingsProjectionReadResult> | null = null;
  const aggregate = (): Promise<MeetingsProjectionReadResult> => {
    composing ??= readMeetingsProjection({ store, now: observedAt, bypassCache: true, allowUnconfiguredBootstrap: false })
      .catch((error: unknown) => {
        composing = null;
        throw error;
      });
    return composing;
  };
  const results = await repairMeetingReaderProjectionReadbacks(
    store,
    MEETING_PARTITION_CONTRACTS,
    observedAt,
    undefined,
    { aggregate, attestor },
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
  const prepared = await preparePublishedMeetingSnapshot(store, observedAt, { aggregate });
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
  //
  // R28 (2026-09-25): the served manifest is read first, and the prepared row
  // (about 7.5 MB) is read only when the publish could change something
  // (scripts/lib/reader-edge-current.ts). Every pass once read the whole row to
  // learn that the manifest was already current.
  try {
    // The runner write store, when this host has one; without it the publish
    // is SKIPPED_NO_STORE whatever it is given, so nothing below is read.
    const artifactStore = resolveReaderArtifactWriteStore();
    if (artifactStore === null) {
      console.log(JSON.stringify({ readerEdge: "SKIPPED_NO_STORE" }));
    } else {
      let servedManifest: ReaderManifest | null = null;
      try {
        servedManifest = (await artifactStore.readManifest())?.manifest ?? null;
      } catch {
        servedManifest = null;
      }
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
      //
      // A family whose current pointer is still the version the edge already
      // serves carries its artifact forward and is not read at all: that
      // artifact was written from a proven read of the same immutable version.
      // Every pass once read every family whole (30.8 MB on 2026-09-23, 24 MB
      // of it registry-runtime) to learn that nothing had changed.
      const servedIfCurrent = async (family: AuthorityFamily, currentVersion: () => Promise<string | null>): Promise<string | null> => {
        const served = servedAuthorityVersion(servedManifest, family);
        if (served === null) return null;
        try {
          return (await currentVersion()) === served ? served : null;
        } catch {
          return null;
        }
      };
      const pointerVersion = (recordClass: RoutineRecordClass, scope: string) => async () =>
        (await store.readPromotionIdentity(recordClass, scope))?.versionId ?? null;
      const manualPointer = (contractId: string) => {
        const contract = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(({ id }) => id === contractId);
        return contract ? pointerVersion(contract.recordClass, contract.scope) : async () => null;
      };
      const authority: PublishAuthority = {};
      authority["census-districts"] = await censusEdgePublication({
        servedVersion: servedAuthorityVersion(servedManifest, "census-districts"),
        readVersion: pointerVersion(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE),
        readProjection: () => readCensusGeographyProjection({ store, now: observedAt }),
        onFailure: error => process.stderr.write(`READER_EDGE_AUTHORITY_REFRESH_FAILED: census-districts ${safeFailure(sanitizedErrorDiagnostic(error))}\n`),
      });
      try {
        const carried = await servedIfCurrent("registry-runtime", manualPointer("registry-runtime-bindings"));
        if (carried !== null) authority["registry-runtime"] = { versionId: carried, carried: true };
        else {
          const rt = await readRegistryRuntimeProjection();
          if (rt.kind === "PROMOTED" && rt.metadata.versionId) authority["registry-runtime"] = { value: rt.value, versionId: rt.metadata.versionId };
          else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: registry-runtime kind=${rt.kind}\n`);
        }
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: registry-runtime ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      try {
        const carried = await servedIfCurrent("federal-directory", manualPointer("congress-bulk-roster"));
        if (carried !== null) authority["federal-directory"] = { versionId: carried, carried: true };
        else {
          const fd = await readFederalDirectoryProjection();
          if (fd.kind === "PROMOTED" && fd.metadata.versionId) authority["federal-directory"] = { value: fd.value, versionId: fd.metadata.versionId };
          else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: federal-directory kind=${fd.kind}\n`);
        }
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: federal-directory ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      try {
        const carried = await servedIfCurrent("campaign-sites", manualPointer("campaign-sites"));
        if (carried !== null) authority["campaign-sites"] = { versionId: carried, carried: true };
        else {
          const cs = await readCuratedReaderProjection("campaign-sites");
          if (cs.kind === "PROMOTED" && cs.metadata.versionId) authority["campaign-sites"] = { value: cs.value, versionId: cs.metadata.versionId };
          else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: campaign-sites kind=${cs.kind}\n`);
        }
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: campaign-sites ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      // State legislators: one artifact holding the promoted read model per scope
      // (the pilot state chambers). Each scope that fails/absent is simply omitted;
      // the reader falls back to the DB for that scope only.
      try {
        const carried = await servedIfCurrent("state-legislators", async () => {
          const current: string[] = [];
          for (const target of OFFICIAL_STATE_LEGISLATOR_TARGETS) {
            const versionId = await pointerVersion("STATE_LEGISLATOR", target.jurisdiction)();
            if (versionId !== null) current.push(`${target.jurisdiction}=${versionId}`);
          }
          return current.length > 0 ? current.sort().join("|") : null;
        });
        if (carried !== null) authority["state-legislators"] = { versionId: carried, carried: true };
        else {
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
        }
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: state-legislators ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      // The recorded meeting outcomes and the comment-access rules (C20, 2026-09-24):
      // from the database they were a cold Ask's two slowest reads (2.0–2.3 s and
      // 0.6–0.8 s). Each is carried forward while its pointer is still the served
      // version, and read whole only when it moved.
      try {
        // Pima's and Mesa's pointers, combined (NH332): the artifact is Pima's
        // alone while Mesa has no pointer, and names both versions once it does.
        const carried = await servedIfCurrent("meeting-outcomes", async () => combinedOutcomeVersionId(
          await pointerVersion(PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass, PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope)(),
          await pointerVersion(MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT.recordClass, MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT.scope)(),
        ));
        if (carried !== null) authority["meeting-outcomes"] = { versionId: carried, carried: true };
        else {
          const oc = await readOutcomeProjection();
          const mesa = await readMesaOutcomeProjection();
          // Complete or left out: a Mesa read that failed must not publish Pima
          // alone as if Mesa had nothing; the reader then reads both from the database.
          if (mesa.kind !== "PROMOTED" && mesa.kind !== "NOT_RECORDED") throw new Error(`mesa minutes outcomes read ${mesa.kind}`);
          const combined = oc.kind === "PROMOTED" && oc.metadata.versionId
            ? combineOutcomeProjections(
                { value: oc.value, versionId: oc.metadata.versionId },
                mesa.kind === "PROMOTED" && mesa.metadata.versionId ? { value: mesa.value, versionId: mesa.metadata.versionId } : null,
              )
            : null;
          if (combined !== null) authority["meeting-outcomes"] = combined;
          else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: meeting-outcomes kind=${oc.kind}\n`);
        }
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: meeting-outcomes ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      try {
        const carried = await servedIfCurrent("comment-access", manualPointer("comment-access"));
        if (carried !== null) authority["comment-access"] = { versionId: carried, carried: true };
        else {
          const ca = await readCuratedReaderProjection("comment-access");
          if (ca.kind === "PROMOTED" && ca.metadata.versionId) authority["comment-access"] = { value: ca.value, versionId: ca.metadata.versionId };
          else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: comment-access kind=${ca.kind}\n`);
        }
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: comment-access ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      // The proven pointers a cold /ballot and a cold Ask read from the database
      // (2026-09-25): the ballots, candidate profiles and publications, navigation,
      // the NH roster, FEC, state and Pima money, federal votes and key votes,
      // statements and executive actions (lib/civic-data/promoted-edge-publication.ts).
      // Each family is carried while its pointers still name the served version,
      // read and proved only when one moved, and published only after its own
      // Reader accepted the entry; a family that fails is left out, and the
      // reader reads it from the database.
      try {
        const promoted = await readPromotedEdgeFamilies({ store, servedManifest, now: observedAt });
        Object.assign(authority, promoted.authority);
        for (const line of promoted.skipped) process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: ${safeFailure(line)}\n`);
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: promoted pointers ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      // Every state's promoted registration (lib/registration/edge.ts): one identity read for every registration
      // pointer decides which states carry by reference; only a state whose version moved is read. The section is
      // complete or left out: any failure leaves it out this pass, and the reader reads registration from the database.
      let registrations: PublishRegistrations | undefined;
      try {
        const plan = registrationEdgePlan(await store.readPromotionIdentities("REGISTRATION", REGISTRATION_SCOPES), servedManifest?.registrations);
        const entries: Record<string, PublishAuthorityValue | PublishAuthorityCarried> = {};
        for (const [state, versionId] of Object.entries(plan.carried)) entries[state] = { versionId, carried: true };
        for (const [state, versionId] of Object.entries(plan.publish)) {
          const read = await readRegistrationProjection(state);
          if (read.kind !== "PROMOTED" || read.metadata.versionId !== versionId) {
            throw new Error(`registration ${state} read ${read.kind} at ${read.metadata.versionId ?? "no version"}, not the pointer's ${versionId}`);
          }
          entries[state] = { value: read.value, versionId };
        }
        registrations = entries;
      } catch (error) {
        process.stderr.write(`READER_EDGE_REGISTRATIONS_SKIPPED: ${safeFailure(sanitizedErrorDiagnostic(error))}
`);
      }
      const carry = readerEdgeCarriesForward({ prepared, servedManifest, extras, authority, registrations });
      // The composition and its quiet re-checks, stated in the manifest (lib/meetings/fresh-checks.ts).
      const checks = prepared.status === "CURRENT" || prepared.status === "PUBLISHED"
        ? { composition: prepared.composition, freshChecks: prepared.freshChecks }
        : undefined;
      // Only re-checked since the served composition: the manifest alone moves.
      const checksOnly = !carry.current && carry.checksOnly === true && prepared.status === "CURRENT" && checks !== undefined
        ? await publishReaderEdgeChecks(
            { generatedAt: prepared.servedGeneratedAt ?? prepared.generatedAt ?? observedAt, retrievedAt: prepared.checkedAt, checks },
            { store: artifactStore },
          )
        : null;
      if (checksOnly?.status === "PUBLISHED") {
        const purge = await purgeReaderCacheTags([READER_MANIFEST_CACHE_TAG]);
        console.log(JSON.stringify({ readerEdge: "PUBLISHED_CHECKS", sequence: checksOnly.sequence, lastChecked: prepared.status === "CURRENT" ? prepared.servedGeneratedAt : null, purged: purge.purged }));
      } else if (checksOnly?.status === "CURRENT" || checksOnly?.status === "RACED") {
        console.log(JSON.stringify({ readerEdge: `CHECKS_${checksOnly.status}`, sequence: checksOnly.sequence }));
      } else if (checksOnly?.status === "FAILED") {
        failed = true;
        process.stderr.write(`READER_EDGE_PUBLISH_FAILED: ${safeFailure(checksOnly.error)}\n`);
      } else if (carry.current) {
        // Exactly what the publish would answer, without the prepared row.
        console.log(JSON.stringify({ readerEdge: "CURRENT", sequence: carry.sequence }));
      } else {
        const readBack = await readPreparedMeetingsProjection({ store });
        if (readBack.kind === "PROMOTED") {
          const edge = await publishReaderEdgeArtifacts(
            readBack.value,
            {
              sourceThrough: readBack.metadata.sourceThrough,
              retrievedAt: readBack.metadata.retrievedAt,
              promotedThrough: readBack.metadata.promotedAt,
            },
            {
              store: artifactStore,
              now: observedAt,
              ...(extras ? { extras } : {}),
              ...(Object.keys(authority).length > 0 ? { authority } : {}),
              ...(registrations !== undefined ? { registrations } : {}),
              ...(checks !== undefined ? { checks } : {}),
            },
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
    stage?.("readback repair started");
    const result = await repairRoutineReaderProjectionReadback(store, contract, observedAt, undefined, { attestor });
    stage?.(`readback repair ${result.kind}`);
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(
      contract,
      { ok: true, value: result },
    )));
  } catch (error) {
    stage?.("readback repair failed");
    failed = true;
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(
      contract,
      { ok: false, error: safeFailure(sanitizedErrorDiagnostic(error)) },
    )));
  }
}

if (failed) process.exitCode = 2;
