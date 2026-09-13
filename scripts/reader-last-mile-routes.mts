import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { readerProofSources } from "./lib/reader-proof-sources.ts";
import { resolveZip } from "../lib/geo/zcta.ts";
import { divisionIdsForZipArea } from "../lib/ballot/zip-divisions.ts";
import { divisionsAt } from "../lib/registry/server.ts";
import { GET as divisionRepresentationRoute } from "../app/api/representation/[...division]/route.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { getVotesSnapshot, readFederalRollCallsProjection } from "../lib/votes/snapshot.ts";
import { readAvailableOfficialStateVotes } from "../lib/sources/legiscan/snapshot.ts";
import { getOutcomeSnapshot } from "../lib/outcomes/store.ts";
import { meetingReaderRecords } from "../lib/meetings/reader-records.ts";
import { campaignMoneyApiAnswer } from "../lib/funding/campaign-money.ts";
import { stateMoneyProofInventory } from "../lib/funding/state-snapshot.ts";
import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";
import {
  prlProfileForSubject,
  readPrlProjection,
} from "../lib/sources/prl/snapshot.ts";
import type { PrlSnapshot } from "../lib/sources/prl/types.ts";
import { unifiedCorpus } from "../lib/corpus/unified.ts";
import { positionsFor, searchTerms } from "../lib/corpus/positions.ts";
import { readerPositionsFor } from "../lib/corpus/reader-positions.ts";
import { getFundingSnapshot } from "../lib/funding/snapshot.ts";
import { executiveActionStore } from "../lib/officials/executive-actions.ts";
import { settleOfficialActionHoldingAnswer } from "../app/api/official-actions/[subject]/route.ts";
import { getFederalDirectoryReadModel } from "../lib/officials/federal-directory-read-model.ts";
import { directoryFor } from "../lib/officials/directory.ts";
import { keyVotesForMember } from "../lib/votes/key-votes-reader.ts";
import { prepareReaderProofRuntime } from "./lib/reader-proof-runtime.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
const outputPath = process.env.READER_PROOF_OUTPUT ?? "docs/evidence/reader-last-mile-routes.json";
const proofSourcesPath = process.env.READER_PROOF_SOURCES;
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/,
  "Local production proof only; production readback is a separate bounded walk.");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
