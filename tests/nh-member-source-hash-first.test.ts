import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseMembers, refreshNhMembers } from "../scripts/nh-gencourt-members.mts";
import { nhMembersCandidate, type NhMemberReadModel } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { readNhMembers } from "../lib/civic-data/state-members.ts";
import { decodeNhPublisherBytes, joinNhCurrentMemberIdentities, NH_MEMBERS_URL, NH_LEGISLATORS_URL, NH_ROLL_HISTORY_URL,
  NH_PUBLISHER_REQUEST_DELAY_MS, parseNhLegislators, parseNhRollCallHistory } from "../lib/sources/nh-general-court/official-data.ts";
import type { KnownRelease, KnownReleaseOptions } from "../lib/sources/known-release.ts";

const AT = "2026-09-09T12:00:00.000Z", LATER = "2026-09-09T13:00:00.000Z";
const memberHeader = ["LastName", "FirstName", "MiddleName", "LegislativeBody", "seatno", "County", "District", "electedStatus", "party", "PersonTitle", "Phone", "WorkEmail", "city"].join("\t");
const members = [memberHeader,
  ["Current", "One", "", "H", "301", "Merrimack", "1", " Incumbent", "R", "Representative", "6035550101", "one@gc.nh.gov", "Concord"].join("\t"),
  ["St. Clair", "Charlie", "G.", "H", "4092", "Belknap", "5", " Incumbent", "D", "Representative", "6035550202", "charlie.stclair@gc.nh.gov", "Laconia"].join("\t"),
].join("\r\n");
const identities = [
  ["1", "Current", "One", "", "H", "301", "7", "1", "R", "", "", "Concord", "NH", "03301", "one@gc.nh.gov"].join("|"),
  // The existing reviewed publisher exception requires the exact history pair below.
  ["8956", "publisher-exception-8956", "Unmatched", "", "H", "4092", "1", "5", "D", "", "", "Laconia", "NH", "03246", ""].join("|"),
].join("\r\n");
const history = "2026|H|1|408811|8956||Yea|";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function capture(run: () => Promise<void>) {
  const lines: string[] = [], log = console.log, error = console.error, exitCode = process.exitCode;
  try {
    console.log = (...values: unknown[]) => { lines.push(values.join(" ")); };
    console.error = (...values: unknown[]) => { lines.push(values.join(" ")); };
    await run();
  } finally { console.log = log; console.error = error; process.exitCode = exitCode; }
  const parsed = parseRoutineRunnerReceipt(lines.join("\n")); assert.ok(parsed.ok, JSON.stringify(parsed)); return parsed.receipt;
}

async function fixture() {
  const store = new MemoryRoutineDataStore(), documents = new Map<string, Uint8Array>([
    [NH_MEMBERS_URL, new TextEncoder().encode(members)], [NH_LEGISLATORS_URL, new TextEncoder().encode(identities)],
    [NH_ROLL_HISTORY_URL, new TextEncoder().encode(history)],
  ]);
  const extraction = parseMembers(members), identityCrosswalk = joinNhCurrentMemberIdentities(extraction,
    parseNhLegislators(identities), identities, parseNhRollCallHistory(history), history);
  assert.equal(identityCrosswalk.reviewedExceptionMatches, 1); assert.equal(identityCrosswalk.matches.length, 2);
  // An ordinary GOOD predecessor avoids substituting the repository bootstrap for these exact two source identities.
  const seed = nhMembersCandidate({ rawText: members, rawIdentityText: `${identities}\n${history}`, extraction, identityCrosswalk,
    finalUrl: NH_MEMBERS_URL, identityFinalUrl: NH_LEGISLATORS_URL, httpStatus: 200, identityHttpStatus: 200, retrievedAt: AT,
    sourceCheck: { requestedUrl: NH_MEMBERS_URL, finalUrl: NH_MEMBERS_URL, httpStatus: 200, rawHash: hash(documents.get(NH_MEMBERS_URL)!), checkedAt: AT } });
  const seeded = await processRegisteredRoutineCandidate(store, "nh-members", seed, AT);
  assert.ok(seeded.promoted, seeded.candidate.failureDetail ?? JSON.stringify(seeded.candidate.receipt));
  let at = AT;
  let missingHistory: "throw" | "outage" | null = null;
  const acquired: string[] = [], sleeps: number[] = [], originals = new Map<string, { hash: string; at: string }>();
  const acquire = async (options: KnownReleaseOptions): Promise<KnownRelease> => {
    acquired.push(options.url);
    if (missingHistory === "throw" && options.url === NH_ROLL_HISTORY_URL) throw Error("fixture history is unavailable");
    const bytes = documents.get(options.url); assert.ok(bytes, `unexpected publisher ${options.url}`);
    const digest = hash(bytes), original = originals.get(options.url), same = original?.hash === digest;
    if (!same) originals.set(options.url, { hash: digest, at });
    const release: KnownRelease = { sourceId: options.sourceId, releaseId: options.releaseId, bytes, sha256: digest,
      requestedUrl: options.url, finalUrl: options.url, httpStatus: 200, retrievedAt: same ? original!.at : at,
      sourceObservedAt: same ? original!.at : at, checkedAt: at, lastCheckStatus: same ? 304 : 200,
      etag: null, lastModified: null, contentType: "text/plain", reused: same };
    await options.validate?.(bytes, release);
    return missingHistory === "outage" && options.url === NH_ROLL_HISTORY_URL
      ? { ...release, checkedAt: original?.at ?? AT, lastCheckStatus: 200, outage: "Publisher unavailable; prior history bytes retained" } : release;
  };
  const run = () => capture(() => refreshNhMembers({ store, now: () => new Date(Date.parse(at) + 5_000).toISOString(), acquire,
    sleep: async ms => { sleeps.push(ms); } }));
  const first = await run(); assert.equal(first.decision, "GOOD");
  const model = (await store.readPromotion<NhMemberReadModel>("STATE_LEGISLATOR", "US-NH"))!.payload;
  acquired.length = 0; sleeps.length = 0;
  return { store, documents, run, first, model, acquired, sleeps, setNow: (value: string) => { at = value; },
    loseHistory: (mode: "throw" | "outage" = "throw") => { missingHistory = mode; } };
}

