import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { confirmReceipt } from "../lib/control-plane/gateway/confirmation.ts";
import { readOfficialsResults } from "../lib/control-plane/admin-view/officials-results.ts";
import { feedDoorDrafts, seedFeedDoors } from "../lib/doors/seed-feeds.ts";
import { listDoors, upsertDerivedDoor } from "../lib/doors/registry.ts";
import { recordDoorOutcome } from "../lib/doors/outcome.ts";
import { readNowDueRequests, settleReadNow } from "../lib/doors/mission-refresh.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue } from "../lib/civic-data/runner.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { routineDueRequestFor, routineDueRequestState } from "../lib/civic-data/routine-due-request.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishOfficialRoster } from "../lib/civic-data/official-roster-publication.ts";
import { publishRoutineReaderEdgeOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import type { StatePeopleAcquisition } from "../lib/civic-data/state-people-publication.ts";
import { readFederalPeopleProjection } from "../lib/officials/federal-people-read.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import { officialRosterDisagreements, type RosterDisagreement } from "../lib/officials/roster-reconciliation.ts";
import { mergeStatePeople } from "../lib/state-rollcalls/legislators.ts";
import type { Officeholder, OfficeholderSet } from "../lib/officials/types.ts";
import { parseOfficialRoster } from "../lib/sources/official-rosters/index.ts";
import { OFFICIAL_FEDERAL_TARGETS } from "../lib/sources/official-rosters/targets.ts";
import { HOUSE_ROSTER_URL, SENATE_ROSTER_URL, SENATE_APPOINTMENTS_URL } from "../lib/sources/official-rosters/federal.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { ensureReaderAuthorityEdge } from "../lib/meetings/edge-serving.ts";

const OLD = "2026-10-13T04:55:00.000Z", NOW = "2026-10-13T05:00:00.000Z", PASS = "2026-10-13T05:01:00.000Z";
const FL = "ocd-division/country:us/state:fl", FL20 = `${FL}/cd:20`;
const fixture = (name: string) => readFileSync(new URL(`./fixtures/official-rosters/${name}`, import.meta.url), "utf8");
const docs = (kind: "house" | "senate"): readonly StatePeopleAcquisition[] => (kind === "house"
  ? [{ url: HOUSE_ROSTER_URL, file: "house-current.xml" }]
  : [{ url: SENATE_ROSTER_URL, file: "senate-current.xml" }, { url: SENATE_APPOINTMENTS_URL, file: "senate-appointed.html" }])
  .map(row => ({ requestedUrl: row.url, finalUrl: row.url, httpStatus: 200, body: fixture(row.file), retrievedAt: PASS }));
const targetFor = (kind: "house" | "senate") => OFFICIAL_FEDERAL_TARGETS.find(target => target.kind === kind)!;
const rosterFor = (kind: "house" | "senate") => parseOfficialRoster(targetFor(kind), docs(kind).map(row => ({ url: row.requestedUrl, body: row.body, retrievedAt: row.retrievedAt })), PASS);

for (const firstUse of [false, true]) test(firstUse
  ? "a first Admin check upgrades legacy null-division feeds and publishes real official changes before any general door derivation"
  : "an Admin officials request reaches the next runner pass, genuine promoters, reader artifacts and sourced Admin results", async t => {
  t.mock.method(Date, "now", () => Date.parse(PASS));
  const repos = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  if (firstUse) {
    for (const id of ["congress-bulk-roster", "openstates-people-fl", "openstates-people-az"]) {
      const draft = feedDoorDrafts().find(draft => draft.doorId === `feed:${id}`)!;
      await upsertDerivedDoor(repos.doors, { ...draft, ocdId: null, notes: "Saved before the coverage upgrade",
        checkEveryMinutes: 720, config: { ...draft.config, ownerSetting: "keep" } }, OLD, OLD);
    }
    assert.equal(await repos.doors.read("feed:official-house-roster"), null);
    assert.equal(await repos.doors.read("feed:official-senate-roster"), null);
  } else {
    const seeded = await seedFeedDoors({ repo: repos.doors, deriveInputAt: OLD, at: OLD });
    assert.deepEqual(seeded.refused, []);
  }
  const sourceIds = ["official-house-roster", "official-senate-roster", "congress-bulk-roster", "openstates-people-fl"];
  for (const id of sourceIds) if (await repos.doors.read(`feed:${id}`)) await recordDoorOutcome(repos.doors, `feed:${id}`, "SUCCESS", OLD);
  const mirrorBefore = await repos.doors.mustRead("feed:openstates-people-fl");
  const otherStateBefore = await repos.doors.mustRead("feed:openstates-people-az");
  const action = await submit({ type: "officials.checkNow", subject: "st:fl", input: { placeKey: "st:fl", note: null },
    caller: "OWNER_SESSION", actorRef: "fixture-session", stateVersion: null, idempotencyKey: "official-workflow-fl-01" },
  { repos, now: () => NOW, currentStateVersion: null, codeSha: null });
  assert.equal(action.ok, true, action.receipt.says);
  assert.equal(action.receipt.outcome, "QUEUED");
  if (firstUse) {
    const mirrorAfter = await repos.doors.mustRead("feed:openstates-people-fl");
    assert.deepEqual(mirrorAfter.value, { ...mirrorBefore.value, ocdId: FL, readNow: true, updatedAt: NOW });
    assert.deepEqual(await repos.doors.mustRead("feed:openstates-people-az"), otherStateBefore);
    assert.ok(action.receipt.openedWork.some(work => work.id === "feed:official-house-roster"));
    assert.ok(action.receipt.openedWork.some(work => work.id === "feed:official-senate-roster"));
  }
  const doors = (await listDoors(repos.doors)).doors;
  const knownTasks = [...ROUTINE_SOURCE_TASKS, ...AUTOMATIC_REFRESH_TASKS];
  const requests = readNowDueRequests(doors, new Set(knownTasks.map(task => task.id)), PASS);
  for (const id of sourceIds) {
    const task = knownTasks.find(task => task.id === id)!;
    assert.ok(task, `the standing runner knows ${id}`);
    const clock = { lastAttemptedAt: OLD, lastSucceededAt: OLD, lastSucceededObservedAt: OLD, lastSucceededParserVersion: task.parserVersion };
    assert.equal(routineTaskDue(task, clock, Date.parse(PASS)), false, "a check from five minutes ago would otherwise postpone the daily source read");
    const request = routineDueRequestFor(task, clock, Date.parse(PASS), requests);
    assert.equal(request?.contractId, id, "the Admin mark overrides that daily cadence on the very next pass");
    assert.equal(routineDueRequestState(request!, clock, Date.parse(PASS)), "DUE");
  }
  assert.equal((await confirmReceipt(repos, action.receipt, Date.parse(NOW))).state, "waiting");

  const published = [];
  for (const kind of ["house", "senate"] as const) {
    const target = targetFor(kind), roster = rosterFor(kind);
    const held = await publishOfficialRoster({ store, target, roster, acquisitions: docs(kind), releaseId: PASS, now: PASS });
    assert.ok(held.outcome.promoted, JSON.stringify(held.outcome.candidate.receipt));
    published.push(held.outcome.promoted!);
    await recordDoorOutcome(repos.doors, `feed:${target.id}`, "SUCCESS", PASS, true);
    const task = knownTasks.find(task => task.id === target.id)!;
    const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
    assert.equal(routineDueRequestFor(task, clock, Date.parse(PASS), requests), null, "the genuine durable publication attempt consumes this request");
  }
  // Source outages do not supply or suppress facts. The official response alone must serve the reader.
  for (const work of action.receipt.openedWork) if (work.kind === "people-feed" && !OFFICIAL_FEDERAL_TARGETS.some(target => `feed:${target.id}` === work.id))
    await recordDoorOutcome(repos.doors, work.id, "FAILURE", PASS);
  assert.equal(await settleReadNow(repos.doors, PASS), action.receipt.openedWork.filter(work => work.kind === "people-feed").length);

  const read = await readFederalPeopleProjection({ store, now: PASS, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const index = indexByDivision([read.value.roster]);
  const vacancy = index.get(FL20)?.find(holder => holder.vacancy);
  assert.equal(vacancy?.name, "Vacant since 2026-04-21");
  assert.equal(vacancy?.sourceUrl, HOUSE_ROSTER_URL);
  assert.ok(!index.get(FL20)?.some(holder => holder.id === "congress:C001127"));
  assert.ok(index.get(FL)?.some(holder => holder.id === "congress:M001244" && holder.name === "Ashley Moody" && holder.termStart === "2025-01-21"));

  const directory = mkdtempSync(join(tmpdir(), "officials-workflow-edge-"));
  try {
    const artifacts = new LocalFileArtifactStore(directory);
    const edge = await publishRoutineReaderEdgeOutcome(store, PASS,
      published.map(pointer => ({ recordClass: pointer.recordClass, scope: pointer.scope })), { artifactStore: artifacts });
    assert.equal(edge.readerEdge, "PUBLISHED", JSON.stringify(edge));
    const manifest = (await artifacts.readManifest())!.manifest;
    assert.equal(manifest.authorityArtifacts?.["federal-directory"]?.version, read.metadata.versionId);
    const serving = await ensureReaderAuthorityEdge(manifest, artifacts, ["federal-directory"]);
    assert.equal(serving.federalDirectory?.versionId, read.metadata.versionId);
    assert.equal(serving.federalDirectory?.value.roster.vacancies?.find(seat => seat.id === "US:rep:FL:20")?.since, "2026-04-21");
    assert.ok(!serving.federalDirectory?.value.roster.officeholders.some(person => person.id === "congress:C001127"));
    assert.ok(serving.federalDirectory?.value.roster.officeholders.some(person => person.id === "congress:M001244" && person.name === "Ashley Moody"));
    const narrowOnly = new Proxy(store, { get(target, key) {
      if (key === "readPromotion" || key === "readCandidate") return async () => {
        throw new Error("An unchanged publication must compare narrow pointers without reading source payloads");
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const current = await publishRoutineReaderEdgeOutcome(narrowOnly, PASS,
      published.map(pointer => ({ recordClass: pointer.recordClass, scope: pointer.scope })), { artifactStore: artifacts });
    assert.equal(current.readerEdge, "CURRENT", JSON.stringify(current));
    assert.deepEqual((await artifacts.readManifest())!.manifest, manifest);
  } finally { rmSync(directory, { recursive: true, force: true }); }

  const result = await readOfficialsResults({ repos, store, placeKey: "st:fl" });
  assert.ok(!("says" in result));
  if ("says" in result) return;
  assert.equal(result.status, "failed", "Admin reports the unavailable mirrors plainly while retaining official changes");
  assert.ok(result.changes.some(change => change.kind === "vacant" && change.divisionId === FL20 && change.since === "2026-04-21" && change.sourceUrl === HOUSE_ROSTER_URL));
  assert.ok(result.changes.some(change => change.name === "Ashley Moody" && change.sourceUrl === SENATE_ROSTER_URL));
  assert.ok(result.feeds.some(feed => feed.id === "feed:congress-bulk-roster" && feed.state === "failed"));
  assert.equal((await confirmReceipt(repos, action.receipt, Date.parse(PASS))).state, "applied");
});

/** A controlled stale mirror uses the exact predecessor identity and name recorded in the Clerk's response. */
function staleHouseMirror(house: OfficeholderSet): OfficeholderSet {
  const block = [...fixture("house-current.xml").matchAll(/<member>([\s\S]*?)<\/member>/g)].find(row => row[1].includes("<statedistrict>FL20</statedistrict>"))![1];
  const name = /<pred-official-name>([^<]+)<\/pred-official-name>/.exec(block)![1];
  const id = /<pred-memindex>([^<]+)<\/pred-memindex>/.exec(block)![1];
  const ended = house.endedMemberships!.find(row => row.personId === `congress:${id}`)!;
  const person: Officeholder = { id: ended.personId, personId: ended.personId, nativeIds: { bioguide: [id] }, name,
    officeTitle: "U.S. Representative", level: "FEDERAL", state: "FL", chamber: "house", termStart: "", termEnd: "", birthDate: null,
    partyLabel: null, websiteUrl: null, phone: null, email: null, photo: null, contactFormUrl: null, campaignUrl: null,
    memberships: [{ ...ended, current: true, termEnd: null, officeTitle: "U.S. Representative" }],
    provenance: { sourceUrl: HOUSE_ROSTER_URL, sourceOrg: "Controlled stale copy of the Clerk's predecessor record", collectedAt: OLD, verifiedAt: OLD } };
  return { scope: "us", generatedAt: OLD, officeholders: [person], divisions: [{ officeholderId: person.id, membershipId: ended.id, ocdId: FL20, bodyId: null }], unmatched: [] };
}

test("an official vacancy replaces a controlled stale mirror and persists its losing value for BL-01", async t => {
  t.mock.method(Date, "now", () => Date.parse(PASS));
  const house = rosterFor("house"), stale = staleHouseMirror(house);
  const disagreement = officialRosterDisagreements(stale, house).find(row => row.divisionId === FL20);
  assert.deepEqual(disagreement, { divisionId: FL20, officeTitle: "U.S. Representative", officialName: null,
    mirrorNames: ["Sheila Cherfilus-McCormick"], sourceUrl: HOUSE_ROSTER_URL });
  const merged = mergeStatePeople(stale, house);
  assert.ok(!merged.officeholders.some(person => person.id === "congress:C001127"));
  assert.equal(indexByDivision([merged]).get(FL20)?.find(holder => holder.vacancy)?.name, "Vacant since 2026-04-21");
  const store = new MemoryRoutineDataStore();
  const published = await publishOfficialRoster({ store, target: targetFor("house"), roster: house, mirror: stale,
    acquisitions: docs("house"), releaseId: PASS, now: PASS });
  assert.ok(published.outcome.promoted, JSON.stringify(published.outcome.candidate.receipt));
  const candidate = await store.readCandidate(published.outcome.promoted!.versionId);
  const disagreements = (candidate!.candidate.normalizedPayload as { disagreements: readonly RosterDisagreement[] }).disagreements;
  assert.deepEqual(disagreements.find(row => row.divisionId === FL20), disagreement);
});

test("a holder name or seat changed outside the saved official response cannot move the accepted pointer", async t => {
  t.mock.method(Date, "now", () => Date.parse(PASS));
  const store = new MemoryRoutineDataStore(), target = targetFor("house"), roster = rosterFor("house");
  const original = await publishOfficialRoster({ store, target, roster, acquisitions: docs("house"), releaseId: PASS, now: PASS });
  assert.ok(original.outcome.promoted, JSON.stringify(original.outcome.candidate.receipt));
  for (const altered of ["name", "seat", "membership-seat"] as const) {
    const wrong = structuredClone(roster);
    if (altered === "name") wrong.officeholders[0].name = "A name absent from the official source";
    else if (altered === "seat") wrong.divisions[0].ocdId = FL20;
    else wrong.officeholders[0].memberships = wrong.officeholders[0].memberships!.map((membership, index) => index === 0 ? { ...membership, officeId: "US:rep:FL:20" } : membership);
    const attempt = await publishOfficialRoster({ store, target, roster: wrong, acquisitions: docs("house"), releaseId: `${PASS}:${altered}`, now: PASS });
    assert.ok(attempt.outcome.promoted === null, `the saved source cannot validate an altered ${altered}`);
    assert.equal(attempt.candidate.dependentChecks?.find(check => check.consumer === "saved official roster values")?.passed, false);
    assert.equal((await store.readPromotion("STATE_LEGISLATOR", target.scope))?.versionId, original.outcome.promoted!.versionId);
  }
});
