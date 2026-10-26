import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createSourceFile, isFunctionDeclaration, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { sha256 } from "../lib/civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { readDerivedFamilyMembers, derivedFamilyReadGroups } from "../lib/civic-data/derived-meeting-acquisition.ts";
import { buildDerivedFamily, derivedFamilyCandidate, DERIVED_FAMILY_SOURCE_ID, familyMemberReadIssue } from "../lib/civic-data/derived-meeting-family.ts";
import { DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE } from "../lib/civic-data/derived-door.ts";
import { DERIVED_WIRING_SOURCE_NAMES, derivedWiringKey, familyMembers, type DerivedWiringRecord } from "../lib/civic-data/derived-meeting-wiring.ts";
import { derivedMeetingFamilyId, requiredMeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { publishReadMeetingFacts } from "../lib/civic-data/meeting-fact-publication.ts";
import { retainingFetch, tracedResponses, retainMeetingCandidateEvidence } from "../lib/civic-data/retained-meeting-bytes.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { placePublishedMeetingPins } from "../lib/meetings/publish-pins.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { reconcileSuccessfulMeetingPartition, retrieveHeldAgendas, seedHeldAgendaDocuments, bindAgendaSourceObservations } from "../scripts/ingest.ts";
import { AgendaDocumentStore } from "../lib/meetings/agenda-documents.ts";
import { linkedMeetingSourceInputs } from "../lib/civic-data/meeting-linked-source.ts";
import { meetingVenueChoiceHash } from "../lib/civic-data/meeting-venue-inputs.ts";
import { factDb } from "./helpers/fact-db.ts";
import { withDerivedSourceContent, derivedSourceContentHash } from "../lib/civic-data/derived-source-hash.ts";
import { confirmMeetingFactsFromSources, meetingFactWorkRemains } from "../lib/civic-data/meeting-source-confirmation.ts";
import { sourceHashReceiptFields } from "../lib/civic-data/source-hash.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { meetingSourceInputHash, probeMeetingSource, withMeetingSourceProbe, meetingSourceBudgetAvailable } from "../lib/civic-data/meeting-source-probe.ts";
import { readSourceProbeDependencies } from "../lib/civic-data/source-probe.ts";
import { statesForRegistryDivisions, stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";

const program = readFileSync("scripts/ingest.ts", "utf8");
function controllerFunction(name: string): string {
  const tree = createSourceFile("ingest.ts", program, ScriptTarget.ESNext, true);
  const declaration = tree.statements.find(node => isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `missing controller function ${name}`);
  return declaration.getText(tree).replace(/^export /, "");
}

for (const disposition of ["promoted", "confirmed"] as const) test(`a ${disposition} family's fresh copies publish after acquisition while its snapshot window stays anchored`, async t => {
  const db = await factDb();
  t.after(() => db.pg.close());
  const anchor = "2026-10-04T08:30:00.000Z";
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(anchor) });
  const route = "https://testville.example.gov/council.ics", bodyId = "ocd-division/country:us/state:az/place:testville#governing";
  const feed = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:regular-1", "DTSTART;TZID=America/Phoenix:20261020T190000",
    "SUMMARY:Regular Council Meeting", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  const member: DerivedWiringRecord = {
    id: derivedWiringKey("ICAL", bodyId, route), status: "ACTIVE",
    row: { bodyId, ocdId: bodyId.split("#")[0]!, bodyName: "Council", kind: "ICAL", route,
      officialHost: "testville.example.gov", jurisdictionId: "az:city:testville", state: "US-AZ", publishingOrg: "City of Testville",
      timeZone: "America/Phoenix", config: { slug: "testville", bodyName: "Council", feedUrl: route, titleMatch: "Council" },
      crosswalkRowId: "crosswalk", reviewedAt: anchor, verifiedAt: anchor },
  };
  const snapshots: { generatedAt: string; meetings: readonly unknown[] }[] = [], errors: string[] = [];
  const acceptedCandidateId = `family:immutable-attempt:${disposition}`;
  let fetched = 0, hashPass = false;
  let lastCandidate: RoutineCandidate;
  // Run the production controller and fact-publication helper; isolate unrelated wiring, promotion and venue services.
  const run = runInNewContext(transpileModule(`${controllerFunction("publishPartitionFacts")}\n${controllerFunction("promoteDerivedMeetingFamily")}`, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS },
  }).outputText + "\npromoteDerivedMeetingFamily", {
    Date, console: { log: () => {}, warn: () => {}, error: (message: string) => errors.push(message) },
    readStateWiringRows: async () => { assert.equal(hashPass, false, "an equal source does not reread the wiring payload"); return { value: { records: [member] },
      input: { kind: "PROMOTED_VERSION", recordClass: DERIVED_WIRING_RECORD_CLASS, scope: DERIVED_WIRING_SCOPE,
        versionId: "wiring", readModelSha256: sha256(canonicalCivicDataJson({ records: [member] })), promotedAt: anchor } }; },
    factReader: () => null,
    familyMembers, readPreviousMeetingPartition: async () => { assert.equal(hashPass, false, "an equal source hash never reads the held family"); return null; },
    meetingFetchPass: () => meetingFetchPass({ fetchImpl: (async input => {
      assert.equal(String(input), route); fetched++;
      t.mock.timers.setTime(Date.now() + 30_000);
      return new Response(feed, { headers: { "content-type": "text/calendar" } });
    }) as typeof fetch }),
    retainingFetch, derivedFamilyReadGroups, readDerivedFamilyMembers, resolveAttribution: (meetings: unknown[]) => meetings,
    recordFamilyMemberOutcomes: async () => {}, moveConcludedMeetingsForPartition: async () => ({ moved: [] }),
    restoreRemovedHistoryForPartition: async () => null,
    buildDerivedFamily: (input: Parameters<typeof buildDerivedFamily>[0]) => {
      const built = buildDerivedFamily(input); snapshots.push(built.snapshot); return built;
    },
    DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE, sha256, canonicalCivicDataJson, DERIVED_WIRING_SOURCE_NAMES,
    reconcileSuccessfulMeetingPartition, retainMeetingCandidateEvidence,
    normalizeFamilyMeetingCitations: (meetings: unknown[]) => meetings,
    placePublishedMeetingPins: (input: Parameters<typeof placePublishedMeetingPins>[0]) => placePublishedMeetingPins({...input,offices:new Map()}),
    derivedFamilyCandidate, processRegisteredMeetingPartitionCandidate: async (_store: MemoryRoutineDataStore, _partition: string, candidate: RoutineCandidate) => { lastCandidate = candidate; return ({
      promoted: disposition === "promoted" ? { versionId: acceptedCandidateId } : null, confirmed: disposition === "confirmed" ? { at: new Date().toISOString() } : null,
      candidate: { candidate: { ...candidate, id: acceptedCandidateId }, receipt: { decision: "GOOD" }, failureDetail: null },
    }); },
    printMeetingPartitionReceipt: () => {}, tracedResponses, publishReadMeetingFacts, factClocks,
    withDerivedSourceContent, confirmMeetingFactsFromSources, meetingFactWorkRemains,
    DERIVED_FAMILY_SOURCE_ID, familyMemberReadIssue, sourceHashReceiptFields, ZERO_RELEASE_EVENTS,
    statesForRegistryDivisions, stateRegistryRuntimeScope, requiredManualProductionContract, readSourceProbeDependencies,
    meetingSourceInputHash, probeMeetingSource, withMeetingSourceProbe, meetingSourceBudgetAvailable, meetingVenueChoiceHash,
    AgendaDocumentStore, retrieveHeldAgendas, seedHeldAgendaDocuments, bindAgendaSourceObservations, linkedMeetingSourceInputs,
    meetingSourceSession: async (_partition: unknown, _hash: unknown, store: MemoryRoutineDataStore, _now: string, _vault: unknown,
      onSource?: (response: unknown) => Promise<void>) => {
      const responses = new Map();
      const fetch = async () => {
        fetched++; t.mock.timers.setTime(Date.now() + 30_000);
        responses.set(route, { source: "ical", requestedUrl: route, finalUrl: route, httpStatus: 200, rawHash: sha256(feed),
          byteCount: Buffer.byteLength(feed), bytes: new TextEncoder().encode(feed), retrievedAt: new Date().toISOString(), contentType: "text/calendar" });
        await onSource?.(responses.get(route));
        return new Response(feed, { headers: { "content-type": "text/calendar" } });
      };
      return { head: await store.readSourceHead("MEETING", partition.scope), responses, fetch, complete: true,
        probe: async () => { await fetch(); return true; }, clear: async () => {},
        run: (operation: () => Promise<unknown>) => operation(), collect: async (operation: () => Promise<unknown>) => ({ value: await operation(), responses: [] }),
        forgetGet: () => {}, defer: async () => {} };
    },
  });
  const store = new MemoryRoutineDataStore(), partition = requiredMeetingPartitionContract(derivedMeetingFamilyId("US-AZ"));
  const vault = new MemoryEvidenceStore();
  await run(store, partition, async () => {}, { db, vault });
  assert.equal(fetched, 1);
  assert.deepEqual(snapshots.map(snapshot => [snapshot.generatedAt, snapshot.meetings.length]), [[anchor, 1]], "acquisition does not move the snapshot's reconciliation window");
  assert.deepEqual(errors, []);
  const live = await db.query("SELECT f.field, f.checked_at, f.produced_by, s.fetched_at FROM fact f JOIN source_copy s ON s.id=f.source_copy_id WHERE f.status='live' ORDER BY f.field");
  assert.deepEqual(live.map(row => row.field), ["starts_at", "title"], "fresh acquired title and time pass the real fact checks");
  assert.ok(live.every(row => Date.parse(String(row.checked_at)) >= Date.parse(String(row.fetched_at))));
  assert.ok(live.every(row => row.produced_by === acceptedCandidateId), "facts credit the accepted immutable attempt, including an unchanged confirmation");
  assert.ok(live.every(row => Date.parse(String(row.fetched_at)) > Date.parse(anchor)), "the copies really arrived after the snapshot anchor");
  assert.deepEqual(await db.query("SELECT reason FROM blank"), []);
  hashPass = true;
  const rawHash = derivedSourceContentHash([{ kind: "PROMOTED_VERSION", recordClass: DERIVED_WIRING_RECORD_CLASS, scope: DERIVED_WIRING_SCOPE,
    versionId: "wiring", readModelSha256: sha256(canonicalCivicDataJson({ records: [member] })), promotedAt: anchor },
    { kind: "MEMBER_ACQUISITION", memberKey: member.id, requestedUrl: route, finalUrl: route, httpStatus: 200,
      rawHash: sha256(feed), retrievedAt: anchor, horizonDay: anchor.slice(0, 10) }]);
  Object.assign(store, { readSourceHead: async (recordClass: string, scope: string) => recordClass === "MEETING" && scope === partition.scope ? ({ sourceId: DERIVED_FAMILY_SOURCE_ID, recordClass: "MEETING", scope: partition.scope,
    versionId: acceptedCandidateId, lastKnownGoodVersionId: acceptedCandidateId, rawHash, rawHashBasis: "SOURCE_CONTENT_V1", normalizedHash: "a".repeat(64),
    parserVersion: "meetings-composite/2", promotedAt: anchor, candidateState: "PROMOTED", acquisitionSucceeded: true, imported: false }) : null,
    readCandidatePath: async (_id: string, path: string[]) => path.at(-1) === "bodyIds"
      ? (lastCandidate!.normalizedPayload as {sourceProbe:{bodyIds:string[]}}).sourceProbe.bodyIds
      : (lastCandidate!.normalizedPayload as {sourceProbe:unknown}).sourceProbe,
    confirmUnchanged: async () => ({ kind: "CONFIRMED", versionId: acceptedCandidateId, at: new Date().toISOString() }) });
  const confirmed = await run(store, partition, async () => { assert.fail("an equal source does not preload registry and venue records"); }, { db, vault });
  assert.ok(confirmed.head, "the next run returns the confirmed source header, with no fabricated candidate body");
  assert.equal(fetched, 2, "time-sensitive source acquisition still runs on the next scheduled pass");
  assert.equal(snapshots.length, 1, "the unchanged pass does not rebuild or re-read its held snapshot");
  assert.ok((await db.query("SELECT checked_at FROM fact WHERE status='live'")).every(row => Date.parse(String(row.checked_at)) === Date.now()),
    "unchanged source bytes still keep every existing fact current");
});
