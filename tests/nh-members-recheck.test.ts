import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { acquireNhMembersSource, parseMembers } from "../scripts/nh-gencourt-members.mts";
import { nhMembersCandidate, type NhMemberReadModel } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { readNhMembers } from "../lib/civic-data/state-members.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readOfficialsResults } from "../lib/control-plane/admin-view/officials-results.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordDoorOutcome } from "../lib/doors/outcome.ts";
import { readOfficialStateLegislatorsProjection } from "../lib/state-rollcalls/legislators.ts";
import { NH_CURRENT_HOUSE_URL, NH_CURRENT_SENATE_URL } from "../lib/sources/nh-general-court/current-identities.ts";
import { decodeNhPublisherBytes, NH_MEMBERS_URL, type NhOfficialDocument } from "../lib/sources/nh-general-court/official-data.ts";

const fixtureBytes = new Map([
  [NH_MEMBERS_URL, readFileSync(new URL("./fixtures/or-01/nh-members.txt", import.meta.url))],
  [NH_CURRENT_HOUSE_URL, readFileSync(new URL("./fixtures/or-01/nh-current-house.html", import.meta.url))],
  [NH_CURRENT_SENATE_URL, readFileSync(new URL("./fixtures/or-01/nh-current-senate.html", import.meta.url))],
]);
const FIRST_CAPTURE = "2026-10-13T04:00:00.000Z";
const SECOND_CAPTURE = "2026-10-13T04:01:00.000Z";
const timeAfter = (at: string, milliseconds: number) => new Date(Date.parse(at) + milliseconds).toISOString();

function fixtureRead(at: string, missing?: string) {
  return async (url: string): Promise<NhOfficialDocument> => {
    if (url === missing) throw new Error(`Official chamber source unavailable: ${url}`);
    const bytes = fixtureBytes.get(url);
    assert.ok(bytes, `No committed official source fixture for ${url}`);
    const body = url === NH_MEMBERS_URL ? decodeNhPublisherBytes(bytes) : bytes.toString("utf8");
    return { requestedUrl: url, finalUrl: url, httpStatus: 200, body, retrievedAt: at,
      sourceCheck: { requestedUrl: url, finalUrl: url, httpStatus: 200,
        rawHash: createHash("sha256").update(bytes).digest("hex"),
        checkedAt: timeAfter(at, url === NH_CURRENT_SENATE_URL ? 2 : 1) } };
  };
}

function candidateFromAcquisition(acquired: Awaited<ReturnType<typeof acquireNhMembersSource>>, prior?: NhMemberReadModel, priorRetrievedAt?: string) {
  return nhMembersCandidate({
    currentRosterComplete: acquired.currentRosterComplete,
    memberSourceUrls: acquired.memberSourceUrls,
    rawText: acquired.memberDocument.body,
    rawIdentityText: acquired.rawIdentityText,
    finalUrl: acquired.identityFinalUrl,
    identityFinalUrl: acquired.identityFinalUrl,
    httpStatus: acquired.identityHttpStatus,
    identityHttpStatus: acquired.identityHttpStatus,
    retrievedAt: acquired.documents.map(document => document.retrievedAt!).sort().at(-1)!,
    sourceCheck: acquired.sourceCheck,
    extraction: acquired.extraction,
    identityCrosswalk: acquired.crosswalk,
    prior,
    priorRetrievedAt,
  });
}

