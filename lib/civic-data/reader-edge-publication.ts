import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { factReader } from "../facts/db.ts";
import { planStateFacts, type StateFactsPlan } from "../facts/state-facts-publication.ts";
import { planMeetingBodies, type MeetingBodyPlan } from "../meetings/body-publication.ts";
import {
  publishReaderEdgeArtifacts,
  ensureReaderAuthorityEdge,
  purgeReaderCacheTags,
  READER_MANIFEST_CACHE_TAG,
  servedAuthorityVersion,
  readServedPromotedFamily,
  readServedFactBucket,
  readServedStateFactsIndex,
  writeFactBucket,
  writeFactRecord,
  type PublishAuthority,
  type PublishAuthorityCarried,
  type PublishAuthorityValue,
  type PublishRegistrations,
  type PublishStateAuthorities,
} from "../meetings/edge-serving.ts";
import { resolveReaderArtifactWriteStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { GLOBAL_AUTHORITY_FAMILIES, type GlobalAuthorityFamily } from "../meetings/edge-artifacts.ts";
import type { RoutineRecordClass, PromotedPointerIdentity } from "./types.ts";
import { readCuratedReaderProjection } from "./curated-reader-read-model.ts";
import { readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { statesForRegistryDivisions } from "./state-scopes.ts";
import { withReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readStateAuthorityProjection } from "./state-reader.ts";
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
import { readPromotedEdgeFamilies, promotedEdgePointers, selectedStateEdgePointers } from "./promoted-edge-publication.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { censusEdgePublication } from "../../scripts/lib/census-edge-publication.ts";
import { dispatchStateArtifacts, type StateArtifactChildren } from "./state-artifact-dispatch.ts";

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

interface ReaderEdgePublishOptions {
  readonly artifactStore?: ReaderArtifactStore | null;
  readonly stateArtifactChildren?: StateArtifactChildren;
}

export async function publishSupervisorReaderEdge(store: RoutineDataStore, observedAt: string,
  selected: readonly Pick<PromotedPointerIdentity, "recordClass" | "scope">[] | null = null,
  options: ReaderEdgePublishOptions = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ReaderEdgePublicationOutcome> {
  const currentStore = store;
  const states = new Set(selectedStateEdgePointers(selected ?? []).filter(unit => unit.family === "ballot-contests").map(unit => unit.state));
  selected = selected === null ? null : [...selected, ...selectedStateEdgePointers(null)
    .filter(unit => states.has(unit.state)).flatMap(unit => unit.pointers)];
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
    "federal-directory": [manual("congress-bulk-roster"), { recordClass: "FEDERAL_DIRECTORY" as const, scope: FEDERAL_PORTRAITS_SCOPE }],
    "campaign-sites": [manual("campaign-sites")],
    "state-legislators": STATE_PEOPLE_JURISDICTIONS.flatMap(jurisdiction => statePeopleSourcePointers(jurisdiction)),
    "meeting-outcomes": [PIMA_LEGISTAR_OUTCOMES_CONTRACT, MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, ...DOOR_OUTCOME_POINTERS],
  };
  const refreshes = (family: keyof typeof specialPointers) => specialPointers[family].some(pointer => owns(pointer.recordClass, pointer.scope));
  const preparesMeetings = selected === null || selected.some(pointer => pointer.recordClass === "MEETING");
  const statePointerFamilies = selectedStateEdgePointers(selected);
  const pointerFamilies = Object.fromEntries(Object.entries(promotedEdgePointers()).filter(([, pointers]) => pointers.some(pointer => owns(pointer.recordClass, pointer.scope)))) as ReturnType<typeof promotedEdgePointers>;
  if (selected === null || selected.some(pointer => ["STATE_ROLL_CALL", "STATE_LEGISLATOR_VOTES"].includes(pointer.recordClass))) {
    (pointerFamilies as Record<string, unknown>)["state-votes"] = [];
  }
  const statePointerKeys = new Set(statePointerFamilies.flatMap(row => row.pointers.map(pointer => `${pointer.recordClass}:${pointer.scope}`)));
  if (selected === null || selected.some(pointer => ["CURATED_READER_RECORD", "OPERATIONAL_REFERENCE", "STATE_LEGISLATOR"].includes(pointer.recordClass) &&
    !statePointerKeys.has(`${pointer.recordClass}:${pointer.scope}`))) {
    (pointerFamilies as Record<string, unknown>)["other-reader-data"] = [];
  }

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
      // A failed read cannot establish that no serving copy exists. Let the
      // outer publication error handler retain it and report a retryable error.
      const servedManifest = (await artifactStore.readManifest())?.manifest ?? null;
      const servedMeetings = preparesMeetings ? servedManifest : null;
      sequence = servedManifest?.sequence ?? null;
      if (env.WTP_READER_EDGE_LOCAL_OK !== "1" && artifactStore.kind === "local-file") {
        throw new Error("Reader pages would be saved to a folder on the runner. Readers are still seeing the older copy.");
      }
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
      const servedIfCurrent = async (family: GlobalAuthorityFamily, currentVersion: () => Promise<string | null>): Promise<string | null> => {
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
        family !== "state-legislators" && GLOBAL_AUTHORITY_FAMILIES.includes(family as GlobalAuthorityFamily)).map(([family, ref]) => [family, { versionId: ref.version, carried: true }]));
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
        console.error("READER_EDGE_AUTHORITY_SKIPPED: everyday-routing " + safeFailure(sanitizedErrorDiagnostic(error)));
      }
      if (refreshes("census-districts")) authority["census-districts"] = await censusEdgePublication({
        servedVersion: servedAuthorityVersion(servedManifest, "census-districts"),
        readVersion: pointerVersion(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE),
        readProjection: () => readCensusGeographyProjection({ store, now: observedAt }),
        onFailure: error => {
          failed = true;
          process.stderr.write(`READER_EDGE_AUTHORITY_REFRESH_FAILED: census-districts ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
        },
      });
      let stateFacts: StateFactsPlan | null = null;
      if (selected === null) try {
        const facts = factReader();
        if (facts) stateFacts = await planStateFacts(facts, servedManifest?.stateFacts, {
          readIndex: (state, ref) => readServedStateFactsIndex(state, ref, artifactStore),
          readBucket: (state, bucket, ref) => readServedFactBucket(state, bucket, ref, artifactStore),
          writeRecord: value => writeFactRecord(artifactStore, value),
          writeBucket: (state, bucket, versionId, index) => writeFactBucket(artifactStore, state, bucket, versionId, index, observedAt),
        });
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: state-facts ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
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
      if (refreshes("state-legislators")) for (const jurisdiction of STATE_PEOPLE_JURISDICTIONS) {
        if (!statePeopleSourcePointers(jurisdiction).some(pointer => owns(pointer.recordClass, pointer.scope))) continue;
        try {
          const sourcePointers = statePeopleSourcePointers(jurisdiction);
          const pointers = (await Promise.all([...new Set(sourcePointers.map(pointer=>pointer.recordClass))].map(recordClass=>
            store.readPromotionIdentities(recordClass,sourcePointers.filter(pointer=>pointer.recordClass === recordClass).map(pointer=>pointer.scope))))).flat();
          if (pointers.length === 0) continue;
          const versionId = statePeopleVersion(jurisdiction, pointers.map(pointer => ({ scope: pointer.scope, versionId: pointer.versionId })));
          if (servedManifest?.stateLegislators?.[jurisdiction]?.layout === "records" && servedManifest.stateLegislators[jurisdiction].version === versionId) continue;
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
      let stateAuthorities: PublishStateAuthorities = {};
      try {
        const promoted = await dispatchStateArtifacts({ store, currentStore, servedManifest, now: observedAt,
          selected: statePointerFamilies, env, children: options.stateArtifactChildren });
        stateAuthorities = promoted.stateAuthorities;
        if (promoted.skipped.length) failed = true;
        for (const line of promoted.skipped) process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: ${safeFailure(line)}\n`);
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: state pointers ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
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
            process.stderr.write(`READER_EDGE_REGISTRATIONS_SKIPPED: ${state} ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
          }
        }
        registrations = entries;
      } catch (error) {
        failed = true;
        process.stderr.write(`READER_EDGE_REGISTRATIONS_SKIPPED: ${safeFailure(sanitizedErrorDiagnostic(error))}\n`);
      }
      const registryRefs = { ...servedManifest?.stateAuthorities?.["registry-runtime"] };
      for (const [state, entry] of Object.entries(stateAuthorities["registry-runtime"] ?? {})) {
        if ("artifact" in entry) registryRefs[state] = entry.artifact;
      }
      let meetingPlan: MeetingBodyPlan | null = null;
      if (preparesMeetings) try {
        meetingPlan = await planMeetingBodies({
          store, artifacts: artifactStore, now: observedAt, served: servedManifest?.meetingStates,
          registryVersion: state => registryRefs[state]?.version ?? null,
          registry: async state => {
            if (registryRefs[state] === undefined) return null;
            const edge = await ensureReaderAuthorityEdge({ stateAuthorities: { "registry-runtime": { [state]: registryRefs[state] } } }, artifactStore, ["registry-runtime"]);
            const read = await withReaderAuthorityEdge({ ...edge, edgeOnly: true }, () => readStateAuthorityProjection<RegistryRuntimeReadModel>("registry-runtime", state));
            if (read.result.kind !== "PROMOTED") throw new Error(`Meeting territories for ${state} read ${read.result.kind}`);
            return { bodies: read.result.value.registry.bodies };
          },
        });
        if (meetingPlan.stats.failed.length > 0) {
          failed = true;
          detail = safeFailure(`Meetings of ${meetingPlan.stats.failed.length} bodies could not be composed: ${meetingPlan.stats.failed[0]!.error}`);
          process.stderr.write(`READER_EDGE_MEETING_BODIES_FAILED: ${JSON.stringify(meetingPlan.stats.failed.slice(0, 20))}\n`);
        }
      } catch (error) {
        failed = true;
        detail = safeFailure(sanitizedErrorDiagnostic(error));
        process.stderr.write(`READER_EDGE_MEETINGS_CARRIED: ${detail}\n`);
      }
      const edge = await publishReaderEdgeArtifacts({ store: artifactStore, now: observedAt, authority, stateAuthorities, registrations,
        ...(servedManifest?.stateLegislators !== undefined || refreshes("state-legislators") ? { stateLegislators } : {}),
        ...(meetingPlan ? { meetingStates: meetingPlan.entries } : {}),
        ...(stateFacts ? { stateFacts: stateFacts.entries } : {}) });
      if (meetingPlan && (edge.status === "PUBLISHED" || edge.status === "CURRENT")) {
        supersededMeetingFields = meetingPlan.stats.superseded;
        await meetingPlan.settle();
        console.log(JSON.stringify({ readerEdgeMeetingBodies: meetingPlan.stats }));
      }
      if (stateFacts && (edge.status === "PUBLISHED" || edge.status === "CURRENT")) {
        await stateFacts.settle();
        console.log(JSON.stringify({ readerEdgeStateFacts: { rebuilt: stateFacts.rebuilt, patched: stateFacts.patched, bodiesRead: stateFacts.bodiesRead } }));
      }
      status = edge.status;
      if ("sequence" in edge) sequence = edge.sequence;
      if (edge.status === "FAILED") throw new Error(edge.error);
      if (edge.status === "RACED") throw new Error("A concurrent reader publication moved the manifest; retry remains owed.");
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

export function readerEdgeSupervisorFailure(outcome: ReaderEdgePublicationOutcome) {
  return outcome.ok ? null : { taskId: "reader-edge-publication", code: "READER_EDGE_PUBLISH_FAILED",
    detail: outcome.detail ?? "Reader pages could not be updated." };
}
