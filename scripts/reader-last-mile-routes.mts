import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolveZip } from "../lib/geo/zcta.ts";
import { divisionIdsForZipArea } from "../lib/ballot/zip-divisions.ts";
import { divisionsAt, seatHoldersForDivision } from "../lib/registry/server.ts";
import { representationForDivision } from "../lib/registry/representation.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { getVotesSnapshot } from "../lib/votes/snapshot.ts";
import { getStateVotesSnapshot } from "../lib/sources/legiscan/snapshot.ts";
import { getOutcomeSnapshot } from "../lib/outcomes/store.ts";
import { meetingReaderRecords } from "../lib/meetings/reader-records.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };
import { campaignMoneyApiAnswer } from "../lib/funding/campaign-money.ts";
import { stateMoneySources } from "../lib/funding/state-snapshot.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";
import officialBridge from "../lib/funding/official-candidacies.json" with { type: "json" };
import { prlProfileForSubject } from "../lib/sources/prl/snapshot.ts";
import type { PrlSnapshot } from "../lib/sources/prl/types.ts";
import { unifiedCorpus } from "../lib/corpus/unified.ts";
import { positionsFor, searchTerms } from "../lib/corpus/positions.ts";
import { readerPositionsFor } from "../lib/corpus/reader-positions.ts";
import { getFundingSnapshot } from "../lib/funding/snapshot.ts";
import { officialActionsForTarget } from "../lib/officials/reader-actions.ts";
import { executiveActionStore } from "../lib/officials/executive-actions.ts";
import { ROSTER_FILES } from "../lib/coverage/artifacts.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import { directoryFor } from "../lib/officials/directory.ts";
import { keyVotesForMember } from "../lib/votes/key-votes-reader.ts";

const base = process.env.SHOOT_BASE_URL ?? "http://localhost:3210";
assert.match(new URL(base).hostname, /^(localhost|127\.0\.0\.1)$/,
  "Local production proof only; production readback is a separate bounded walk.");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
const evidence: unknown[] = [];
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
  const seats = await seatHoldersForDivision(division);
  const expected = seats.length ? seats : representationForDivision(null, division);
  const result = await get(`/api/representation/${division}`);
  const actual = rows(result.holders);
  assert.equal(result.ocdId, division);
  assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)), division);
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
const rosterDivisions = ROSTER_FILES.flatMap((name) => {
  const fips = /^officeholders-(\d{2})\.json$/.exec(name)?.[1];
  const path = name === "officeholders-us.json" ? `lib/registry/${name}` : `data/states/${FIPS_TO_STATE[fips!].postal.toLowerCase()}/officials/${name}`;
  return (JSON.parse(readFileSync(path, "utf8")) as OfficeholderSet).divisions.map((division) => division.ocdId);
});
const allDivisions = [...new Set([
  ...registry.divisions.map((division) => division.ocdId),
  ...rosterDivisions,
  ...STATEWIDE_EXECUTIVES.map((executive) => executive.stateOcdId),
  ...BODY_ROSTERS.filter((roster) => /#(?:governing|board)$/.test(roster.bodyId)).map((roster) => roster.bodyId.split("#")[0]).filter((id) => id.startsWith("ocd-division/")),
])];
const remainingDivisions = allDivisions.filter((id) => !provedDivisions.has(id)).sort();
floored("representation division controls", "canonical registry divisions", remainingDivisions.length, remainingDivisions.length);
await each(remainingDivisions, (division) => representation(division));
const moneyTargets = [...new Set([
  ...stateMoneySources().flatMap((file) => {
    const match = /^state-money-([a-z]{2})-\d{4}\.json$/.exec(file); assert.ok(match);
    return (JSON.parse(readFileSync(`data/states/${match[1]}/funding/${file}`, "utf8")) as StateMoneySnapshot).records.flatMap((record) => record.targetKeys);
  }),
  ...officialBridge.rows.filter((row) => row.status === "RESOLVED").map((row) => row.holder.id),
  ...getFundingSnapshot().candidates.flatMap((row) => row.targetKeys),
  ...getFundingSnapshot().absences.map((row) => row.targetKey),
])].sort();
await each(moneyTargets, async (target) => {
  const expected = campaignMoneyApiAnswer(target);
  const actual = await get(`/api/funding/${encodeURIComponent(target)}`);
  assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)), target);
  return { surface: "funding/state-money", target, payload: actual, payloadSha256: hash(actual) };
});
const federal = getVotesSnapshot();
const state = getStateVotesSnapshot();
const memberDirectory = JSON.parse(readFileSync("data/congress-legislators/directory.json", "utf8")) as { byMember: Record<string, unknown> };
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
const profiles = JSON.parse(readFileSync("data/prl/prl-profiles.json", "utf8")) as PrlSnapshot;
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
  const expected = officialActionsForTarget(subject);
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
  assert.deepEqual(actual, { ...expected, totalMatches: expected.passages.length }, `${subject}/${topic}`);
  const passages = rows(actual.passages);
  for (const id of expectedRecordIds) assert.ok(passages.some((passage) => passage.snapshotId === id), id);
  return { surface: "positions", subject, topic, expectedRecordIds, returnedRecordIds: [...new Set(passages.map((passage) => passage.snapshotId))], statedCount: actual.totalMatches, returnedCount: passages.length, payload: actual, payloadSha256: hash(actual) };
});
evidence.push({ surface: "positions", dispositions: positionDispositions });
const output = { exactHead: head, buildId, base, execution: "HTTP requests to the integrated local Next production server, compared to canonical committed selectors. No model or acquired autonomous evidence supplies answers.", records: evidence };
writeFileSync("docs/evidence/reader-last-mile-routes.json", JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ exactHead: head, buildId, controls: evidence.length, representationDivisions: provedDivisions.size, moneyTargets: moneyTargets.length, voteMembers: memberIds.length, outcomeSittings: getOutcomeSnapshot().sittings.length, prlProfiles: profiles.profiles.length, positionQueries: positionQueries.size, positionDispositions: positionDispositions.length }));
