import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { preparePublishedMeetingSnapshot, readPreparedMeetingsProjection } from "../meetings/prepared-snapshot.ts";
import {
  publishReaderEdgeArtifacts,
  purgeReaderCacheTags,
  READER_MANIFEST_CACHE_TAG,
  servedAuthorityVersion,
  type PublishAuthority,
  type PublishAuthorityCarried,
  type PublishAuthorityValue,
  type PublishRegistrations,
} from "../meetings/edge-serving.ts";
import { resolveReaderArtifactWriteStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { AuthorityFamily, PromotedAuthorityFamily } from "../meetings/edge-artifacts.ts";
import type { RoutineRecordClass, PromotedPointerIdentity } from "./types.ts";
import { refreshCommentAccessFromPromoted, readCuratedReaderProjection } from "./curated-reader-read-model.ts";
import { currentCommentAccess } from "../registry/comment-access.ts";
import { readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import { readRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { REGISTRY_RUNTIME_SCOPE, type RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { readPlacePointerSlice, type PlaceCaptureRead } from "./held-place-slices.ts";
import { readCensusGeographyProjection } from "../census-geography/reader.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../census-geography/publication.ts";
import { REGISTRATION_SCOPES, registrationEdgePlan } from "../registration/edge.ts";
import { readRegistrationProjection } from "../registration/reader.ts";
import { readFederalDirectoryProjection } from "../officials/federal-directory-read-model.ts";
import { readOfficialStateLegislatorsProjection } from "../state-rollcalls/legislators.ts";
import { combinedOutcomeVersionId, combineOutcomeProjections, readMesaOutcomeProjection, readOutcomeProjection } from "../outcomes/store.ts";
import { MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, PIMA_LEGISTAR_OUTCOMES_CONTRACT } from "../outcomes/data-plane.ts";
import { OFFICIAL_STATE_LEGISLATOR_TARGETS } from "../state-rollcalls/authority.ts";
import type { OfficialStateLegislatorReadModel } from "./candidate-builders.ts";
import type { RoutineDataStore } from "./store.ts";
import { readPromotedEdgeFamilies, promotedEdgePointers } from "./promoted-edge-publication.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { censusEdgePublication } from "../../scripts/lib/census-edge-publication.ts";

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


import type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";
export type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";

/** Publish serving copies independently of per-contract reader repair. */
export async function publishRoutineReaderEdgeOutcome(store: RoutineDataStore, observedAt: string,
  selected: readonly Pick<PromotedPointerIdentity, "recordClass" | "scope">[] | null = null,
  options: { readonly artifactStore?: ReaderArtifactStore | null;
    readonly requireLiveStore?: boolean;
    readonly readMeetingRegistry?: (divisions: readonly string[], bodies: readonly string[]) => Promise<PlaceCaptureRead<RegistryRuntimeReadModel>> } = {},
): Promise<ReaderEdgePublicationOutcome> {
  let failed = false;
  let destination: ReaderEdgePublicationOutcome["store"] = "not configured";
  let sequence: number | null = null;
  let supersededMeetingFields: number | undefined;
  let status = "FAILED";
  let detail: string | null = null;
  const owns = (recordClass: RoutineRecordClass, scope: string) => selected === null || selected.some(pointer => pointer.recordClass === recordClass && pointer.scope === scope);
  const manual = (id: string) => MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(contract => contract.id === id)!;
  const specialPointers = {
    "census-districts": [{ recordClass: CENSUS_GEO_RECORD_CLASS, scope: CENSUS_GEO_SCOPE }],
    "registry-runtime": [manual("registry-runtime-bindings")],
    "federal-directory": [manual("congress-bulk-roster")],
    "campaign-sites": [manual("campaign-sites")],
    "state-legislators": OFFICIAL_STATE_LEGISLATOR_TARGETS.map(target => ({ recordClass: "STATE_LEGISLATOR" as const, scope: target.jurisdiction })),
    "meeting-outcomes": [PIMA_LEGISTAR_OUTCOMES_CONTRACT, MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT],
    "comment-access": [manual("comment-access")],
  };
  const refreshes = (family: keyof typeof specialPointers) => specialPointers[family].some(pointer => owns(pointer.recordClass, pointer.scope));
  const pointerFamilies = Object.fromEntries(Object.entries(promotedEdgePointers()).filter(([, pointers]) => pointers.some(pointer => owns(pointer.recordClass, pointer.scope)))) as ReturnType<typeof promotedEdgePointers>;

  // PDC-9: publish the composed snapshot as GEOGRAPHIC edge artifacts so the
  // reader serves ready-to-display data from the CDN edge — no database wake,
  // no 124-partition compose per visit, and new data appears without a rebuild.
  // Reads the prepared row (one cheap query, no recompose), partitions it by
  // state, writes the immutable artifacts and flips the manifest with a monotonic
  // CAS, then purges the manifest cache tag for instant switchover. Idempotent
  // (unchanged data republishes nothing) and last-valid-safe (a failure leaves
  // the previous manifest serving). The production supervisor reports missing
  // or local-only storage as a failure; it cannot establish live delivery.
  //
  // R28 (2026-09-25): the served manifest is read first, and the prepared row
  // (about 7.5 MB) is read only when the publish could change something
  // (scripts/lib/reader-edge-current.ts). Every pass once read the whole row to
  // learn that the manifest was already current.
  try {
    // Resolve the write destination once; report it even when publication fails.
    const artifactStore = options.artifactStore === undefined ? resolveReaderArtifactWriteStore() : options.artifactStore;
    destination = artifactStore?.kind === "local-file" ? "local folder" : artifactStore?.kind === "netlify-blobs" ? "Netlify Blobs" : "not configured";
    if (artifactStore === null) {
      status = "SKIPPED_NO_STORE";
      failed = true;
      detail = "Reader pages could not be updated because their publication store is not configured. Readers are still seeing the older copy.";
    } else {
      // A failed read cannot establish that no serving copy exists. Let the
      // outer publication error handler retain it and report a retryable error.
      const servedManifest = (await artifactStore.readManifest())?.manifest ?? null;
      sequence = servedManifest?.sequence ?? null;
      if (options.requireLiveStore && artifactStore.kind === "local-file") {
        throw new Error("Reader pages would be saved to a folder on the runner. Readers are still seeing the older copy.");
      }
      // Read only identities, grouped by class, once for this publication pass.
      const grouped = new Map<RoutineRecordClass, Set<string>>();
      for (const pointer of [...Object.values(specialPointers).flat().filter(pointer => owns(pointer.recordClass, pointer.scope)), ...Object.values(pointerFamilies).flat(),
        ...[manual("comment-access"), manual("everyday-routing")].filter(pointer => owns(pointer.recordClass, pointer.scope)),
        ...(selected === null || selected.some(pointer => pointer.recordClass === "REGISTRATION") ? REGISTRATION_SCOPES.map(scope => ({ recordClass: "REGISTRATION" as const, scope })) : [])]) {
        const scopes = grouped.get(pointer.recordClass) ?? new Set<string>();
        scopes.add(pointer.scope); grouped.set(pointer.recordClass, scopes);
      }
      const identities = new Map<string, PromotedPointerIdentity | null>();
      await Promise.all([...grouped].map(async ([recordClass, scopes]) => {
        for (const scope of scopes) identities.set(recordClass + ":" + scope, null);
        for (const pointer of await store.readPromotionIdentities(recordClass, [...scopes])) identities.set(recordClass + ":" + pointer.scope, pointer);
      }));
      store = new Proxy(store, { get(target, key) {
        if (key === "readPromotionIdentity") return async (recordClass: RoutineRecordClass, scope: string) => identities.has(recordClass + ":" + scope) ? identities.get(recordClass + ":" + scope)! : target.readPromotionIdentity(recordClass, scope);
        if (key === "readPromotionIdentities") return async (recordClass: RoutineRecordClass, scopes: readonly string[]) => scopes.every(scope => identities.has(recordClass + ":" + scope))
          ? scopes.flatMap(scope => identities.get(recordClass + ":" + scope) ?? []) : target.readPromotionIdentities(recordClass, scopes);
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } });
      const preparesMeetings = selected === null || selected.some(pointer => pointer.recordClass === "MEETING" || pointer.recordClass === "REGISTRY_RUNTIME_BINDING");
      const prepared = preparesMeetings ? await preparePublishedMeetingSnapshot(store, observedAt) : null;
      if (prepared?.status === "FAILED" || prepared?.status === "NOT_COMPOSABLE") {
        failed = true;
        detail = prepared.status === "FAILED" ? safeFailure(prepared.error) : "Reader meetings could not be assembled. " + safeFailure(prepared.detail);
        console.error("PREPARED_MEETING_SNAPSHOT_FAILED: " + detail);
      }

      // The other ready-to-display families the reader serves, read here (the
      // single clock, production DB) so the visitor never reads them from the DB.
      // A failed read leaves them out of the manifest; the reader then falls back
      // to its own DB read for that family — never a hard failure of the publish.
      const extras: { commentAccess?: readonly unknown[]; everydayRouting?: unknown; versionIds: Partial<Record<"comment-access" | "everyday-routing", string | null>> } = {
        commentAccess: servedManifest?.commentAccess, everydayRouting: servedManifest?.everydayRouting, versionIds: { ...servedManifest?.extrasVersionIds },
      };
      for (const id of ["comment-access", "everyday-routing"] as const) {
        const contract = manual(id);
        if (!owns(contract.recordClass, contract.scope)) continue;
        try {
          const versionId = (await store.readPromotionIdentity(contract.recordClass, contract.scope))?.versionId ?? null;
          if (servedManifest?.extrasVersionIds?.[id] === versionId) continue;
          if (id === "comment-access") {
            await refreshCommentAccessFromPromoted({ store, now: observedAt, bypassCache: true });
            extras.commentAccess = currentCommentAccess();
          } else {
            const routing = await readEverydayRoutingProjection({ store, now: observedAt, bypassCache: true });
            if (routing.kind !== "PROMOTED" && routing.kind !== "NOT_RECORDED") throw new Error("everyday routing read " + routing.kind);
            extras.everydayRouting = routing.kind === "PROMOTED" ? routing.value : null;
          }
          extras.versionIds[id] = versionId;
        } catch (error) {
          failed = true;
          console.error("READER_EDGE_EXTRAS_SKIPPED: " + safeFailure(sanitizedErrorDiagnostic(error)));
        }
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
      const authority: PublishAuthority = selected === null ? {} : Object.fromEntries(Object.entries(servedManifest?.authorityArtifacts ?? {}).map(([family, ref]) => [family, { versionId: ref.version, carried: true }]));
      if (refreshes("census-districts")) authority["census-districts"] = await censusEdgePublication({
        servedVersion: servedAuthorityVersion(servedManifest, "census-districts"),
        readVersion: pointerVersion(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE),
        readProjection: () => readCensusGeographyProjection({ store, now: observedAt }),
        onFailure: error => {
          failed = true;
          process.stderr.write(`READER_EDGE_AUTHORITY_REFRESH_FAILED: census-districts ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
        },
      });
      if (refreshes("registry-runtime")) try {
        delete authority["registry-runtime"];
        const carried = await servedIfCurrent("registry-runtime", manualPointer("registry-runtime-bindings"));
        if (carried !== null) authority["registry-runtime"] = { versionId: carried, carried: true };
        else {
          const rt = await readRegistryRuntimeProjection({ store, now: observedAt, bypassCache: true });
          if (rt.kind === "PROMOTED" && rt.metadata.versionId) authority["registry-runtime"] = { value: rt.value, versionId: rt.metadata.versionId };
          else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: registry-runtime kind=${rt.kind}\n`);
        }
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: registry-runtime ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      if (refreshes("federal-directory")) try {
        delete authority["federal-directory"];
        const carried = await servedIfCurrent("federal-directory", manualPointer("congress-bulk-roster"));
        if (carried !== null) authority["federal-directory"] = { versionId: carried, carried: true };
        else {
          const fd = await readFederalDirectoryProjection({ store, now: observedAt, bypassCache: true });
          if (fd.kind === "PROMOTED" && fd.metadata.versionId) authority["federal-directory"] = { value: fd.value, versionId: fd.metadata.versionId };
          else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: federal-directory kind=${fd.kind}\n`);
        }
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: federal-directory ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      if (refreshes("campaign-sites")) try {
        delete authority["campaign-sites"];
        const carried = await servedIfCurrent("campaign-sites", manualPointer("campaign-sites"));
        if (carried !== null) authority["campaign-sites"] = { versionId: carried, carried: true };
        else {
          const cs = await readCuratedReaderProjection("campaign-sites", { store, now: observedAt, bypassCache: true });
          if (cs.kind === "PROMOTED" && cs.metadata.versionId) authority["campaign-sites"] = { value: cs.value, versionId: cs.metadata.versionId };
          else process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: campaign-sites kind=${cs.kind}\n`);
        }
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: campaign-sites ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      // State legislators: one artifact holding the promoted read model per scope
      // (the pilot state chambers). Each scope that fails/absent is simply omitted;
      // the reader falls back to the DB for that scope only.
      if (refreshes("state-legislators")) try {
        delete authority["state-legislators"];
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
              const sl = await readOfficialStateLegislatorsProjection(scope, { store, now: observedAt, bypassCache: true });
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
      if (refreshes("meeting-outcomes")) try {
        delete authority["meeting-outcomes"];
        // Pima's and Mesa's pointers, combined (NH332): the artifact is Pima's
        // alone while Mesa has no pointer, and names both versions once it does.
        const carried = await servedIfCurrent("meeting-outcomes", async () => combinedOutcomeVersionId(
          await pointerVersion(PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass, PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope)(),
          await pointerVersion(MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT.recordClass, MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT.scope)(),
        ));
        if (carried !== null) authority["meeting-outcomes"] = { versionId: carried, carried: true };
        else {
          const oc = await readOutcomeProjection({ store, now: observedAt, bypassCache: true });
          const mesa = await readMesaOutcomeProjection({ store, now: observedAt, bypassCache: true });
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
      if (refreshes("comment-access")) try {
        delete authority["comment-access"];
        const carried = await servedIfCurrent("comment-access", manualPointer("comment-access"));
        if (carried !== null) authority["comment-access"] = { versionId: carried, carried: true };
        else {
          const ca = await readCuratedReaderProjection("comment-access", { store, now: observedAt, bypassCache: true });
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
        const promoted = await readPromotedEdgeFamilies({ store, servedManifest, now: observedAt, families: pointerFamilies });
        for (const family of Object.keys(pointerFamilies) as PromotedAuthorityFamily[]) delete authority[family];
        Object.assign(authority, promoted.authority);
        for (const line of promoted.skipped) process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: ${safeFailure(line)}\n`);
      } catch (error) {
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: promoted pointers ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      // Every state's promoted registration (lib/registration/edge.ts): one identity read for every registration
      // pointer decides which states carry by reference; only a state whose version moved is read. The section is
      // complete or left out: any failure leaves it out this pass, and the reader reads registration from the database.
      let registrations: PublishRegistrations | undefined = servedManifest?.registrations === undefined ? undefined : Object.fromEntries(Object.entries(servedManifest.registrations).map(([state, ref]) => [state, { versionId: ref.version, carried: true }]));
      if (selected === null || selected.some(pointer => pointer.recordClass === "REGISTRATION")) try {
        const plan = registrationEdgePlan(await store.readPromotionIdentities("REGISTRATION", REGISTRATION_SCOPES), servedManifest?.registrations);
        const entries: Record<string, PublishAuthorityValue | PublishAuthorityCarried> = {};
        for (const [state, versionId] of Object.entries(plan.carried)) entries[state] = { versionId, carried: true };
        for (const [state, versionId] of Object.entries(plan.publish)) {
          const read = await readRegistrationProjection(state, { store, now: observedAt, bypassCache: true });
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
      // Authority-only updates carry geographic references; unchanged meeting payloads never cross the DB.
      const meetingRegistryVersion = authority["registry-runtime"]?.versionId ?? null;
      const sameComposition = prepared?.status === "CURRENT" && servedManifest?.meetingLayout === "governing-area" &&
        servedManifest.meetingRegistryVersion !== undefined && servedManifest.meetingRegistryVersion === meetingRegistryVersion &&
        (servedManifest.composition !== undefined ? servedManifest.composition === prepared.composition : servedManifest.generatedAt === prepared.generatedAt);
      const checks = prepared?.status === "CURRENT" || prepared?.status === "PUBLISHED" ? { composition: prepared.composition, freshChecks: prepared.freshChecks } : undefined;
      let meetingRead: Awaited<ReturnType<typeof readPreparedMeetingsProjection>> | null = null;
      if (prepared !== null && !sameComposition && (prepared.status === "CURRENT" || prepared.status === "PUBLISHED")) {
        meetingRead = await readPreparedMeetingsProjection({ store });
        if (meetingRead.kind !== "PROMOTED") throw new Error("Prepared meeting copy read " + meetingRead.kind);
      }
      let meetingBodies: RegistryRuntimeReadModel["registry"]["bodies"] | undefined;
      if (meetingRead?.kind === "PROMOTED") {
        supersededMeetingFields = meetingRead.value.meetings.reduce((count, meeting) => count + (meeting.publicationConflicts?.length ?? 0), 0);
        const registry = authority["registry-runtime"];
        if (meetingRead.value.meetings.length === 0) {
          meetingBodies = [];
        } else if (registry && "value" in registry) {
          meetingBodies = (registry.value as RegistryRuntimeReadModel).registry.bodies;
        } else {
          // A carried authority stays cheap: resolve only divisions represented
          // in this changed meeting composition, including bodies' other areas.
          const divisions = [...new Set(meetingRead.value.meetings.flatMap(meeting => meeting.ocdId ? [meeting.ocdId.split("#")[0]] : []))];
          const bodyIds = [...new Set(meetingRead.value.meetings.flatMap(meeting => meeting.bodyId ? [meeting.bodyId] : []))];
          const read = await (options.readMeetingRegistry ?? ((ids, bodies) =>
            readPlacePointerSlice<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, ids, bodies)))(divisions, bodyIds);
          if (read.kind !== "PROMOTED" || read.metadata.versionId !== meetingRegistryVersion) throw new Error(`Meeting territories read ${read.kind} at a different registry version`);
          meetingBodies = read.value?.registry.bodies;
        }
      }
      const edge = await publishReaderEdgeArtifacts(meetingRead?.kind === "PROMOTED" ? meetingRead.value : null,
        meetingRead?.kind === "PROMOTED" ? { sourceThrough: meetingRead.metadata.sourceThrough, retrievedAt: meetingRead.metadata.retrievedAt, promotedThrough: meetingRead.metadata.promotedAt }
          : { sourceThrough: servedManifest?.sourceThrough ?? null, retrievedAt: prepared?.status === "CURRENT" ? prepared.checkedAt : servedManifest?.retrievedAt ?? null, promotedThrough: servedManifest?.promotedThrough ?? null },
        { store: artifactStore, now: observedAt, extras, authority, registrations, meetingBodies, meetingRegistryVersion, ...(checks ? { checks } : {}) });
      status = edge.status;
      if ("sequence" in edge) sequence = edge.sequence;
      if (edge.status === "FAILED") throw new Error(edge.error);
      if (edge.status === "NOT_COMPOSABLE") throw new Error("Reader pages could not be assembled. " + edge.detail);
      const purge = edge.status === "PUBLISHED" && artifactStore.kind === "netlify-blobs" ? await purgeReaderCacheTags([READER_MANIFEST_CACHE_TAG]) : null;
      if (purge) console.log(JSON.stringify({ readerEdgePurge: purge.purged, store: destination, sequence }));

    }
  } catch (error) {
    failed = true;
    detail = safeFailure(sanitizedErrorDiagnostic(error));
    process.stderr.write(`READER_EDGE_PUBLISH_FAILED: ${detail}\n`);
  }
  const outcome: ReaderEdgePublicationOutcome = { ok: !failed, readerEdge: failed && status !== "SKIPPED_NO_STORE" ? "FAILED" : status,
    store: destination, sequence, ...(supersededMeetingFields !== undefined ? { supersededMeetingFields } : {}), detail: failed ? detail ?? "Reader pages could not be fully updated. The earlier serving copies remain available." : null };
  console.log(JSON.stringify(outcome));
  return outcome;
}

/** Compatibility for individual data publishers and local measurement callers. */
export async function publishRoutineReaderEdge(...args: Parameters<typeof publishRoutineReaderEdgeOutcome>): Promise<boolean> {
  return (await publishRoutineReaderEdgeOutcome(...args)).ok;
}

/** The supervisor is production unless its local measurement/development opt-in is explicit. */
export async function publishSupervisorReaderEdge(
  store: RoutineDataStore, observedAt: string,
  selected: Parameters<typeof publishRoutineReaderEdgeOutcome>[2] = null,
  options: Parameters<typeof publishRoutineReaderEdgeOutcome>[3] = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ReaderEdgePublicationOutcome> {
  return publishRoutineReaderEdgeOutcome(store, observedAt, selected,
    { ...options, requireLiveStore: env.WTP_READER_EDGE_LOCAL_OK !== "1" });
}

export function readerEdgeSupervisorFailure(outcome: ReaderEdgePublicationOutcome) {
  return outcome.ok ? null : { taskId: "reader-edge-publication", code: "READER_EDGE_PUBLISH_FAILED",
    detail: outcome.detail ?? "Reader pages could not be updated." };
}