const evidence: unknown[] = [];
await prepareReaderProofRuntime();
const [federalProjection, prlProjection] = await Promise.all([
  readFederalRollCallsProjection(),
  readPrlProjection(),
]);
if (federalProjection.kind !== "PROMOTED") throw new Error(federalProjection.detail);
if (prlProjection.kind !== "PROMOTED") throw new Error(prlProjection.detail);
const {
  registry,
  bodyRosters,
  rosterReaderDispositions,
  statewideExecutives,
  officialCandidacies: officialBridge,
} = getRegistryRuntimeReadModel();
const federalDirectory = getFederalDirectoryReadModel();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function get(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, { headers: { "x-wtp-synthetic-run": "reader-last-mile-routes" } });
  assert.equal(response.status, 200, `${path}: ${response.status} ${await response.clone().text()}`);
  return await response.json() as Record<string, unknown>;
}
function rows(value: unknown): Record<string, unknown>[] { assert.ok(Array.isArray(value)); return value as Record<string, unknown>[]; }
async function each<T>(values: T[], fn: (value: T) => Promise<unknown>) {
  for (let start = 0; start < values.length; start += 6) {
    evidence.push(...await Promise.all(values.slice(start, start + 6).map(fn)));
  }
}
const provedDivisions = new Set<string>();
async function representation(division: string, zip?: string) {
  // Resolve the division through its owning route, using this proof process's
  // admitted held projection. Compare the complete result with the HTTP boundary;
  // proof code must not grow a separate body/roster join.
  const expectedResponse = await divisionRepresentationRoute(new Request(`${base}/api/representation/${division}`), {
    params: Promise.resolve({ division: division.split("/") }),
  });
  assert.equal(expectedResponse.status, 200, `${division}: local held division route`);
  const expectedPayload = await expectedResponse.json();
  const expected = rows(expectedPayload.holders);
  const result = await get(`/api/representation/${division}`);
  const actual = rows(result.holders);
  assert.equal(result.ocdId, division);
  assert.deepEqual(result, expectedPayload, `${division}: complete held division facts, holders and roster gaps`);
  provedDivisions.add(division);
  return { zip, surface: "representation", division, expectedIds: expected.map((row) => row.id), returnedIds: actual.map((row) => row.id), returnedCount: actual.length, payload: result, payloadSha256: hash(result) };
}
for (const zip of ["85701", "85641", "07866", "03255"]) {
  const point = resolveZip(zip); assert.ok(point.ok);
  const { lat, lng } = point.centroid;
  const divisions = await divisionIdsForZipArea(zip, (await divisionsAt(lat, lng)).map((division) => division.ocdId));
  const meetings = await get(`/api/meetings?${new URLSearchParams({ zip, lat: String(lat), lng: String(lng) })}`);
  const meetingRows = rows(meetings.meetings);
  assert.equal(new Set(meetingRows.map((row) => row.id)).size, meetingRows.length, "duplicate returned meeting IDs");
  assert.ok(meetings.coverage, `${zip}: registry loader unavailable`);
  evidence.push({ zip, surface: "meetings/map", returnedCount: meetingRows.length, identities: meetingRows.map((row) => ({ id: row.id, bodyId: row.bodyId })), payloadSha256: hash(meetings) });
  for (const division of divisions) {
    evidence.push(await representation(division, zip));
  }
}
const rosterDivisions = federalDirectory.roster.divisions.map((division) => division.ocdId);
const allDivisions = [...new Set([
  ...registry.divisions.map((division) => division.ocdId),
  ...rosterDivisions,
  ...statewideExecutives.map((executive) => executive.stateOcdId),
  ...bodyRosters.filter((roster) => /#(?:governing|board)$/.test(roster.bodyId)).map((roster) => roster.bodyId.split("#")[0]).filter((id) => id.startsWith("ocd-division/")),
])];
const remainingDivisions = allDivisions.filter((id) => !provedDivisions.has(id)).sort();
floored("representation division controls", "canonical registry divisions", remainingDivisions.length, remainingDivisions.length);
await each(remainingDivisions, (division) => representation(division));
const stateMoneyAuthority = stateMoneyProofInventory();
const moneyTargets = [...new Set([
  ...stateMoneyAuthority.targetKeys,
  ...officialBridge.rows.filter((row) => row.status === "RESOLVED").map((row) => row.holder.id),
  ...rosterReaderDispositions.filter((row) => row.state !== "READER_ELIGIBLE").map((row) => row.sourceId),
  ...getFundingSnapshot().candidates.flatMap((row) => row.targetKeys),
  ...getFundingSnapshot().absences.map((row) => row.targetKey),
])].sort();
await each(moneyTargets, async (target) => {
  const expected = campaignMoneyApiAnswer(target);
  const actual = await get(`/api/funding/${encodeURIComponent(target)}`);
  // The funding route wraps the canonical answer in the shared availability
  // envelope (dataState/dataMetadata/holdingStatus/unavailableAuthorities) — the
  // same contract tests/reader-last-mile-funding-route.test.ts asserts and the
  // /api/votes surface below already checks. Hold the source-linked answer to
  // exact equality after stripping that envelope, then check the envelope is
  // well-formed. dataMetadata carries per-import provenance (promotedAt/stale)
  // and is deliberately never pinned here.
  const { dataState, dataMetadata, holdingStatus, unavailableAuthorities, ...answer } = actual;
  assert.deepEqual(answer, JSON.parse(JSON.stringify(expected)), target);
  assert.ok(holdingStatus === "HELD" || holdingStatus === "PARTIAL", `${target}: funding holdingStatus ${holdingStatus}`);
  assert.ok(Array.isArray(unavailableAuthorities), `${target}: funding unavailableAuthorities`);
  assert.ok(["PROMOTED", "BOOTSTRAP", "PARTIAL"].includes(dataState as string), `${target}: funding dataState ${dataState}`);
  assert.ok(dataMetadata === null || typeof dataMetadata === "object", `${target}: funding dataMetadata`);
  return { surface: "funding/state-money", target, payload: actual, payloadSha256: hash(actual) };
});
const federal = getVotesSnapshot();
const stateAuthority = await readAvailableOfficialStateVotes({ bypassCache: true });
const stateSnapshots = stateAuthority.promoted.map(({ snapshot }) => snapshot);
const state = {
  rollCalls: stateSnapshots.flatMap((snapshot) => snapshot.rollCalls),
  positions: stateSnapshots.flatMap((snapshot) => snapshot.positions),
};
const memberDirectory = federalDirectory.directory;
const memberIds = [...new Set([...federal.positions.map((position) => position.officeholderId), ...state.positions.map((position) => position.officeholderId), ...Object.keys(memberDirectory.byMember).map((id) => `congress:${id}`)])].sort();
floored("vote member controls", "both canonical position snapshots", memberIds.length, memberIds.length);
for (const member of memberIds) {
  const positions = member.startsWith("congress:")
    ? federal.positions.filter((position) => position.officeholderId === member).map((position) => ({ id: position.voteId, position: position.position }))
    : state.positions.filter((position) => position.officeholderId === member).map((position) => ({ id: position.rollCallId, position: position.position }));
  const expected = new Map(positions.map((position) => [position.id, position.position]));
  const result = await get(`/api/votes?member=${encodeURIComponent(member)}`);
  const votes = rows(result.votes);
  assert.equal(result.member, member); assert.equal(result.holdingStatus, "HELD");
  assert.equal(result.count, votes.length); assert.equal(votes.length, expected.size, member);
  for (const vote of votes) assert.equal(vote.position, expected.get(String(vote.id)), `${member}/${vote.id}`);
  evidence.push({ surface: "votes", member, expectedCount: expected.size, statedCount: result.count, returnedCount: votes.length, canonicalIds: votes.map((vote) => vote.id), payloadSha256: hash(result) });
  if (member.startsWith("congress:")) {
    const curated = await keyVotesForMember(member);
    assert.equal(result.chamber, curated.chamber);
    assert.deepEqual(result.keyVotes, JSON.parse(JSON.stringify(curated.rows)), `${member}: canonical chamber key votes`);
    evidence.push({ surface: "key-votes", member, chamber: curated.chamber, expectedCount: curated.rows.length, returnedCount: rows(result.keyVotes).length, payload: result.keyVotes, payloadSha256: hash(result.keyVotes) });
  }
}
for (const sitting of getOutcomeSnapshot().sittings) {
  const expected = meetingReaderRecords(sitting.meetingId, sitting.bodyId ?? undefined);
  const result = await get(`/api/agenda?meetingId=${encodeURIComponent(sitting.meetingId)}`);
  assert.deepEqual(result.records, expected, sitting.meetingId);
  assert.equal(result.documentCount, rows(result.documents).length);
  evidence.push({ surface: "agenda/map", meetingId: sitting.meetingId, bodyId: sitting.bodyId, expected: expected.counts, returned: (result.records as typeof expected).counts, status: expected.status, payloadSha256: hash(result) });
}
const profiles: PrlSnapshot = prlProjection.value;
await each(Object.keys(memberDirectory.byMember).sort(), async (bioguide) => {
  const member = `congress:${bioguide}`;
  const found = directoryFor(member); assert.ok(found, member);
  const expected = { source: found.source, districtOffices: found.entry.districtOffices, committees: found.entry.committees.map((seat) => ({ ...seat, ...found.committeeJurisdictions[seat.committeeId] })) };
  const actual = await get(`/api/directory?member=${encodeURIComponent(member)}`);
  assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)), member);
  return { surface: "directory", member, payload: actual, returnedCount: { offices: expected.districtOffices.length, committees: expected.committees.length }, payloadSha256: hash(actual) };
});
const actionOfficials = new Set((executiveActionStore()?.actions ?? []).map((row) => row.officeholderId));
const actionTargets = [...new Set([...actionOfficials, ...officialBridge.rows.filter((row) => actionOfficials.has(row.holder.id) && row.status === "RESOLVED").flatMap((row) => row.candidacy ? [row.candidacy.candidacyId] : []), "ballot-az-pima:governor|Katie Hobbs", "congress:K000377", "statewide:nh/governor", "unresolved:Katie Hobbs"])];
await each(actionTargets, async (subject) => {
  // The /api/official-actions route gates NON-AZ subjects to NO_APPLICABLE_OFFICIAL —
  // executive actions are an AZ-scoped authority and the route never opens the action
  // store for a non-AZ office (tests/official-action-source-isolation.test.ts pins
  // non-AZ -> NO_APPLICABLE_OFFICIAL with the resolver never called). Compute expected
  // through the route's OWN settlement so the proof asserts that contract; for an
  // AZ-applicable subject the settlement's answer IS officialActionsForTarget(subject),
  // so the AZ record assertions stay exactly as strong.
  const settled = await settleOfficialActionHoldingAnswer(subject);
  assert.ok(settled.kind === "ANSWER", subject);
  const expected = settled.answer;
  const actual = await get(`/api/official-actions/${encodeURIComponent(subject)}`);
  assert.deepEqual(actual, expected, subject);
  assert.equal(actual.count, rows(actual.records).length);
  return { surface: "official-actions/map/ballot", subject, returnedIds: expected.records.map((row) => row.id), payload: actual, payloadSha256: hash(actual) };
});
await each(profiles.profiles, async (profile) => {
  const subject = `congress:${profile.bioguideId}`;
  const expected = prlProfileForSubject(subject);
  assert.ok(expected, subject);
  const actual = await get(`/api/profile/${encodeURIComponent(subject)}`);
  assert.deepEqual(actual.profile, expected, subject);
  return { surface: "profile/map/ballot", subject, payload: actual, payloadSha256: hash(actual) };
});
const corpus = unifiedCorpus();
const positionQueries = new Map<string, { subject: string; topic: string; expectedRecordIds: string[] }>();
const positionDispositions: unknown[] = [];
for (const snapshot of corpus.snapshots) {
  if (snapshot.extraction !== "ok" || !snapshot.text) {
    positionDispositions.push({ id: snapshot.id, state: "NOT_READER_ELIGIBLE", reason: "Current canonical extraction has no readable text." });
    continue;
  }
  const words = searchTerms(snapshot.text);
  const topic = words.find((word) => positionsFor(snapshot.subjectId, word, corpus).passages.some((passage) => passage.snapshotId === snapshot.id));
  if (!topic) {
    positionDispositions.push({ id: snapshot.id, state: "INTENTIONALLY_NOT_APPLICABLE", reason: "No distinct quotable passage survives the canonical exact-text deduplication and complete-passage contract; another snapshot may carry identical source text. No failed loader or invented position is claimed." });
    continue;
  }
  const key = `${snapshot.subjectId}|${topic}`;
  const query = positionQueries.get(key) ?? { subject: snapshot.subjectId, topic, expectedRecordIds: [] };
  query.expectedRecordIds.push(snapshot.id);
  positionQueries.set(key, query);
}
await each([...positionQueries.values()], async ({ subject, topic, expectedRecordIds }) => {
  const expected = readerPositionsFor(subject, topic, corpus);
  const actual = await get(`/api/positions/${encodeURIComponent(subject)}/${encodeURIComponent(topic)}`);
  // The positions route wraps the answer in the shared availability envelope
  // (holdingStatus/unavailableAuthorities) alongside the stated-N totalMatches —
  // the typed PositionHoldingSettlement contract. Strip the availability envelope,
  // hold the source-linked answer (with its own totalMatches) to exact equality,
  // then check the envelope is well-formed.
  const { holdingStatus, unavailableAuthorities, ...answer } = actual;
  assert.deepEqual(answer, { ...expected, totalMatches: expected.passages.length }, `${subject}/${topic}`);
  assert.ok(holdingStatus === "HELD" || holdingStatus === "PARTIAL", `${subject}/${topic}: positions holdingStatus ${holdingStatus}`);
  assert.ok(Array.isArray(unavailableAuthorities), `${subject}/${topic}: positions unavailableAuthorities`);
  const passages = rows(actual.passages);
  for (const id of expectedRecordIds) assert.ok(passages.some((passage) => passage.snapshotId === id), id);
  return { surface: "positions", subject, topic, expectedRecordIds, returnedRecordIds: [...new Set(passages.map((passage) => passage.snapshotId))], statedCount: actual.totalMatches, returnedCount: passages.length, payload: actual, payloadSha256: hash(actual) };
});
evidence.push({ surface: "positions", dispositions: positionDispositions });
const output = { exactHead: head, buildId, base, sourceHashes: proofSourcesPath ? JSON.parse(readFileSync(proofSourcesPath, "utf8")) : readerProofSources(), authorityReadbacks: { stateMoney: stateMoneyAuthority.readbacks, officialStateVotes: stateAuthority.readbacks }, execution: "HTTP requests to the integrated local Next production server, compared to canonical committed selectors. No model or acquired autonomous evidence supplies answers.", records: evidence };
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ exactHead: head, buildId, controls: evidence.length, representationDivisions: provedDivisions.size, moneyTargets: moneyTargets.length, voteMembers: memberIds.length, outcomeSittings: getOutcomeSnapshot().sittings.length, prlProfiles: profiles.profiles.length, positionQueries: positionQueries.size, positionDispositions: positionDispositions.length }));
