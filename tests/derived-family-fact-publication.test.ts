import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createSourceFile, isFunctionDeclaration, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { sha256 } from "../lib/civic-data/candidate-builders.ts";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { readDerivedFamilyMembers, derivedFamilyReadGroups } from "../lib/civic-data/derived-meeting-acquisition.ts";
import { buildDerivedFamily, derivedFamilyCandidate } from "../lib/civic-data/derived-meeting-family.ts";
import { DERIVED_WIRING_RECORD_CLASS, DERIVED_WIRING_SCOPE } from "../lib/civic-data/derived-door.ts";
import { DERIVED_WIRING_SOURCE_NAMES, derivedWiringKey, familyMembers, type DerivedWiringRecord } from "../lib/civic-data/derived-meeting-wiring.ts";
import { derivedMeetingFamilyId, requiredMeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { publishReadMeetingFacts } from "../lib/civic-data/meeting-fact-publication.ts";
import { retainingFetch, tracedResponses } from "../lib/civic-data/retained-meeting-bytes.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { meetingFetchPass } from "../lib/meetings/shared-fetch.ts";
import { reconcileSuccessfulMeetingPartition } from "../scripts/ingest.ts";
import { factDb } from "./helpers/fact-db.ts";

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
  let fetched = 0;
  // Run the production controller and fact-publication helper; isolate unrelated wiring, promotion and venue services.
  const run = runInNewContext(transpileModule(`${controllerFunction("publishPartitionFacts")}\n${controllerFunction("promoteDerivedMeetingFamily")}`, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS },
  }).outputText + "\npromoteDerivedMeetingFamily", {
    Date, console: { log: () => {}, warn: () => {}, error: (message: string) => errors.push(message) },
    readDerivedMeetingWiring: async () => ({ kind: "PROMOTED", value: { records: [member] }, metadata: { versionId: "wiring", promotedAt: anchor } }),
    familyMembers, readPreviousMeetingPartition: async () => null,
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
    reconcileSuccessfulMeetingPartition, readCuratedReaderProjection: async () => ({ kind: "NOT_RECORDED" }),
    normalizeFamilyMeetingCitations: (meetings: unknown[]) => meetings, retainPreviouslyVerifiedVenuePoints: (meetings: unknown[]) => meetings,
    placeMeetingsFromVerifiedVenues: (meetings: unknown[]) => ({ meetings, placedCount: 0 }),
    placeMeetingsFromCensusVenues: async ({ snapshot }: { snapshot: { meetings: unknown[] } }) => ({ meetings: snapshot.meetings, held: [], venueReferenceEvidence: [], package: null }),
    derivedFamilyCandidate, processRegisteredMeetingPartitionCandidate: async () => ({
      promoted: disposition === "promoted" ? { versionId: "family" } : null, confirmed: disposition === "confirmed" ? { at: new Date().toISOString() } : null,
      candidate: { receipt: { decision: "GOOD" }, failureDetail: null },
    }),
    printMeetingPartitionReceipt: () => {}, publishVenuePins: async () => {}, tracedResponses, publishReadMeetingFacts, factClocks,
  });
  await run(new MemoryRoutineDataStore(), requiredMeetingPartitionContract(derivedMeetingFamilyId("US-AZ")), async () => {}, { db, vault: new MemoryEvidenceStore() });
  assert.equal(fetched, 1);
  assert.deepEqual(snapshots.map(snapshot => [snapshot.generatedAt, snapshot.meetings.length]), [[anchor, 1]], "acquisition does not move the snapshot's reconciliation window");
  assert.deepEqual(errors, []);
  const live = await db.query("SELECT f.field, f.checked_at, s.fetched_at FROM fact f JOIN source_copy s ON s.id=f.source_copy_id WHERE f.status='live' ORDER BY f.field");
  assert.deepEqual(live.map(row => row.field), ["starts_at", "title"], "fresh acquired title and time pass the real fact checks");
  assert.ok(live.every(row => Date.parse(String(row.checked_at)) >= Date.parse(String(row.fetched_at))));
  assert.ok(live.every(row => Date.parse(String(row.fetched_at)) > Date.parse(anchor)), "the copies really arrived after the snapshot anchor");
  assert.deepEqual(await db.query("SELECT reason FROM blank"), []);
});