test("NH recheck promotes 406 exact current officials and serves them from the typed reader", async t => {
  const now = timeAfter(FIRST_CAPTURE, 1000);
  t.mock.method(Date, "now", () => Date.parse(now));
  const store = new MemoryRoutineDataStore();
  const acquired = await acquireNhMembersSource({ signal: new AbortController().signal, read: fixtureRead(FIRST_CAPTURE) });
  const bulk = parseMembers(decodeNhPublisherBytes(fixtureBytes.get(NH_MEMBERS_URL)!));
  const restored = acquired.crosswalk.matches.filter(match => bulk.members.some(member =>
    member.chamber === "H" && member.seatNo === match.member.seatNo && member.givenName === match.member.givenName &&
    member.familyName === match.member.familyName && member.electedStatus !== "INCUMBENT" && member.electedStatus !== "NEW"));
  assert.equal(restored.length, 20, "the current official House roster restores all 20 stale Former/unstated bulk rows");
  const candidate = candidateFromAcquisition(acquired);
  const outcome = await processRegisteredRoutineCandidate(store, "nh-members", candidate, now);
  assert.equal(outcome.candidate.state, "PROMOTED", JSON.stringify(outcome.candidate.receipt));
  assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify(outcome.readerReadback));
  const members = await readNhMembers({ store, now, bypassCache: true });
  assert.equal(members.kind, "PROMOTED");
  if (members.kind !== "PROMOTED") return;
  assert.equal(members.value.members.length, 406);
  assert.equal(members.value.identities.length, 406);
  assert.equal(members.value.currentMembershipComplete, true);
  assert.ok(members.value.identities.every(identity => /^\d+$/.test(identity.officialPersonId)));
  const projection = await readOfficialStateLegislatorsProjection("US-NH", { store, now, bypassCache: true });
  assert.equal(projection.kind, "PROMOTED");
  if (projection.kind !== "PROMOTED") return;
  assert.equal(projection.value.roster.officeholders.length, 406);
  assert.equal(projection.value.roster.divisions.length, 406);
  const ald = projection.value.roster.officeholders.find(member => member.id === "nh-general-court:806")!;
  assert.equal(ald.nativeIds?.["nh-general-court"]?.[0], "806");
  assert.match(ald.name, /^Glen .*Aldrich$/);
  assert.equal(ald.provenance.sourceUrl, NH_CURRENT_HOUSE_URL);
  assert.equal(projection.value.roster.officeholders.find(member => member.id === "nh-general-court:11458")?.provenance.sourceUrl, NH_CURRENT_SENATE_URL);
});

test("a complete NH roster retires a departed holder and Admin names the sourced changes", async t => {
  const now = timeAfter(FIRST_CAPTURE, 1000);
  t.mock.method(Date, "now", () => Date.parse(now));
  const store = new MemoryRoutineDataStore();
  const repos = createMemoryRepositories();
  const request = await submit({ type: "officials.checkNow", subject: "st:nh", input: { placeKey: "st:nh", note: null },
    caller: "OWNER_SESSION", actorRef: "fixture-session", stateVersion: null, idempotencyKey: "nh-named-changes" },
  { repos, now: () => timeAfter(FIRST_CAPTURE, -1000), currentStateVersion: null, codeSha: null });
  assert.equal(request.ok, true, request.receipt.says);
  assert.ok(request.receipt.openedWork.some(work => work.id === "feed:nh-members"));
  const acquired = await acquireNhMembersSource({ signal: new AbortController().signal, read: fixtureRead(FIRST_CAPTURE) });
  const bulk = parseMembers(decodeNhPublisherBytes(fixtureBytes.get(NH_MEMBERS_URL)!));
  const departed = bulk.members.find(member => member.givenName === "Charlie" && member.familyName === "St. Clair")!;
  assert.ok(departed, "the saved publisher bulk fixture contains the stale prior holder");
  const base = candidateFromAcquisition(acquired).readModel as NhMemberReadModel;
  const successor = base.identities.find(identity => identity.officialPersonId === "806")!;
  assert.ok(successor, "Glen Aldrich is present in the committed current official roster");
  // A controlled held copy omits one current publisher identity and retains the publisher's stale former holder.
  const prior: NhMemberReadModel = { ...base, members: [...base.members.filter(member => !(member.chamber === successor.chamber &&
    member.district === successor.district && member.seatNo === successor.seatNo)), departed],
  identities: [...base.identities.filter(identity => identity.officialPersonId !== "806"),
    { officeholderId: "nh-general-court:8956", officialPersonId: "8956", chamber: "H", district: departed.district, seatNo: departed.seatNo }] };
  const candidate = candidateFromAcquisition(acquired, prior, FIRST_CAPTURE);
  const outcome = await processRegisteredRoutineCandidate(store, "nh-members", candidate, now);
  assert.equal(outcome.candidate.state, "PROMOTED", JSON.stringify(outcome.candidate.receipt));
  const projection = await readOfficialStateLegislatorsProjection("US-NH", { store, now, bypassCache: true });
  assert.equal(projection.kind, "PROMOTED");
  if (projection.kind !== "PROMOTED") return;
  assert.equal(projection.value.roster.officeholders.length, 406);
  assert.ok(!projection.value.roster.officeholders.some(member => member.id === "nh-general-court:8956"));
  await recordDoorOutcome(repos.doors, "feed:nh-members", "SUCCESS", now, true);
  const results = await readOfficialsResults({ repos, store, placeKey: "st:nh" });
  assert.ok(!("says" in results));
  if ("says" in results) return;
  assert.equal(results.changes.length, 2);
  assert.ok(results.changes.some(change => change.kind === "departed" && change.name?.includes("Charlie") &&
    change.name.endsWith("St. Clair") && change.officeTitle === "State Representative" && change.sourceUrl === NH_CURRENT_HOUSE_URL));
  assert.ok(results.changes.some(change => change.kind === "appointed" && /^Glen .*Aldrich$/.test(change.name ?? "") &&
    change.officeTitle === "State Representative" && change.divisionId.startsWith("ocd-division/country:us/state:nh/sldl:") &&
    change.sourceUrl === NH_CURRENT_HOUSE_URL));
  assert.equal(results.feeds.find(feed => feed.id === "feed:nh-members")?.state, "changed");
});

