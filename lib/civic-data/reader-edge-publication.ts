import { routineScopeState } from "./state-scope.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { factReader, factsVersion } from "../facts/db.ts";
import { preparePublishedMeetingSnapshot, readPreparedMeetingPublication } from "../meetings/prepared-snapshot.ts";
import {
  publishReaderEdgeArtifacts,
  purgeReaderCacheTags,
  READER_MANIFEST_CACHE_TAG,
  servedAuthorityVersion,
  readServedPromotedFamily,
  readAuthorityArtifactValue,
  type PublishAuthority,
  type PublishAuthorityCarried,
  type PublishAuthorityValue,
  type PublishRegistrations,
} from "../meetings/edge-serving.ts";
import { resolveReaderArtifactWriteStore, scopedReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { AuthorityFamily } from "../meetings/edge-artifacts.ts";
import type { RoutineRecordClass, PromotedPointerIdentity } from "./types.ts";
import { readCuratedReaderProjection } from "./curated-reader-read-model.ts";
import { currentCommentAccess, readCommentAccessFacts } from "../registry/comment-access.ts";
import { readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import { readRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { REGISTRY_RUNTIME_SCOPE, type RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { type PlaceCaptureRead } from "./held-place-slices.ts";
import { readCensusGeographyProjection } from "../census-geography/reader.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../census-geography/publication.ts";
import { REGISTRATION_SCOPES, registrationEdgePlan } from "../registration/edge.ts";
import { readRegistrationProjection } from "../registration/reader.ts";
import { registrationTarget } from "../registration/publication.ts";
import { readMeetingBodiesForPublication } from "./meeting-dependencies.ts";
import { FEDERAL_PORTRAITS_SCOPE, readFederalDirectoryProjection } from "../officials/federal-directory-read-model.ts";
import { readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { STATE_PEOPLE_JURISDICTIONS, statePeopleSourcePointers } from "../officials/people-identity.ts";
import { federalDirectoryVersion, statePeopleVersion } from "../officials/people-version.ts";
import type { OfficialStateLegislatorReadModel } from "./candidate-builders.ts";
import { combinedOutcomeVersionId, combineOutcomeProjections, doorOutcomeParts, doorOutcomesUnreadable, outcomePointers, readDoorOutcomeProjections } from "../outcomes/store.ts";
import { outcomePartitionsAreCurrent } from "./outcome-partitions.ts";
import type { RoutineDataStore } from "./store.ts";
import { readPromotedEdgeFamilies, promotedEdgePointers } from "./promoted-edge-publication.ts";
import { readerEdgeSpecialPointers } from "./reader-edge-inputs.ts";
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
/** The registry partition a registry-runtime edge version was composed on; the rest names the facts read beside it. */
const registryPartitionVersion = (version: string) => version.split("+")[0]!;

export type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";

export async function publishRoutineReaderEdgeOutcome(store: RoutineDataStore, observedAt: string,
  selected: readonly Pick<PromotedPointerIdentity, "recordClass" | "scope">[] | null = null,
  options: { readonly artifactStore?: ReaderArtifactStore | null;
    readonly requireLiveStore?: boolean;
    readonly state?: string;
    readonly publicationFingerprint?: string;
    readonly readMeetingRegistry?: (divisions: readonly string[], bodies: readonly string[], versionId: string) => Promise<PlaceCaptureRead<RegistryRuntimeReadModel>> } = {},
): Promise<ReaderEdgePublicationOutcome> {
  const requestedState = options.state ?? process.env.WTP_SOURCE_STATE;
  const state = requestedState ? routineScopeState(requestedState) : "US";
  let failed = false;
  let destination: ReaderEdgePublicationOutcome["store"] = "not configured";
  let sequence: number | null = null;
  let supersededMeetingFields: number | undefined;
  let meetingChunks = 0;
  let readMeetingChunks = 0;
  let status = "FAILED";
  let detail: string | null = null;
  const owns = (recordClass: RoutineRecordClass, scope: string) => (!state || routineScopeState(scope) === state) && (selected === null || selected.some(pointer => pointer.recordClass === recordClass && pointer.scope === scope));
  const manual = (id: string) => MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(contract => contract.id === id)!;
  const specialPointers = readerEdgeSpecialPointers();
  const refreshes = (family: keyof typeof specialPointers) => specialPointers[family].some(pointer => owns(pointer.recordClass, pointer.scope));
  const pointerFamilies = Object.fromEntries(Object.entries(promotedEdgePointers()).filter(([, pointers]) => pointers.some(pointer => owns(pointer.recordClass, pointer.scope)))) as ReturnType<typeof promotedEdgePointers>;

    // The served manifest is read first; the prepared row is read only when the publish could change something.
    // A failure leaves the previous manifest serving.
  try {
    const destinationStore = options.artifactStore === undefined ? resolveReaderArtifactWriteStore() : options.artifactStore;
    const artifactStore = destinationStore && state !== "US" ? scopedReaderArtifactStore(destinationStore, state.replace(/^US-/, "")) : destinationStore;
    destination = artifactStore?.kind === "local-file" ? "local folder" : artifactStore?.kind === "netlify-blobs" ? "Netlify Blobs" : "not configured";
    if (artifactStore === null) {
      status = "SKIPPED_NO_STORE";
      failed = true;
      detail = "Reader pages could not be updated because their publication store is not configured. Readers are still seeing the older copy.";
    } else {
      // A failed read cannot establish that no serving copy exists. Let the
      // outer publication error handler retain it and report a retryable error.
      const servedManifest = (await artifactStore.readManifest())?.manifest ?? null;
      const meetingArtifactStore = state === "US" ? scopedReaderArtifactStore(artifactStore,"US") : artifactStore;
      const servedMeetingManifest = state === "US" ? (await meetingArtifactStore.readManifest())?.manifest ?? null : servedManifest;
      sequence = servedManifest?.sequence ?? null;
      if (options.requireLiveStore && artifactStore.kind === "local-file") {
        throw new Error("Reader pages would be saved to a folder on the runner. Readers are still seeing the older copy.");
      }
      const grouped = new Map<RoutineRecordClass, Set<string>>();
      for (const pointer of [...Object.values(specialPointers).flat().filter(pointer => owns(pointer.recordClass, pointer.scope)), ...Object.values(pointerFamilies).flat(),
        ...[manual("everyday-routing")].filter(pointer => owns(pointer.recordClass, pointer.scope)),
        ...(selected === null || selected.some(pointer => pointer.recordClass === "REGISTRATION") ? REGISTRATION_SCOPES.filter(scope => !state || routineScopeState(scope) === state).map(scope => ({ recordClass: "REGISTRATION" as const, scope })) : [])]) {
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
      const preparesMeetings = state === "US" ? Boolean(selected?.some(pointer => pointer.recordClass === "MEETING") ||
        servedMeetingManifest?.meetingLayout && (selected === null || selected.some(pointer => pointer.recordClass === "REGISTRY_RUNTIME_BINDING")))
        : selected === null || selected.some(pointer => pointer.recordClass === "MEETING" || pointer.recordClass === "REGISTRY_RUNTIME_BINDING" || pointer.recordClass === "REGISTRATION");
      const prepared = preparesMeetings ? await preparePublishedMeetingSnapshot(store, observedAt, { state }) : null;
      if (prepared?.status === "FAILED" || prepared?.status === "NOT_COMPOSABLE") {
        failed = true;
        detail = prepared.status === "FAILED" ? safeFailure(prepared.error) : "Reader meetings could not be assembled. " + safeFailure(prepared.detail);
        console.error("PREPARED_MEETING_SNAPSHOT_FAILED: " + detail);
      }
      if (prepared?.status === "RACED") { failed = true; detail = "A newer meeting composition won publication; retry remains owed."; }

      // Each failed refresh keeps its accepted reference while independent replacements publish.
      const extras: { commentAccess?: readonly unknown[]; everydayRouting?: unknown; versionIds: Partial<Record<"comment-access" | "everyday-routing", string | null>> } = {
        commentAccess: servedManifest?.commentAccess, everydayRouting: servedManifest?.everydayRouting, versionIds: { ...servedManifest?.extrasVersionIds },
      };
      let facts: string | null = null;
      let comments: Awaited<ReturnType<typeof readCommentAccessFacts>> | null = null;
      try {
        facts = await factsVersion(factReader(), "", state);
        if (facts !== null && servedManifest?.extrasVersionIds?.["comment-access"] !== facts) {
          comments = await readCommentAccessFacts(factReader(), state);
          extras.commentAccess = currentCommentAccess();
          extras.versionIds["comment-access"] = comments.versionId;
        }
      } catch (error) {
        failed = true;
        console.error("READER_EDGE_EXTRAS_SKIPPED: " + safeFailure(sanitizedErrorDiagnostic(error)));
      }
      const routingContract = manual("everyday-routing");
      if (owns(routingContract.recordClass, routingContract.scope)) try {
        const versionId = (await store.readPromotionIdentity(routingContract.recordClass, routingContract.scope))?.versionId ?? null;
        if (servedManifest?.extrasVersionIds?.["everyday-routing"] !== versionId) {
          const routing = await readEverydayRoutingProjection({ store, now: observedAt, bypassCache: true });
          if (routing.kind !== "PROMOTED" && routing.kind !== "NOT_RECORDED") throw new Error("everyday routing read " + routing.kind);
          extras.everydayRouting = routing.kind === "PROMOTED" ? routing.value : null;
          extras.versionIds["everyday-routing"] = versionId;
        }
      } catch (error) {
        failed = true;
        console.error("READER_EDGE_EXTRAS_SKIPPED: " + safeFailure(sanitizedErrorDiagnostic(error)));
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
      const authority: PublishAuthority = Object.fromEntries(Object.entries(servedManifest?.authorityArtifacts ?? {}).filter(([family]) => family !== "state-legislators").map(([family, ref]) => [family, { versionId: ref.version, carried: true }]));
      if (refreshes("census-districts")) authority["census-districts"] = await censusEdgePublication({
        servedVersion: servedAuthorityVersion(servedManifest, "census-districts"),
        readVersion: pointerVersion(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE),
        readProjection: () => readCensusGeographyProjection({ store, now: observedAt }),
        onFailure: error => {
          failed = true;
          process.stderr.write(`READER_EDGE_AUTHORITY_REFRESH_FAILED: census-districts ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
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
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: registry-runtime ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
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
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: federal-directory ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
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
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: campaign-sites ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      const stateLegislators: Record<string, PublishAuthorityValue | PublishAuthorityCarried> = Object.fromEntries(
        Object.entries(servedManifest?.stateLegislators ?? {}).map(([jurisdiction, ref]) => [jurisdiction, { versionId: ref.version, carried: true }]));
      const formerRoster = servedManifest?.authorityArtifacts?.["state-legislators"];
      if (formerRoster && servedManifest?.stateLegislators === undefined) {
        // Convert the previously accepted bundle once before dropping its old reference. A failed source
        // can then retain its own original value/date while other jurisdictions move to composed people.
        const held = await readAuthorityArtifactValue("state-legislators", formerRoster, artifactStore) as Record<string, OfficialStateLegislatorReadModel> | null;
        if (!held) throw new Error("The previously accepted state roster could not be split into jurisdiction artifacts");
        const versions = new Map(formerRoster.version.split("|").map(entry => {
          const separator = entry.indexOf("=");
          return [entry.slice(0, separator), entry.slice(separator + 1)] as const;
        }));
        for (const [jurisdiction, value] of Object.entries(held)) {
          const versionId = versions.get(jurisdiction);
          if (!versionId || value.jurisdiction !== jurisdiction) throw new Error(`State roster migration lacks its accepted version: ${jurisdiction}`);
          stateLegislators[jurisdiction] = { versionId, value };
        }
      }
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
          process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: state-legislators/${jurisdiction} ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
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
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: meeting-outcomes ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      if (facts !== null) try {
        const carried = await servedIfCurrent("comment-access", async () => facts);
        if (carried !== null) authority["comment-access"] = { versionId: carried, carried: true };
        else {
          const read = comments ?? await readCommentAccessFacts(factReader(), state);
          authority["comment-access"] = { value: read.value, versionId: read.versionId };
        }
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: comment-access ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      try {
        const promoted = await readPromotedEdgeFamilies({ store, servedManifest, now: observedAt, families: pointerFamilies,
          readServedFamily: family => readServedPromotedFamily(family, servedManifest?.authorityArtifacts?.[family], artifactStore) });
        Object.assign(authority, promoted.authority);
        if (promoted.skipped.length > 0) failed = true;
        for (const line of promoted.skipped) process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: ${safeFailure(line)}\n`);
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: promoted pointers ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      let registrations: PublishRegistrations | undefined = servedManifest?.registrations === undefined ? undefined : Object.fromEntries(Object.entries(servedManifest.registrations).map(([state, ref]) => [state, { versionId: ref.version, carried: true }]));
      if (selected === null || selected.some(pointer => pointer.recordClass === "REGISTRATION")) try {
        const plan = registrationEdgePlan(await store.readPromotionIdentities("REGISTRATION", REGISTRATION_SCOPES.filter(scope => !state || routineScopeState(scope) === state)), servedManifest?.registrations);
        const entries: Record<string, PublishAuthorityValue | PublishAuthorityCarried> = { ...registrations };
        for (const [state, versionId] of Object.entries(plan.carried)) entries[state] = { versionId, carried: true };
        for (const [state, versionId] of Object.entries(plan.publish)) {
          try {
            const read = await readRegistrationProjection(state, { store, now: observedAt, bypassCache: true });
            if (read.kind !== "PROMOTED" || read.metadata.versionId !== versionId) throw new Error(`registration ${state} read ${read.kind} at a different version`);
            entries[state] = { value: read.value, versionId };
          } catch (error) {
            failed = true;
            process.stderr.write(`READER_EDGE_REGISTRATIONS_SKIPPED: ${state} ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
          }
        }
        registrations = entries;
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_REGISTRATIONS_SKIPPED: ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      const reviewedRegistryVersion = authority["registry-runtime"]?.versionId ?? (preparesMeetings
        ? (await store.readPromotionIdentity("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE))?.versionId ?? null : null);
      const registrationVersion = preparesMeetings && state !== "US"
        ? (await store.readPromotionIdentity("REGISTRATION",registrationTarget(state.replace(/^US-/,"")).scope))?.versionId : null;
      const meetingRegistryVersion = registrationVersion ? `${reviewedRegistryVersion ?? "no-reviewed-registry"}+registration:${registrationVersion}` : reviewedRegistryVersion;
      const sameComposition = prepared?.status === "CURRENT" && servedMeetingManifest?.meetingLayout === "governing-area" &&
        servedMeetingManifest.meetingRegistryVersion !== undefined && servedMeetingManifest.meetingRegistryVersion === meetingRegistryVersion &&
        (servedMeetingManifest.composition !== undefined ? servedMeetingManifest.composition === prepared.composition : servedMeetingManifest.generatedAt === prepared.generatedAt);
      let checks = prepared?.status === "CURRENT" || prepared?.status === "PUBLISHED" ? { composition: prepared.composition, freshChecks: prepared.freshChecks, documentChecks: prepared.documentChecks } : undefined;
      let meetingRead: Awaited<ReturnType<typeof readPreparedMeetingPublication>> = null;
      try {
        if (prepared !== null && !sameComposition && (prepared.status === "CURRENT" || prepared.status === "PUBLISHED")) {
          meetingRead = await readPreparedMeetingPublication({ store, expectedSequence: prepared.sequence, state });
          if (!meetingRead) throw new Error("Prepared meeting copy is missing");
          const chunks = meetingRead.value.chunks;
          const registry = authority["registry-runtime"];
          const acceptedBodies = registry && "value" in registry
            ? new Map((registry.value as RegistryRuntimeReadModel).registry.bodies.map(body => [body.id, body])) : null;
          if (meetingRead.value.meetingCount && !meetingRegistryVersion) throw new Error("Meeting territories have no accepted registry version");
          supersededMeetingFields = 0;
          meetingRead = { ...meetingRead, value: { ...meetingRead.value, chunks: (async function* () {
            for await (const chunk of chunks) {
              meetingChunks++;
              yield { key: chunk.key, version: chunk.version, read: async () => {
                const { snapshot } = await chunk.read();
                readMeetingChunks++;
                supersededMeetingFields! += snapshot.meetings.reduce((count, meeting) => count + (meeting.publicationConflicts?.length ?? 0), 0);
                const bodyIds = [...new Set(snapshot.meetings.flatMap(meeting => meeting.bodyId ? [meeting.bodyId] : []))];
                let bodies: RegistryRuntimeReadModel["registry"]["bodies"];
                if (!bodyIds.length) bodies = [];
                else if (acceptedBodies) bodies = bodyIds.flatMap(id => acceptedBodies.get(id) ?? []);
                else if (options.readMeetingRegistry) {
                  const divisions = [...new Set(snapshot.meetings.flatMap(meeting => meeting.ocdId ? [meeting.ocdId.split("#")[0]] : []))];
                  const versionId = registryPartitionVersion(reviewedRegistryVersion ?? meetingRegistryVersion!);
                  const read = await options.readMeetingRegistry(divisions, bodyIds, versionId);
                  if (read.kind !== "PROMOTED" || !read.value || read.metadata.versionId !== versionId) throw new Error(`Meeting territories read ${read.kind} at a different registry version`);
                  bodies = read.value.registry.bodies;
                } else bodies = await readMeetingBodiesForPublication(bodyIds);
                return { snapshot, bodies };
              } };
            }
          })() } };
        }
      } catch (error) {
        failed = true;
        detail = safeFailure(sanitizedErrorDiagnostic(error));
        process.stderr.write(`READER_EDGE_MEETINGS_CARRIED: ${detail}\n`);
        meetingRead = null;
        checks = undefined;
      }
      const meetingMetadata = meetingRead?.kind === "PROMOTED"
        ? { sourceThrough: meetingRead.metadata.sourceThrough,retrievedAt: meetingRead.metadata.retrievedAt,promotedThrough: meetingRead.metadata.promotedAt }
        : { sourceThrough: servedMeetingManifest?.sourceThrough ?? null,retrievedAt: prepared?.status === "CURRENT" ? prepared.checkedAt : servedMeetingManifest?.retrievedAt ?? null,
          promotedThrough: servedMeetingManifest?.promotedThrough ?? null };
      const publicationFingerprint = !failed && selected === null ? options.publicationFingerprint : undefined;
      const meetingOptions = { store: meetingArtifactStore,now: observedAt,meetingRegistryVersion,publicationFingerprint,...(checks ? { checks } : {}) };
      const snapshot = meetingRead?.kind === "PROMOTED" ? meetingRead.value : null;
      const edges = state === "US" ? [await publishReaderEdgeArtifacts(null,
        { sourceThrough: servedManifest?.sourceThrough ?? null,retrievedAt: servedManifest?.retrievedAt ?? null,promotedThrough: servedManifest?.promotedThrough ?? null },
        { store: artifactStore,now: observedAt,extras,authority,registrations,stateLegislators,publicationFingerprint }),
        ...(snapshot || checks || publicationFingerprint ? [await publishReaderEdgeArtifacts(snapshot,meetingMetadata,meetingOptions)] : [])]
        : [await publishReaderEdgeArtifacts(snapshot,meetingMetadata,{ ...meetingOptions,extras,authority,registrations,stateLegislators })];
      for (const edge of edges) {
        status = edge.status;
        if ("sequence" in edge) sequence = edge.sequence;
        if (edge.status === "FAILED") throw new Error(edge.error);
        if (edge.status === "RACED") throw new Error("A concurrent reader publication moved the manifest; retry remains owed.");
        if (edge.status === "NOT_COMPOSABLE") throw new Error("Reader pages could not be assembled. " + edge.detail);
      }
      if (edges.some(edge => edge.status === "PUBLISHED")) status = "PUBLISHED";
      const purge = status === "PUBLISHED" && artifactStore.kind === "netlify-blobs" ? await purgeReaderCacheTags([READER_MANIFEST_CACHE_TAG]) : null;
      if (purge) console.log(JSON.stringify({ readerEdgePurge: purge.purged,store: destination,sequence }));

    }
  } catch (error) {
    failed = true;
    detail = safeFailure(sanitizedErrorDiagnostic(error));
    process.stderr.write(`READER_EDGE_PUBLISH_FAILED: ${detail}\n`);
  }
  const outcome: ReaderEdgePublicationOutcome = { ok: !failed, readerEdge: failed && status !== "SKIPPED_NO_STORE" ? "FAILED" : status,
    store: destination, sequence, ...(!failed && readMeetingChunks === meetingChunks && supersededMeetingFields !== undefined ? { supersededMeetingFields } : {}), detail: failed ? detail ?? "Reader pages could not be fully updated. The earlier serving copies remain available." : null };
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
