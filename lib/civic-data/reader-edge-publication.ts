import { isPlaceEdgePointer, publishPlaceReaderEdgeOutcome } from "./place-edge-publication.ts";
import { safeReaderEdgeFailure } from "./reader-edge-outcome.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { factReader, factsVersion } from "../facts/db.ts";
import { preparePublishedMeetingSnapshot, readPreparedMeetingsProjection } from "../meetings/prepared-snapshot.ts";
import {
  publishReaderEdgeArtifacts,
  servedAuthorityVersion,
  readServedPromotedFamily,
  readStateAuthorityArtifact,
  type PublishAuthority,
  type PublishAuthorityCarried,
  type PublishAuthorityValue,
  type PublishRegistrations,
  type PublishStateAuthorities,
} from "../meetings/edge-serving.ts";
import { purgeReaderCacheTags, READER_MANIFEST_CACHE_TAG } from "../meetings/edge-blob-store.ts";
import { resolveReaderArtifactWriteStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { isGlobalAuthorityFamily, type AuthorityFamily } from "../meetings/edge-artifacts.ts";
import type { RoutineRecordClass, PromotedPointerIdentity } from "./types.ts";
import { readCuratedReaderProjection } from "./curated-reader-read-model.ts";
import { readCommentAccessFacts } from "../registry/comment-access.ts";
import { readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import { readRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { REGISTRY_RUNTIME_SCOPE, type RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { readPlaceVersionSlice, type PlaceCaptureRead } from "./held-place-slices.ts";
import { readCensusGeographyProjection } from "../census-geography/reader.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../census-geography/publication.ts";
import { REGISTRATION_SCOPES, registrationEdgePlan } from "../registration/edge.ts";
import { readRegistrationProjection } from "../registration/reader.ts";
import { FEDERAL_PORTRAITS_SCOPE, readFederalDirectoryProjection } from "../officials/federal-directory-read-model.ts";
import { readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { STATE_PEOPLE_JURISDICTIONS, statePeopleSourcePointers } from "../officials/people-identity.ts";
import { federalDirectoryVersion, statePeopleVersion } from "../officials/people-version.ts";
import { combinedOutcomeVersionId, combineOutcomeProjections, doorOutcomeParts, doorOutcomesUnreadable, outcomePointers, readDoorOutcomeProjections } from "../outcomes/store.ts";
import { DOOR_OUTCOME_POINTERS } from "../outcomes/door-outcome-pointers.ts";
import { outcomePartitionsAreCurrent } from "./outcome-partitions.ts";
import { MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, PIMA_LEGISTAR_OUTCOMES_CONTRACT } from "../outcomes/data-plane.ts";
import type { RoutineDataStore } from "./store.ts";
import { readPromotedEdgeFamilies, promotedEdgePointers, readPromotedStateEdgeFamilies, selectedStateEdgePointers } from "./promoted-edge-publication.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { censusEdgePublication } from "../../scripts/lib/census-edge-publication.ts";


import type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";
/** The registry partition a registry-runtime edge version was composed on; the rest names the facts read beside it. */
const registryPartitionVersion = (version: string) => version.split("+")[0]!;

export type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";

export async function publishRoutineReaderEdgeOutcome(store: RoutineDataStore, observedAt: string,
  selected: readonly Pick<PromotedPointerIdentity, "recordClass" | "scope">[] | null = null,
  options: { readonly artifactStore?: ReaderArtifactStore | null;
    readonly requireLiveStore?: boolean;
    readonly readMeetingRegistry?: (divisions: readonly string[], bodies: readonly string[], versionId: string) => Promise<PlaceCaptureRead<RegistryRuntimeReadModel>> } = {},
): Promise<ReaderEdgePublicationOutcome> {
  let failed = false;
  let destination: ReaderEdgePublicationOutcome["store"] = "not configured";
  let sequence: number | null = null;
  let supersededMeetingFields: number | undefined;
  let status = "FAILED";
  let detail: string | null = null;
  const owns = (recordClass: RoutineRecordClass, scope: string) => selected === null || selected.some(pointer => pointer.recordClass === recordClass &&
    pointer.scope === scope);
  const manual = (id: string) => MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(contract => contract.id === id)!;
  const specialPointers = {
    "census-districts": [{ recordClass: CENSUS_GEO_RECORD_CLASS, scope: CENSUS_GEO_SCOPE }],
    "registry-runtime": [manual("registry-runtime-bindings")],
    "federal-directory": [manual("congress-bulk-roster"), { recordClass: "FEDERAL_DIRECTORY" as const, scope: FEDERAL_PORTRAITS_SCOPE }],
    "campaign-sites": [manual("campaign-sites")],
    "state-legislators": STATE_PEOPLE_JURISDICTIONS.flatMap(jurisdiction => statePeopleSourcePointers(jurisdiction)),
    "meeting-outcomes": [PIMA_LEGISTAR_OUTCOMES_CONTRACT, MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, ...DOOR_OUTCOME_POINTERS],
  };
  const refreshes = (family: keyof typeof specialPointers) => specialPointers[family].some(pointer => owns(pointer.recordClass, pointer.scope));
  const preparesMeetings = selected === null || selected.some(pointer => pointer.recordClass === "MEETING" || pointer.recordClass === "REGISTRY_RUNTIME_BINDING");
  const statePointerFamilies = selectedStateEdgePointers(selected);
  const pointerFamilies = Object.fromEntries(Object.entries(promotedEdgePointers()).filter(([, pointers]) => pointers.some(pointer => owns(pointer.recordClass, pointer.scope)))) as ReturnType<typeof promotedEdgePointers>;

    // The served manifest is read first; the prepared row is read only when the publish could change something.
    // A failure leaves the previous manifest serving.
  try {
    const artifactStore = options.artifactStore === undefined ? resolveReaderArtifactWriteStore() : options.artifactStore;
    destination = artifactStore?.kind === "local-file" ? "local folder" : artifactStore?.kind === "netlify-blobs" ? "Netlify Blobs" : "not configured";
    if (artifactStore === null) {
      status = "SKIPPED_NO_STORE";
      failed = true;
      detail = "Reader pages could not be updated because their publication store is not configured. Readers are still seeing the older copy.";
    } else {
      if (options.requireLiveStore && artifactStore.kind === "local-file") {
        throw new Error("Reader pages would be saved to a folder on the runner. Readers are still seeing the older copy.");
      }
      const places = (selected ?? []).filter(isPlaceEdgePointer);
      if (places.length) {
        const outcome = await publishPlaceReaderEdgeOutcome(store, observedAt, places, { artifactStore });
        if (places.length === selected?.length) return outcome;
        failed ||= !outcome.ok;
        detail = outcome.detail;
      }
      const servedManifest = (await artifactStore.readAuthorityManifest())?.manifest ?? null;
      const servedMeetings = preparesMeetings ? (await artifactStore.readManifest())?.manifest ?? null : null;
      sequence = servedManifest?.sequence ?? null;
      const grouped = new Map<RoutineRecordClass, Set<string>>();
      for (const pointer of [...Object.values(specialPointers).flat().filter(pointer => owns(pointer.recordClass, pointer.scope)), ...Object.values(pointerFamilies).flat(), ...statePointerFamilies.flatMap(row => row.pointers),
        ...[manual("everyday-routing")].filter(pointer => owns(pointer.recordClass, pointer.scope)),
        ...(selected === null || selected.some(pointer => pointer.recordClass === "REGISTRATION") ? REGISTRATION_SCOPES.map(scope => ({ recordClass: "REGISTRATION" as const, scope })) : [])]) {
        const scopes = grouped.get(pointer.recordClass) ?? new Set<string>();
        scopes.add(pointer.scope); grouped.set(pointer.recordClass, scopes);
      }
      const identities = new Map<string, PromotedPointerIdentity | null>();
      const identityErrors = new Map<RoutineRecordClass, unknown>();
      await Promise.all([...grouped].map(async ([recordClass, scopes]) => {
        for (const scope of scopes) identities.set(recordClass + ":" + scope, null);
        try {
          for (const pointer of await store.readPromotionIdentities(recordClass, [...scopes])) identities.set(recordClass + ":" + pointer.scope, pointer);
        } catch (error) { identityErrors.set(recordClass, error); failed = true; }
      }));
      store = new Proxy(store, { get(target, key) {
        if (key === "readPromotionIdentity") return async (recordClass: RoutineRecordClass, scope: string) => {
          if (identityErrors.has(recordClass)) throw identityErrors.get(recordClass);
          return identities.has(recordClass + ":" + scope) ? identities.get(recordClass + ":" + scope)! : target.readPromotionIdentity(recordClass, scope);
        };
        if (key === "readPromotionIdentities") return async (recordClass: RoutineRecordClass, scopes: readonly string[]) => {
          if (identityErrors.has(recordClass)) throw identityErrors.get(recordClass);
          return scopes.every(scope => identities.has(recordClass + ":" + scope))
            ? scopes.flatMap(scope => identities.get(recordClass + ":" + scope) ?? []) : target.readPromotionIdentities(recordClass, scopes);
        };
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } });
      const prepared = preparesMeetings ? await preparePublishedMeetingSnapshot(store, observedAt) : null;
      if (prepared?.status === "FAILED" || prepared?.status === "NOT_COMPOSABLE") {
        failed = true;
        detail = prepared.status === "FAILED" ? safeReaderEdgeFailure(prepared.error) : "Reader meetings could not be assembled. " + safeReaderEdgeFailure(prepared.detail);
        console.error("PREPARED_MEETING_SNAPSHOT_FAILED: " + detail);
      }
      if (prepared?.status === "RACED") { failed = true; detail = "A newer meeting composition won publication; retry remains owed."; }

      let facts: string | null = null;
      if (refreshes("registry-runtime")) try {
        facts = await factsVersion(factReader());
      } catch (error) {
        failed = true;
        console.error("READER_EDGE_EXTRAS_SKIPPED: " + safeReaderEdgeFailure(sanitizedErrorDiagnostic(error)));
      }
            // A family whose pointer is still the version the edge serves carries its artifact forward unread.
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
      const authority: PublishAuthority = Object.fromEntries(Object.entries(servedManifest?.authorityArtifacts ?? {}).filter(([family]) =>
        isGlobalAuthorityFamily(family)).map(([family, ref]) => [family, { versionId: ref.version, carried: true }]));
      const routingContract = manual("everyday-routing");
      if (owns(routingContract.recordClass, routingContract.scope)) try {
        const versionId = (await store.readPromotionIdentity(routingContract.recordClass, routingContract.scope))?.versionId ?? "not-recorded";
        if (servedAuthorityVersion(servedManifest, "everyday-routing") !== versionId) {
          const routing = await readEverydayRoutingProjection({ store, now: observedAt, bypassCache: true });
          if (routing.kind !== "PROMOTED" && routing.kind !== "NOT_RECORDED") throw new Error("everyday routing read " + routing.kind);
          authority["everyday-routing"] = { value: { projection: routing.kind === "PROMOTED" ? routing.value : null }, versionId };
        }
      } catch (error) {
        failed = true;
        console.error("READER_EDGE_AUTHORITY_SKIPPED: everyday-routing " + safeReaderEdgeFailure(sanitizedErrorDiagnostic(error)));
      }
      if (refreshes("census-districts")) authority["census-districts"] = await censusEdgePublication({
        servedVersion: servedAuthorityVersion(servedManifest, "census-districts"),
        readVersion: pointerVersion(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE),
        readProjection: () => readCensusGeographyProjection({ store, now: observedAt }),
        onFailure: error => {
          failed = true;
          process.stderr.write(`READER_EDGE_AUTHORITY_REFRESH_FAILED: census-districts ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
        },
      });
      if (refreshes("registry-runtime") && facts !== null) try {
        // Members are facts, so the family changes when the partition or any fact does.
        const pointer = manualPointer("registry-runtime-bindings");
        const carried = await servedIfCurrent("registry-runtime", async () => { const at = await pointer(); return at && `${at}+${facts}`; });
        if (carried !== null) authority["registry-runtime"] = { versionId: carried, carried: true };
        else {
          const rt = await readRegistryRuntimeProjection({ store, now: observedAt, bypassCache: true });
          if (rt.kind === "PROMOTED" && rt.metadata.versionId) authority["registry-runtime"] = { value: rt.value, versionId: `${rt.metadata.versionId}+${facts}` };
          else if (rt.kind !== "NOT_RECORDED") throw new Error(`registry-runtime read ${rt.kind}`);
        }
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: registry-runtime ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      if (refreshes("federal-directory")) try {
        // The served version names the directory and the portraits laid on it, exactly as the reader composes it.
        const carried = await servedIfCurrent("federal-directory", async () => {
          const directory = await manualPointer("congress-bulk-roster")();
          return directory === null ? null : federalDirectoryVersion(directory, await pointerVersion("FEDERAL_DIRECTORY", FEDERAL_PORTRAITS_SCOPE)());
        });
        if (carried !== null) authority["federal-directory"] = { versionId: carried, carried: true };
        else {
          const fd = await readFederalDirectoryProjection({ store, now: observedAt, bypassCache: true });
          if (fd.kind === "PROMOTED" && fd.metadata.versionId) authority["federal-directory"] = { value: fd.value, versionId: fd.metadata.versionId };
          else if (fd.kind !== "NOT_RECORDED") throw new Error(`federal-directory read ${fd.kind}`);
        }
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: federal-directory ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      if (refreshes("campaign-sites")) try {
        const carried = await servedIfCurrent("campaign-sites", manualPointer("campaign-sites"));
        if (carried !== null) authority["campaign-sites"] = { versionId: carried, carried: true };
        else {
          const cs = await readCuratedReaderProjection("campaign-sites", { store, now: observedAt, bypassCache: true });
          if (cs.kind === "PROMOTED" && cs.metadata.versionId) authority["campaign-sites"] = { value: cs.value, versionId: cs.metadata.versionId };
          else if (cs.kind !== "NOT_RECORDED") throw new Error(`campaign-sites read ${cs.kind}`);
        }
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: campaign-sites ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      const stateLegislators: Record<string, PublishAuthorityValue | PublishAuthorityCarried> = Object.fromEntries(
        Object.entries(servedManifest?.stateLegislators ?? {}).map(([jurisdiction, ref]) => [jurisdiction, { versionId: ref.version, carried: true }]));
      if (refreshes("state-legislators")) for (const jurisdiction of STATE_PEOPLE_JURISDICTIONS) {
        if (!statePeopleSourcePointers(jurisdiction).some(pointer => owns(pointer.recordClass, pointer.scope))) continue;
        try {
          const sourcePointers = statePeopleSourcePointers(jurisdiction);
          const pointers = (await Promise.all([...new Set(sourcePointers.map(pointer=>pointer.recordClass))].map(recordClass=>
            store.readPromotionIdentities(recordClass,sourcePointers.filter(pointer=>pointer.recordClass === recordClass).map(pointer=>pointer.scope))))).flat();
          if (pointers.length === 0) continue;
          const versionId = statePeopleVersion(jurisdiction, pointers.map(pointer => ({ scope: pointer.scope, versionId: pointer.versionId })));
          if (servedManifest?.stateLegislators?.[jurisdiction]?.version === versionId) continue;
          const read = await readStatePeopleProjection(jurisdiction, { store, now: observedAt, bypassCache: true });
          if (read.kind === "PROMOTED" && read.metadata.versionId) {
            if (read.metadata.versionId !== versionId) throw new Error(`state people ${jurisdiction} did not read every accepted source version`);
            stateLegislators[jurisdiction] = servedManifest?.stateLegislators?.[jurisdiction]?.version === read.metadata.versionId
              ? { versionId: read.metadata.versionId, carried: true }
              : { value: read.value, versionId: read.metadata.versionId };
          } else if (read.kind !== "NOT_RECORDED") throw new Error(`state people ${jurisdiction} read ${read.kind}`);
        } catch (error) {
          failed = true;
          process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: state-legislators/${jurisdiction} ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
        }
      }
      if (refreshes("meeting-outcomes")) try {
        const doorPointers = outcomePointers();
        if (!outcomePartitionsAreCurrent()) {
          // The doors were not read this pass, so the door list is unknown, not empty: keep serving the last artifact
          // rather than publish one that silently drops every door's outcomes.
          const served = servedAuthorityVersion(servedManifest, "meeting-outcomes");
          if (served !== null) authority["meeting-outcomes"] = { versionId: served, carried: true };
          process.stderr.write("READER_EDGE_AUTHORITY_CARRIED: meeting-outcomes (the door registry was not read this pass)\n");
        } else {
          const carried = await servedIfCurrent("meeting-outcomes", async () => {
            const doorVersions = await Promise.all(doorPointers.map(async (pointer) => ({
              contractId: pointer.contractId,
              versionId: await pointerVersion(pointer.recordClass, pointer.scope)(),
            })));
            return combinedOutcomeVersionId(
              doorVersions.filter((door): door is { contractId: string; versionId: string } => door.versionId !== null),
            );
          });
          if (carried !== null) authority["meeting-outcomes"] = { versionId: carried, carried: true };
          else {
            // Complete or left out: a failed read must not publish the rest alone as if it had nothing.
            await readDoorOutcomeProjections({ store, now: observedAt, bypassCache: true });
            const unreadable = doorOutcomesUnreadable();
            if (unreadable.length > 0) throw new Error(`door outcomes read failed for ${unreadable.join(", ")}`);
            const combined = combineOutcomeProjections(
              doorOutcomeParts().map((part) => ({ value: part.value, pointers: [{ contractId: part.pointer.contractId, tenant: part.pointer.slug, versionId: part.versionId }] })),
            );
            if (combined !== null) authority["meeting-outcomes"] = combined;
            else process.stderr.write("READER_EDGE_AUTHORITY_SKIPPED: meeting-outcomes none promoted\n");
          }
        }
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: meeting-outcomes ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      if (facts !== null) try {
        const carried = await servedIfCurrent("comment-access", async () => facts);
        if (carried !== null) authority["comment-access"] = { versionId: carried, carried: true };
        else {
          const read = await readCommentAccessFacts();
          authority["comment-access"] = { value: read.value, versionId: read.versionId };
        }
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: comment-access ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      try {
        const promoted = await readPromotedEdgeFamilies({ store, servedManifest, now: observedAt, families: pointerFamilies,
          readServedFamily: family => readServedPromotedFamily(family, servedManifest?.authorityArtifacts?.[family], artifactStore) });
        Object.assign(authority, promoted.authority);
        if (promoted.skipped.length > 0) failed = true;
        for (const line of promoted.skipped) process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: ${safeReaderEdgeFailure(line)}\n`);
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: promoted pointers ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      let stateAuthorities: PublishStateAuthorities = {};
      try {
        const promoted = await readPromotedStateEdgeFamilies({ store, servedManifest, now: observedAt,
          selected: statePointerFamilies, artifactStore,
          readServedFamily: (family, state) => readStateAuthorityArtifact(family, state, servedManifest?.stateAuthorities?.[family]?.[state], artifactStore) });
        stateAuthorities = promoted.stateAuthorities;
        if (promoted.skipped.length) failed = true;
        for (const line of promoted.skipped) process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: ${safeReaderEdgeFailure(line)}\n`);
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: state pointers ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      let registrations: PublishRegistrations | undefined = servedManifest?.registrations === undefined ? undefined : Object.fromEntries(Object.entries(servedManifest.registrations).map(([state, ref]) => [state, { versionId: ref.version, carried: true }]));
      if (selected === null || selected.some(pointer => pointer.recordClass === "REGISTRATION")) try {
        const plan = registrationEdgePlan(await store.readPromotionIdentities("REGISTRATION", REGISTRATION_SCOPES), servedManifest?.registrations);
        const entries: Record<string, PublishAuthorityValue | PublishAuthorityCarried> = { ...registrations };
        for (const [state, versionId] of Object.entries(plan.carried)) entries[state] = { versionId, carried: true };
        for (const [state, versionId] of Object.entries(plan.publish)) {
          try {
            const read = await readRegistrationProjection(state, { store, now: observedAt, bypassCache: true });
            if (read.kind !== "PROMOTED" || read.metadata.versionId !== versionId) throw new Error(`registration ${state} read ${read.kind} at a different version`);
            entries[state] = { value: read.value, versionId };
          } catch (error) {
            failed = true;
            process.stderr.write(`READER_EDGE_REGISTRATIONS_SKIPPED: ${state} ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
          }
        }
        registrations = entries;
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_REGISTRATIONS_SKIPPED: ${safeReaderEdgeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      const meetingRegistryVersion = authority["registry-runtime"]?.versionId ?? null;
      const sameComposition = prepared?.status === "CURRENT" && servedMeetings?.meetingLayout === "governing-area" &&
        servedMeetings.meetingRegistryVersion !== undefined && servedMeetings.meetingRegistryVersion === meetingRegistryVersion &&
        (servedMeetings.composition !== undefined ? servedMeetings.composition === prepared.composition : servedMeetings.generatedAt === prepared.generatedAt);
      let checks = prepared?.status === "CURRENT" || prepared?.status === "PUBLISHED" ? { composition: prepared.composition, freshChecks: prepared.freshChecks } : undefined;
      let meetingRead: Awaited<ReturnType<typeof readPreparedMeetingsProjection>> | null = null;
      let meetingBodies: RegistryRuntimeReadModel["registry"]["bodies"] | undefined;
      try {
        if (prepared !== null && !sameComposition && (prepared.status === "CURRENT" || prepared.status === "PUBLISHED")) {
          meetingRead = await readPreparedMeetingsProjection({ store, expectedSequence: prepared.sequence });
          if (meetingRead.kind !== "PROMOTED") throw new Error("Prepared meeting copy read " + meetingRead.kind);
        }
        if (meetingRead?.kind === "PROMOTED") {
          supersededMeetingFields = meetingRead.value.meetings.reduce((count, meeting) => count + (meeting.publicationConflicts?.length ?? 0), 0);
          const registry = authority["registry-runtime"];
          if (meetingRead.value.meetings.length === 0) {
            meetingBodies = [];
          } else if (registry && "value" in registry) {
            meetingBodies = (registry.value as RegistryRuntimeReadModel).registry.bodies;
          } else {
            if (!meetingRegistryVersion) throw new Error("Meeting territories have no accepted registry version");
            const divisions = [...new Set(meetingRead.value.meetings.flatMap(meeting => meeting.ocdId ? [meeting.ocdId.split("#")[0]] : []))];
            const bodyIds = [...new Set(meetingRead.value.meetings.flatMap(meeting => meeting.bodyId ? [meeting.bodyId] : []))];
            const read = await (options.readMeetingRegistry ?? ((ids, bodies, versionId) =>
              readPlaceVersionSlice<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, versionId, ids, bodies)))(divisions, bodyIds, registryPartitionVersion(meetingRegistryVersion));
            if (read.kind !== "PROMOTED" || read.metadata.versionId !== registryPartitionVersion(meetingRegistryVersion)) throw new Error(`Meeting territories read ${read.kind} at a different registry version`);
            meetingBodies = read.value?.registry.bodies;
            if (!meetingBodies) throw new Error("The accepted registry version has no readable meeting territories");
          }
        }
      } catch (error) {
        failed = true;
        detail = safeReaderEdgeFailure(sanitizedErrorDiagnostic(error));
        process.stderr.write(`READER_EDGE_MEETINGS_CARRIED: ${detail}\n`);
        // Keep the previous meeting bytes, territory version and observation
        // dates together while independent verified families still publish.
        meetingRead = null;
        meetingBodies = undefined;
        checks = undefined;
      }
      const edge = await publishReaderEdgeArtifacts(meetingRead?.kind === "PROMOTED" ? meetingRead.value : null,
        meetingRead?.kind === "PROMOTED" ? { sourceThrough: meetingRead.metadata.sourceThrough, retrievedAt: meetingRead.metadata.retrievedAt, promotedThrough: meetingRead.metadata.promotedAt }
          : { sourceThrough: servedMeetings?.sourceThrough ?? null, retrievedAt: prepared?.status === "CURRENT" ? prepared.checkedAt : servedMeetings?.retrievedAt ?? null, promotedThrough: servedMeetings?.promotedThrough ?? null },
        { store: artifactStore, now: observedAt, authority, stateAuthorities, registrations, meetingBodies, meetingRegistryVersion,
          ...(servedManifest?.stateLegislators !== undefined || refreshes("state-legislators") ? { stateLegislators } : {}), ...(checks ? { checks } : {}) });
      status = edge.status;
      if ("sequence" in edge) sequence = edge.sequence;
      if (edge.status === "FAILED") throw new Error(edge.error);
      if (edge.status === "RACED") throw new Error("A concurrent reader publication moved the manifest; retry remains owed.");
      if (edge.status === "NOT_COMPOSABLE") throw new Error("Reader pages could not be assembled. " + edge.detail);
      const purge = edge.status === "PUBLISHED" && artifactStore.kind === "netlify-blobs" ? await purgeReaderCacheTags([READER_MANIFEST_CACHE_TAG]) : null;
      if (purge) console.log(JSON.stringify({ readerEdgePurge: purge.purged, store: destination, sequence }));

    }
  } catch (error) {
    failed = true;
    detail = safeReaderEdgeFailure(sanitizedErrorDiagnostic(error));
    process.stderr.write(`READER_EDGE_PUBLISH_FAILED: ${detail}\n`);
  }
  const outcome: ReaderEdgePublicationOutcome = { ok: !failed, readerEdge: failed && status !== "SKIPPED_NO_STORE" ? "FAILED" : status,
    store: destination, sequence, ...(supersededMeetingFields !== undefined ? { supersededMeetingFields } : {}), detail: failed ? detail ?? "Reader pages could not be fully updated. The earlier serving copies remain available." : null };
  console.log(JSON.stringify(outcome));
  return outcome;
}

export async function publishRoutineReaderEdge(...args: Parameters<typeof publishRoutineReaderEdgeOutcome>): Promise<boolean> {
  return (await publishRoutineReaderEdgeOutcome(...args)).ok;
}

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
