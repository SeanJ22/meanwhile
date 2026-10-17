import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import type { Query } from "../facts/publish.ts";
import { publishStateFacts, type StateFactsPointer, type StateFactsPublication } from "../facts/state-facts-publication.ts";
import { preparePublishedMeetingSnapshot, readPreparedMeetingsProjection, readComposedSourcePlaces } from "../meetings/prepared-snapshot.ts";
import {
  authorityPlaceOfScope,
  authorityPointerKey,
  publishReaderMeetings,
  ensureReaderAuthorityEdge,
  purgeReaderCacheTags,
  READER_MANIFEST_CACHE_TAG,
  readServedFactBucket,
  readServedPointer,
  stateFactsPointerKey,
  writeAuthorityPointer,
  writeFactBucket,
  writeFactRecord,
  type AuthorityPointerFamily,
  type PublishAuthorityValue,
  type ServedPointer,
} from "../meetings/edge-serving.ts";
import { resolveReaderArtifactWriteStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { sha256OfJson } from "../meetings/edge-artifacts.ts";
import type { RoutineRecordClass, PromotedPointerIdentity } from "./types.ts";
import { readCuratedReaderProjection } from "./curated-reader-read-model.ts";
import { readEverydayRoutingProjection } from "../routing/everyday-data-plane.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { REGISTRY_STATES, statesForRegistryDivisions } from "./state-scopes.ts";
import { withReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { readStateAuthorityProjection } from "./state-reader.ts";
import { readCensusGeographyProjection } from "../census-geography/reader.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../census-geography/publication.ts";
import { REGISTRATION_SCOPES } from "../registration/edge.ts";
import { REGISTRATION_TARGETS } from "../registration/publication.ts";
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
import { publishPromotedEdgeFamilies, promotedEdgePointers, selectedStateEdgePointers } from "./promoted-edge-publication.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";
import { buildCensusDistrictEdge, censusDistrictEdgeByState } from "../census-geography/district-edge.ts";
import { postalArea } from "../geo/postal.ts";
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

  // Every family's pointer is written as soon as it is ready; meetings compose last, so they never hold a pointer back.
  try {
    const artifactStore = options.artifactStore === undefined ? resolveReaderArtifactWriteStore() : options.artifactStore;
    destination = artifactStore?.kind === "local-file" ? "local folder" : artifactStore?.kind === "netlify-blobs" ? "Netlify Blobs" : "not configured";
    if (artifactStore === null) {
      status = "SKIPPED_NO_STORE";
      failed = true;
      detail = "Reader pages could not be updated because their publication store is not configured. Readers are still seeing the older copy.";
    } else {
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
      const published: string[] = [];
      const skip = (line: string) => { failed = true; process.stderr.write(`READER_EDGE_AUTHORITY_SKIPPED: ${safeFailure(line)}\n`); };

      try {
        const states = await dispatchStateArtifacts({ store, currentStore, artifactStore, now: observedAt,
          selected: statePointerFamilies, env, children: options.stateArtifactChildren });
        published.push(...states.published);
        states.skipped.forEach(skip);
      } catch (error) { skip(`state pointers ${sanitizedErrorDiagnostic(error)}`); }

      const pointerVersion = (recordClass: RoutineRecordClass, scope: string) => async () =>
        (await store.readPromotionIdentity(recordClass, scope))?.versionId ?? null;
      const manualPointer = (contractId: string) => {
        const contract = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(({ id }) => id === contractId);
        return contract ? pointerVersion(contract.recordClass, contract.scope) : async () => null;
      };
      /** One family to its own pointer: skipped when the pointer already names the current version, written at once when it moved. */
      const family = async (name: AuthorityPointerFamily, currentVersion: () => Promise<string | null>,
        read: (served: ServedPointer | null) => Promise<PublishAuthorityValue | null>, place?: string) => {
        const label = place === undefined ? name : `${name}/${place}`;
        try {
          const served = await readServedPointer(artifactStore, authorityPointerKey(name, place));
          if (served?.ref.layout === "records" && served.ref.version === await currentVersion().catch(() => null)) return;
          const entry = await read(served);
          if (!entry) return;
          if (await writeAuthorityPointer(artifactStore, name, place, entry, served, observedAt)) published.push(label);
          else skip(`${label} READER_POINTER_RACED`);
        } catch (error) { skip(`${label} ${sanitizedErrorDiagnostic(error)}`); }
      };
      const routingContract = manual("everyday-routing");
      if (owns(routingContract.recordClass, routingContract.scope)) {
        const versionId = async () => (await store.readPromotionIdentity(routingContract.recordClass, routingContract.scope))?.versionId ?? "not-recorded";
        await family("everyday-routing", versionId, async () => {
          const routing = await readEverydayRoutingProjection({ store, now: observedAt, bypassCache: true });
          if (routing.kind !== "PROMOTED" && routing.kind !== "NOT_RECORDED") throw new Error("everyday routing read " + routing.kind);
          return { value: { projection: routing.kind === "PROMOTED" ? routing.value : null }, versionId: await versionId() };
        });
      }
      // Read only when the national Census promotion moved; each state's shard is written only when its own content changed.
      if (refreshes("census-districts")) try {
        const census = await readCensusGeographyProjection({ store, now: observedAt });
        if (census.kind === "PROMOTED" && census.metadata.versionId) {
          const shards = censusDistrictEdgeByState(buildCensusDistrictEdge(census.value, census.metadata.versionId), zip => postalArea(zip)?.state ?? "US");
          for (const [state, shard] of shards) await family("census-districts", async () => shard.versionId, async () => ({ value: shard, versionId: shard.versionId }), state);
        } else if (census.kind !== "NOT_RECORDED") skip(`census-districts read ${census.kind}`);
      } catch (error) { skip(`census-districts ${sanitizedErrorDiagnostic(error)}`); }
      // The served version names the directory and the portraits laid on it, exactly as the reader composes it.
      if (refreshes("federal-directory")) await family("federal-directory", async () => {
        const directory = await manualPointer("congress-bulk-roster")();
        return directory === null ? null : federalDirectoryVersion(directory, await pointerVersion("FEDERAL_DIRECTORY", FEDERAL_PORTRAITS_SCOPE)());
      }, async () => {
        const fd = await readFederalDirectoryProjection({ store, now: observedAt, bypassCache: true });
        if (fd.kind === "PROMOTED" && fd.metadata.versionId) return { value: fd.value, versionId: fd.metadata.versionId };
        if (fd.kind !== "NOT_RECORDED") throw new Error(`federal-directory read ${fd.kind}`);
        return null;
      });
      if (refreshes("campaign-sites")) await family("campaign-sites", manualPointer("campaign-sites"), async () => {
        const cs = await readCuratedReaderProjection("campaign-sites", { store, now: observedAt, bypassCache: true });
        if (cs.kind === "PROMOTED" && cs.metadata.versionId) return { value: cs.value, versionId: cs.metadata.versionId };
        if (cs.kind !== "NOT_RECORDED") throw new Error(`campaign-sites read ${cs.kind}`);
        return null;
      });
      // The doors were not read this pass, so the door list is unknown, not empty: each served state's artifact stands
      // rather than one that silently drops every door's outcomes. Each state's doors publish to that state's pointer.
      if (refreshes("meeting-outcomes") && outcomePartitionsAreCurrent()) {
        let doorsRead: Promise<void> | null = null;
        for (const [state, doors] of Map.groupBy(outcomePointers(), door => authorityPlaceOfScope(door.scope))) await family("meeting-outcomes", async () =>
          combinedOutcomeVersionId((await Promise.all(doors.map(async door => ({ contractId: door.contractId,
            versionId: await pointerVersion(door.recordClass, door.scope)() })))).filter((door): door is { contractId: string; versionId: string } => door.versionId !== null)),
        async () => {
          // Complete or left out: a failed read must not publish the rest alone as if it had nothing.
          await (doorsRead ??= readDoorOutcomeProjections({ store, now: observedAt, bypassCache: true }));
          const unreadable = doorOutcomesUnreadable().filter(contractId => doors.some(door => door.contractId === contractId));
          if (unreadable.length > 0) throw new Error(`door outcomes read failed for ${unreadable.join(", ")}`);
          return combineOutcomeProjections(doorOutcomeParts().filter(part => doors.includes(part.pointer))
            .map(part => ({ value: part.value, pointers: [{ contractId: part.pointer.contractId, tenant: part.pointer.slug, versionId: part.versionId }] })));
        }, state);
      }
      try {
        const promoted = await publishPromotedEdgeFamilies({ store, artifactStore, now: observedAt, families: pointerFamilies });
        published.push(...promoted.published);
        promoted.skipped.forEach(skip);
      } catch (error) { skip(`promoted pointers ${sanitizedErrorDiagnostic(error)}`); }
      if (selected === null || selected.some(pointer => pointer.recordClass === "REGISTRATION")) {
        const promoted = await store.readPromotionIdentities("REGISTRATION", REGISTRATION_SCOPES).catch(error => { skip(`registrations ${sanitizedErrorDiagnostic(error)}`); return null; });
        if (promoted) for (const { scope, state } of REGISTRATION_TARGETS) {
          const versionId = promoted.find(pointer => pointer.scope === scope)?.versionId ?? "none";
          await family("registrations", async () => versionId, async () => {
            if (versionId === "none") return { value: null, versionId };
            const read = await readRegistrationProjection(state.toLowerCase(), { store, now: observedAt, bypassCache: true });
            if (read.kind !== "PROMOTED" || read.metadata.versionId !== versionId) throw new Error(`registration ${state} read ${read.kind} at a different version`);
            return { value: read.value, versionId };
          }, state.toLowerCase());
        }
      }
      if (refreshes("state-legislators")) for (const jurisdiction of STATE_PEOPLE_JURISDICTIONS) {
        const sourcePointers = statePeopleSourcePointers(jurisdiction);
        if (!sourcePointers.some(pointer => owns(pointer.recordClass, pointer.scope))) continue;
        const versionId = async () => {
          const pointers = (await Promise.all([...new Set(sourcePointers.map(pointer => pointer.recordClass))].map(recordClass =>
            store.readPromotionIdentities(recordClass, sourcePointers.filter(pointer => pointer.recordClass === recordClass).map(pointer => pointer.scope))))).flat();
          return pointers.length ? statePeopleVersion(jurisdiction, pointers.map(pointer => ({ scope: pointer.scope, versionId: pointer.versionId }))) : "none";
        };
        await family("state-legislators", versionId, async () => {
          const expected = await versionId();
          if (expected === "none") return { value: null, versionId: expected };
          const read = await readStatePeopleProjection(jurisdiction, { store, now: observedAt, bypassCache: true });
          if (read.kind === "NOT_RECORDED") return { value: null, versionId: "none" };
          if (read.kind !== "PROMOTED" || !read.metadata.versionId) throw new Error(`state people ${jurisdiction} read ${read.kind}`);
          if (read.metadata.versionId !== expected) throw new Error(`state people ${jurisdiction} did not read every accepted source version`);
          return { value: read.value, versionId: expected };
        }, jurisdiction);
      }
      console.log(JSON.stringify({ readerEdgePointers: { published: published.length, sample: published.slice(0, 20) } }));
      status = published.length ? "PUBLISHED" : "CURRENT";

      if (preparesMeetings) {
        const servedMeetings = (await artifactStore.readManifest())?.manifest ?? null;
        sequence = servedMeetings?.sequence ?? null;
        const prepared = await preparePublishedMeetingSnapshot(store, observedAt);
        if (prepared?.status === "FAILED" || prepared?.status === "NOT_COMPOSABLE") {
          failed = true;
          detail = prepared.status === "FAILED" ? safeFailure(prepared.error) : "Reader meetings could not be assembled. " + safeFailure(prepared.detail);
          console.error("PREPARED_MEETING_SNAPSHOT_FAILED: " + detail);
        }
        if (prepared?.status === "RACED") { failed = true; detail = "A newer meeting composition won publication; retry remains owed."; }
        const registryRefs = Object.fromEntries((await Promise.all(REGISTRY_STATES.map(async state =>
          [state, (await readServedPointer(artifactStore, authorityPointerKey("registry-runtime", state)))?.ref] as const))).filter(([, ref]) => ref));
        const meetingRegistryVersion = Object.keys(registryRefs).length
          ? sha256OfJson(Object.entries(registryRefs).map(([state, ref]) => [state, ref!.version]).sort(([a], [b]) => a.localeCompare(b))) : null;
        const sameComposition = prepared?.status === "CURRENT" && servedMeetings?.meetingLayout === "governing-area" &&
          servedMeetings.meetingRegistryVersion !== undefined && servedMeetings.meetingRegistryVersion === meetingRegistryVersion &&
          (servedMeetings.composition !== undefined ? servedMeetings.composition === prepared.composition : servedMeetings.generatedAt === prepared.generatedAt);
        let checks = prepared?.status === "CURRENT" || prepared?.status === "PUBLISHED" ? { composition: prepared.composition, freshChecks: prepared.freshChecks } : undefined;
        let meetingRead: Awaited<ReturnType<typeof readPreparedMeetingsProjection>> | null = null;
        let meetingBodies: RegistryRuntimeReadModel["registry"]["bodies"] | undefined;
        try {
          if (!sameComposition && (prepared.status === "CURRENT" || prepared.status === "PUBLISHED")) {
            meetingRead = await readPreparedMeetingsProjection({ store, expectedSequence: prepared.sequence });
            if (meetingRead.kind !== "PROMOTED") throw new Error("Prepared meeting copy read " + meetingRead.kind);
          }
          if (meetingRead?.kind === "PROMOTED") {
            supersededMeetingFields = meetingRead.value.meetings.reduce((count, meeting) => count + (meeting.publicationConflicts?.length ?? 0), 0);
            meetingBodies = [];
            const divisions = [...new Set(meetingRead.value.meetings.flatMap(meeting => meeting.ocdId ? [meeting.ocdId.split("#")[0]] : []))];
            const bodyIds = new Set(meetingRead.value.meetings.flatMap(meeting => meeting.bodyId ? [meeting.bodyId] : []));
            const edge = await ensureReaderAuthorityEdge(null, artifactStore, ["registry-runtime"]);
            for (const state of statesForRegistryDivisions([...divisions, ...bodyIds])) {
              const read = await withReaderAuthorityEdge({ ...edge!, edgeOnly: true }, () => readStateAuthorityProjection<RegistryRuntimeReadModel>("registry-runtime", state));
              if (read.result.kind !== "PROMOTED") throw new Error(`Meeting territories for ${state} read ${read.result.kind}`);
              meetingBodies.push(...read.result.value.registry.bodies.filter(body => bodyIds.has(body.id)));
            }
          }
        } catch (error) {
          failed = true;
          detail = safeFailure(sanitizedErrorDiagnostic(error));
          process.stderr.write(`READER_EDGE_MEETINGS_CARRIED: ${detail}\n`);
          // Keep the previous meeting bytes, territory version and observation dates together.
          meetingRead = null;
          meetingBodies = undefined;
          checks = undefined;
        }
        const edge = await publishReaderMeetings(meetingRead?.kind === "PROMOTED" ? meetingRead.value : null,
          meetingRead?.kind === "PROMOTED" ? { sourceThrough: meetingRead.metadata.sourceThrough, retrievedAt: meetingRead.metadata.retrievedAt, promotedThrough: meetingRead.metadata.promotedAt }
            : { sourceThrough: servedMeetings?.sourceThrough ?? null, retrievedAt: prepared.status === "CURRENT" ? prepared.checkedAt : servedMeetings?.retrievedAt ?? null, promotedThrough: servedMeetings?.promotedThrough ?? null },
          { store: artifactStore, now: observedAt, meetingBodies, meetingRegistryVersion,
            meetingPlaces: Object.fromEntries(await readComposedSourcePlaces({ store }) ?? []), ...(checks ? { checks } : {}) });
        status = edge.status === "CURRENT" && published.length ? "PUBLISHED" : edge.status;
        if ("sequence" in edge) sequence = edge.sequence;
        if (edge.status === "FAILED") throw new Error(edge.error);
        if (edge.status === "RACED") throw new Error("A concurrent reader publication moved the manifest; retry remains owed.");
        if (edge.status === "NOT_COMPOSABLE") throw new Error("Reader pages could not be assembled. " + edge.detail);
        const purge = edge.status === "PUBLISHED" && artifactStore.kind === "netlify-blobs" ? await purgeReaderCacheTags([READER_MANIFEST_CACHE_TAG]) : null;
        if (purge) console.log(JSON.stringify({ readerEdgePurge: purge.purged, store: destination, sequence }));
      }
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

/** Each state's facts at its own pointer on the reader edge, apart from the manifest. */
export function publishReaderStateFacts(query: Query, artifactStore: ReaderArtifactStore, observedAt: string): Promise<StateFactsPublication> {
  return publishStateFacts(query, {
    readPointer: state => artifactStore.readJsonPointer<StateFactsPointer>(stateFactsPointerKey(state)),
    writePointer: async (state, value, etag) => (await artifactStore.writeJsonPointer(stateFactsPointerKey(state), value, etag)).modified,
    readBucket: (state, bucket, ref) => readServedFactBucket(state, bucket, ref, artifactStore),
    writeRecord: value => writeFactRecord(artifactStore, value),
    writeBucket: (state, bucket, versionId, index) => writeFactBucket(artifactStore, state, bucket, versionId, index, observedAt),
  });
}

export function readerEdgeSupervisorFailure(outcome: ReaderEdgePublicationOutcome) {
  return outcome.ok ? null : { taskId: "reader-edge-publication", code: "READER_EDGE_PUBLISH_FAILED",
    detail: outcome.detail ?? "Reader pages could not be updated." };
}