for (const missing of [NH_CURRENT_HOUSE_URL, NH_CURRENT_SENATE_URL]) {
  test(`NH recheck keeps held officials when ${missing} is unavailable and publishes the other chamber`, async t => {
    let now = timeAfter(FIRST_CAPTURE, 1000);
    t.mock.method(Date, "now", () => Date.parse(now));
    const store = new MemoryRoutineDataStore();
    const first = await acquireNhMembersSource({ signal: new AbortController().signal, read: fixtureRead(FIRST_CAPTURE) });
    const seeded = await processRegisteredRoutineCandidate(store, "nh-members", candidateFromAcquisition(first), now);
    assert.equal(seeded.candidate.state, "PROMOTED", JSON.stringify(seeded.candidate.receipt));
    const prior = await readNhMembers({ store, now, bypassCache: true });
    assert.equal(prior.kind, "PROMOTED");
    if (prior.kind !== "PROMOTED") return;
    now = timeAfter(SECOND_CAPTURE, 1000);
    const acquired = await acquireNhMembersSource({ signal: new AbortController().signal, read: fixtureRead(SECOND_CAPTURE, missing) });
    assert.equal(acquired.currentRosterComplete, false);
    assert.equal(acquired.crosswalk.matches.length, missing === NH_CURRENT_HOUSE_URL ? 24 : 382);
    assert.ok(acquired.crosswalk.unresolved?.some(detail => detail.includes(missing)));
    const candidate = candidateFromAcquisition(acquired, prior.value, prior.metadata.retrievedAt!);
    const outcome = await processRegisteredRoutineCandidate(store, "nh-members", candidate, now);
    assert.equal(outcome.candidate.state, "PROMOTED", JSON.stringify(outcome.candidate.receipt));
    const held = await readNhMembers({ store, now, bypassCache: true });
    assert.equal(held.kind, "PROMOTED");
    if (held.kind !== "PROMOTED") return;
    assert.equal(held.value.members.length, 406, "an unavailable source cannot turn held chamber membership into zero");
    assert.equal(held.value.currentMembershipComplete, false);
    const retainedId = missing === NH_CURRENT_HOUSE_URL ? "nh-general-court:806" : "nh-general-court:11458";
    const refreshedId = missing === NH_CURRENT_HOUSE_URL ? "nh-general-court:11458" : "nh-general-court:806";
    assert.equal(held.value.memberSourceDates?.[retainedId], FIRST_CAPTURE);
    assert.equal(held.value.memberSourceDates?.[refreshedId], SECOND_CAPTURE);
    const projection = await readOfficialStateLegislatorsProjection("US-NH", { store, now, bypassCache: true });
    assert.equal(projection.kind, "PROMOTED");
    if (projection.kind !== "PROMOTED") return;
    assert.equal(projection.value.roster.officeholders.length, 406);
  });
}