test("the dispatched three-document NH check confirms equal actual bytes without opening held people", async () => {
  const f = await fixture();
  for (const key of ["readPromotion", "readPromotions", "readCandidate", "readCandidates", "readCandidateProof", "readCandidatePath",
    "readCandidateField", "readPromotionPayloadFields", "readPublishedCandidateMetadata", "events"] as const)
    Object.assign(f.store, { [key]: async () => { throw Error(`same NH sources opened ${key}`); } });
  f.setNow(LATER); const again = await f.run();
  assert.equal(again.candidateId, f.first.candidateId); assert.ok(again.confirmedAt);
  assert.deepEqual(f.acquired, [NH_MEMBERS_URL, NH_LEGISLATORS_URL, NH_ROLL_HISTORY_URL]);
  assert.deepEqual(f.sleeps, [NH_PUBLISHER_REQUEST_DELAY_MS, NH_PUBLISHER_REQUEST_DELAY_MS]);
});

test("a change in exact NH transport bytes enters validation even when decoded identity text is identical", async () => {
  const f = await fixture(), old = f.documents.get(NH_LEGISLATORS_URL)!;
  const withBom = new Uint8Array(old.length + 3); withBom.set([0xef, 0xbb, 0xbf]); withBom.set(old, 3);
  assert.equal(decodeNhPublisherBytes(withBom), decodeNhPublisherBytes(old));
  f.documents.set(NH_LEGISLATORS_URL, withBom); f.setNow(LATER);
  let created = 0; const create = f.store.create.bind(f.store);
  f.store.create = async (record, event) => { created++; return create(record, event); };
  const next = await f.run();
  assert.equal(next.decision, "GOOD"); assert.equal(next.confirmedAt, undefined); assert.equal(created, 1);
  assert.notEqual(next.candidateId, f.first.candidateId);
  const after = (await f.store.readPromotion<NhMemberReadModel>("STATE_LEGISLATOR", "US-NH"))!.payload;
  assert.deepEqual(after.members, f.model.members);
  assert.equal(after.officialIdentityAuthority?.sourceVersion, f.model.officialIdentityAuthority?.sourceVersion);
});

test("identical NH documents cannot confirm the prior supported term after the term boundary", async t => {
  const f = await fixture();
  t.mock.method(Date, "now", () => Date.parse("2026-12-02T12:01:00.000Z"));
  f.setNow("2026-12-02T12:00:00.000Z");
  const refused = await f.run();
  assert.equal(refused.state, "TEMPORAL_INVALID"); assert.equal(refused.confirmedAt, undefined);
  assert.equal(refused.lastKnownGoodVersion, f.first.candidateId);
  assert.equal((await f.store.readSourceHead("STATE_LEGISLATOR", "US-NH"))?.versionId, f.first.candidateId);
});

test("missing optional NH history keeps unresolved identity fields held at their original source date", async () => {
  const f = await fixture(); f.loseHistory(); f.setNow(LATER);
  f.documents.set(NH_MEMBERS_URL, new TextEncoder().encode(members.replace("6035550101", "6035550111").replace("6035550202", "6035550222")));
  let confirmations = 0; const confirm = f.store.confirmUnchanged.bind(f.store);
  f.store.confirmUnchanged = async (input, at) => { confirmations++; return confirm(input, at); };
  const next = await f.run(); assert.equal(next.decision, "GOOD"); assert.equal(next.confirmedAt, undefined); assert.equal(confirmations, 0);
  const head = await f.store.readSourceHead("STATE_LEGISLATOR", "US-NH"); assert.equal(head?.acquisitionComplete, false);
  const read = await readNhMembers({ store: f.store, now: LATER }); assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.equal(read.value.members.length, f.model.members.length, "unresolved prior identities never disappear");
  assert.equal(read.value.members.find(row => row.familyName === "Current")?.phone, "6035550111", "an independently matched current fact still publishes");
  assert.equal(read.value.members.find(row => row.familyName === "St. Clair")?.phone, "6035550202", "the unresolved new field cannot overwrite the held source fact");
  assert.equal(read.value.memberSourceDates?.["nh-general-court:8956"], f.model.memberSourceDates?.["nh-general-court:8956"]);
  assert.equal(read.value.memberSourceDates?.["nh-general-court:1"], LATER);
});


test("an outage's retained NH history bytes cannot turn a failed source check into a complete confirmation", async () => {
  const f = await fixture(); f.loseHistory("outage"); f.setNow(LATER);
  const result = await f.run();
  assert.equal(result.confirmedAt, undefined);
  assert.equal((await f.store.readSourceHead("STATE_LEGISLATOR", "US-NH"))?.acquisitionComplete, false);
  const projection = await f.store.readPromotion<NhMemberReadModel>("STATE_LEGISLATOR", "US-NH"); assert.ok(projection);
  assert.equal(projection.payload.members.find(row => row.familyName === "St. Clair")?.phone, "6035550202");
  assert.equal(projection.payload.memberSourceDates?.["nh-general-court:8956"], f.model.memberSourceDates?.["nh-general-court:8956"]);
});
