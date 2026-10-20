import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FEDERAL_PEOPLE_SPLIT_LOG_KEY, federalPeopleCountClean, federalPeopleCountLine, federalPeopleSplitLine, federalPeopleSplitRecord, federalPeopleSplitRecorded,
  type FederalPeopleSplitCount } from "../lib/civic-data/federal-people-split.ts";
import { withHeldFederalPeopleSplit, type HeldFederalPeopleSplit } from "../lib/civic-data/federal-people-split-source.ts";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { FederalMemberVotesReadModel, FederalRollCallsReadModel } from "../lib/votes/data-plane.ts";
import { federalPartyBreakdowns } from "../lib/votes/data-plane.ts";
import type { PromotedProjection } from "../lib/civic-data/types.ts";
import { readFederalRollCallPublicationBase } from "../lib/civic-data/federal-roll-publication-base.ts";
import { promotionProofIssue } from "../lib/civic-data/read-model.ts";
import { civicRecordsFor } from "../lib/civic-data/changes.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import type { PublishedCandidateMetadata } from "../lib/civic-data/store.ts";
import { MemoryRoutineDataStore, PromotionBaseChangedError } from "../lib/civic-data/store.ts";
import { processRoutineCandidate } from "../lib/civic-data/candidate-lifecycle.ts";
import type { BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import type { VotesSnapshot } from "../lib/votes/types.ts";

const AT = "2026-10-16T03:00:00.000Z", SHA = "a".repeat(40);
const run = (status: number | null, stdout = ""): BoundedChildResult =>
  ({ id: FEDERAL_PEOPLE_SPLIT_LOG_KEY, status, signal: status === null ? "SIGKILL" : null, stdout, stderr: "", termination: "EXITED", errorMessage: null }) as unknown as BoundedChildResult;
const holder = (id: string, state: string, chamber: "senate" | "house") => ({ id: `congress:${id}`, name: id, officeTitle: "Member", level: "FEDERAL", state, chamber, partyLabel: "Independent",
  termStart: "2025-01-03", termEnd: "2027-01-03", provenance: { sourceUrl: "https://example.test", sourceOrg: "test", collectedAt: AT, verifiedAt: null } });
const directory = (holders: ReturnType<typeof holder>[]): FederalDirectoryReadModel => ({ formatVersion: 1, currentMembershipComplete: true, sourceSha: SHA,
  roster: { scope: "us", generatedAt: AT, officeholders: holders as never, divisions: holders.map(row => ({ officeholderId: row.id, ocdId: `ocd-division/country:us/state:${row.state.toLowerCase()}`, bodyId: null })), unmatched: [] },
  directory: { source: { sha: SHA } as never, counts: {}, committees: { SSAF: { name: "Agriculture", type: "senate", url: null, jurisdiction: null, jurisdictionSource: null }, HSAG: { name: "Agriculture", type: "house", url: null, jurisdiction: null, jurisdictionSource: null } },
    byMember: Object.fromEntries(holders.map(row => [row.id.slice(9), { districtOffices: [], committees: [{ committeeId: row.chamber === "senate" ? "SSAF" : "HSAG" }] }])) as never } });
const votes = (positions: VotesSnapshot["positions"]): { snapshot: VotesSnapshot } => ({ snapshot: { generatedAt: AT, congress: 119, session: 2, window: { houseRolls: [5], senateRolls: [7] },
  identifierMatch: { houseMatched: 1, houseTotal: 1, senateMatched: 2, senateTotal: 2 },
  votes: [{ id: "senate:119-2:7", chamber: "senate", congress: 119, session: 2, rollNumber: 7, date: "2026-10-01", title: "Passage", titleSource: "CHAMBER_QUESTION", question: "On Passage", legisNum: null, result: "Passed 1–1", billUrl: null, rollCallUrl: "https://www.senate.gov/x", retrievedAt: AT },
    { id: "house:119-2:5", chamber: "house", congress: 119, session: 2, rollNumber: 5, date: "2026-10-01", title: "Passage", titleSource: "CHAMBER_QUESTION", question: "On Passage", legisNum: null, result: "Passed 1–0", billUrl: null, rollCallUrl: "https://clerk.house.gov/x", retrievedAt: AT }],
  positions } });

async function withSplitFixture<T>(national: FederalDirectoryReadModel, rollCalls: ReturnType<typeof votes>,
  work: (split: HeldFederalPeopleSplit, wire: readonly string[]) => Promise<T>): Promise<T> {
  const pg = new PGlite(), wire: string[] = [];
  const query: ReadOnlyQuery = async statements => {
    const results = [];
    for (const statement of statements) {
      const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows;
      assert.ok(!JSON.stringify(rows).includes("COUNTRY_SOURCE_BODY"), `source bodies stay in PostgreSQL: ${statement.text.slice(-240)} ${JSON.stringify(statement.params.slice(0, 8))}`);
      if (statement.text.startsWith("WITH split_page")) {
        assert.ok(rows.filter(row => row.row_kind === "record").length <= 128);
        assert.ok(!JSON.stringify(rows).includes("NATIONAL_MEMBER_DETAIL"), "identity pages carry no person's full record");
      }
      wire.push(JSON.stringify(rows));
      if (statement.params[0] === "FEDERAL_DIRECTORY" && statement.params[4] === "^WA$")
        assert.ok(!JSON.stringify(rows).includes('"D000001"'), "a state read never transfers another state's member directory");
      results.push(rows);
    }
    return results;
  };
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${SHA}/legislators-current.yaml`;
    const normalized = { acquisitions: [{ requestedUrl: url, finalUrl: url, httpStatus: 200,
      raw: { key: "fixture", rawHash: "b".repeat(64), byteLength: 10 }, body: "COUNTRY_SOURCE_BODY".repeat(10_000) }] };
    const rollProjection = { formatVersion: 1, ...rollCalls,
      partyBreakdowns: federalPartyBreakdowns(rollCalls.snapshot, new Map(national.roster.officeholders.map(holder => [holder.id, holder.partyLabel ?? null]))),
      billSummaries: { curatedAt: AT, summaries: {}, pending: [] } };
    const rollNormalized = { acquisitions: [{ requestedUrl: "https://clerk.house.gov/evs/2026/roll005.xml", finalUrl: "https://clerk.house.gov/evs/2026/roll005.xml", httpStatus: 200, rawHash: "c".repeat(64), byteCount: 20 },
      { requestedUrl: "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00007.xml", finalUrl: "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00007.xml", httpStatus: 200, rawHash: "d".repeat(64), byteCount: 20 }] };
    for (const source of [{ id: "directory-held", sourceId: "congress-directory-project", recordClass: "FEDERAL_DIRECTORY" as const, scope: "US:current-congress-directory", readModel: national, normalizedPayload: normalized },
      { id: "votes-held", sourceId: "federal-legislative-records", recordClass: "FEDERAL_ROLL_CALL" as const, scope: "US:recent-federal-rollcalls", readModel: rollProjection, normalizedPayload: rollNormalized }]) {
      const encoded = partitionCivicPayload(source.readModel), normalizedEncoded = partitionCivicPayload(source.normalizedPayload);
      for (const part of [...encoded.parts, ...normalizedEncoded.parts]) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
      await insertPublishedSliceFixture(pg, { ...source, at: AT, sourceVersion: source.recordClass === "FEDERAL_ROLL_CALL" ? "119-2" : SHA,
        storedReadModel: encoded.value, storedNormalizedPayload: normalizedEncoded.value });
    }
    const prior = await readFederalRollCallPublicationBase({ readPublishedCandidateMetadata: async id => {
      const [row] = (await pg.query<{ candidate: PublishedCandidateMetadata["candidate"]; receipt: PublishedCandidateMetadata["receipt"] }>(
        "SELECT candidate-'readModel'-'normalizedPayload' AS candidate,validation_receipt AS receipt FROM civic_data_candidates WHERE id=$1", [id])).rows;
      return row ? { candidate: row.candidate, receipt: row.receipt, state: "PROMOTED", acquisitionSucceeded: true,
        promotedVersion: id, lastKnownGoodVersion: id, failureCode: null, failureDetail: null } : null;
    } }, query);
    assert.ok(prior.current && prior.lkg);
    assert.equal(promotionProofIssue("FEDERAL_ROLL_CALL", "US:recent-federal-rollcalls", prior.current, prior.lkg), null);
    assert.equal(prior.lkg.candidate.normalization.normalizedHash, canonicalCivicDataHash(rollProjection), "the source's original full hash is retained");
    assert.deepEqual(civicRecordsFor("FEDERAL_ROLL_CALL", prior.current.payload), civicRecordsFor("FEDERAL_ROLL_CALL", rollProjection), "all semantic records survive the bounded prior view");
    assert.equal("positions" in (prior.current.payload as FederalRollCallsReadModel).snapshot, false);
    assert.ok(promotionProofIssue("FEDERAL_ROLL_CALL", "US:recent-federal-rollcalls", prior.current,
      { ...prior.lkg, candidate: { ...prior.lkg.candidate } }), "copying the partial view cannot forge its original canonical proof");
    const result = await withHeldFederalPeopleSplit(query, async split => {
      const store = Object.assign(new MemoryRoutineDataStore(), { readFederalRollCallPublicationBase: async () => prior });
      const readCandidate = store.readCandidate.bind(store);
      store.readPromotion = async () => { throw new Error("COUNTRY_PRIOR_READ_FORBIDDEN"); };
      store.readCandidate = async id => { if (id === "votes-held") throw new Error("COUNTRY_CANDIDATE_READ_FORBIDDEN"); return readCandidate(id); };
      const window = [...split.candidates()].at(-1)!;
      assert.equal(window.replaceLegacyPositions, true, "the old payload must be replaced rather than confirmed unchanged");
      await assert.rejects(processRoutineCandidate(store, window.candidate, AT, "racing-version"), PromotionBaseChangedError);
      if (federalPeopleCountClean(split.count)) {
        (store as unknown as { promotions: Map<string, PromotedProjection> }).promotions.set(prior.current!.key, prior.current!);
        const result = await processRoutineCandidate(store, window.candidate, AT, prior.current!.versionId, null, null, { confirmUnchanged: false });
        assert.equal(result.candidate.candidate.changeSet?.outcome, "UNCHANGED", "partitioning does not invent changed civic facts");
        assert.equal(result.promoted?.versionId, window.candidate.id, JSON.stringify(result.candidate.receipt));
        assert.equal("positions" in (result.promoted!.payload as FederalRollCallsReadModel).snapshot, false, "a real pointer move replaces the legacy storage shape");
      }
      return work(split, wire);
    });
    assert.ok(!wire.join("").includes("COUNTRY_SOURCE_BODY"), "capture metadata never reloads the national source body or its enclosing normalized payload");
    await pg.query("UPDATE civic_data_promotions SET payload='{}'::jsonb WHERE record_class='FEDERAL_DIRECTORY'");
    await assert.rejects(withHeldFederalPeopleSplit(query, async () => undefined), /PUBLISHED_ARRAY_SLICE_POINTER_INVALID/);
    return result;
  } finally { await pg.close(); }
}

test("every member lands in exactly one place and every position under exactly one member", async () => {
  const national = directory([holder("S000001", "WA", "senate"), holder("S000002", "WA", "senate"), holder("H000001", "WA", "house"), holder("D000001", "PR", "house")]);
  await withSplitFixture(national, votes([
    { officeholderId: "congress:S000001", voteId: "senate:119-2:7", position: "YES" }, { officeholderId: "congress:S000002", voteId: "senate:119-2:7", position: "NO" },
    { officeholderId: "congress:H000001", voteId: "house:119-2:5", position: "YES" }]), async split => {
  assert.ok(federalPeopleCountClean(split.count));
  assert.deepEqual(split.count.members, { old: 4, new: 4, missing: [], duplicated: [], added: [] });
  assert.deepEqual(split.count.positions, { old: 3, new: 3, missing: [], duplicated: [], added: [] });
  const rows = [...split.candidates()], places = rows.filter(row => row.candidate.recordClass === "FEDERAL_DIRECTORY");
  assert.equal(places.length, 56, "every state, DC and the five territories hold a record, empty or not");
  const wa = places.find(row => row.candidate.scope === "US-WA:current-congress-directory")!.candidate.readModel as FederalDirectoryReadModel;
  assert.deepEqual(wa.roster.officeholders.map(row => row.id), ["congress:S000001", "congress:S000002", "congress:H000001"]);
  assert.deepEqual(Object.keys(wa.directory.committees).sort(), ["HSAG", "SSAF"], "a place holds only the committees its members sit on");
  const pr = places.find(row => row.candidate.scope === "US-PR:current-congress-directory")!.candidate.readModel as FederalDirectoryReadModel;
  assert.deepEqual(pr.directory.committees, { HSAG: national.directory.committees.HSAG });
  const members = rows.filter(row => row.candidate.scope.includes(":congress:")).map(row => row.candidate.readModel as FederalMemberVotesReadModel);
  assert.deepEqual(members.map(member => member.officeholderId), ["congress:S000001", "congress:S000002", "congress:H000001"], "a member no roll records gets no record");
  assert.ok(members.every(member => member.positions.every(position => position.officeholderId === member.officeholderId)));
  const window = rows.at(-1)!.candidate.readModel as FederalRollCallsReadModel;
  assert.deepEqual(window.partyBreakdowns["senate:119-2:7"], [{ party: "Independents", yes: 1, no: 1 }]);
  assert.equal("positions" in window.snapshot, false, "the shared U.S. window carries no member's position");
  });
});

test("a member the split cannot place is a count difference, and any difference blocks", async () => {
  await withSplitFixture(directory([holder("S000001", "WA", "senate"), holder("X000001", "ZZ", "senate")]), votes([]), async split => {
  assert.deepEqual(split.count.members.missing, ["congress:X000001"]);
  assert.equal(federalPeopleCountClean(split.count), false);
  });
});

test("multiple identity pages select encoded members before loading their state records and preserve duplicate-position diagnostics", async () => {
  const holders = Array.from({ length: 130 }, (_, index) => ({ ...holder(`H${String(index + 1).padStart(6, "0")}`, index % 2 ? "WA" : "PR", "house"),
    name: `NATIONAL_MEMBER_DETAIL ${index} `.repeat(2_000) }));
  const position = { officeholderId: "congress:H000001", voteId: "house:119-2:5", position: "YES" as const };
  await withSplitFixture(directory(holders), votes([position, position]), async split => {
    assert.deepEqual(split.count.members, { old: 130, new: 130, missing: [], duplicated: [], added: [] });
    assert.deepEqual(split.count.positions, { old: 2, new: 2, missing: [], duplicated: ["house:119-2:5|congress:H000001"], added: [] });
    assert.equal(federalPeopleCountClean(split.count), false);
  });
});

test("a finished split is recorded once with its count and every outcome, and a recorded one is never due again", async () => {
  const { ownerDigests } = createMemoryRepositories();
  assert.equal(await federalPeopleSplitRecorded(ownerDigests), false);
  const count: FederalPeopleSplitCount = { members: { old: 1, new: 1, missing: [], duplicated: [], added: [] }, positions: { old: 1, new: 1, missing: [], duplicated: [], added: [] } };
  const stdout = [federalPeopleCountLine(count), federalPeopleSplitLine({ scope: "US-WA:current-congress-directory", from: "cv-national", to: "cv-wa" }),
    federalPeopleSplitLine({ scope: "US-PR:current-congress-directory", from: "cv-national", to: null, refusal: "CANNOT_TELL" })].join("\n");
  const record = federalPeopleSplitRecord(run(0, stdout), AT, "b".repeat(40))!;
  assert.equal(record.lines.length, 3);
  assert.equal(record.cycleOk, false, "a refused record is listed, and the record still stands");
  assert.match(record.headline, /1 members in their place records and 1 roll-call positions under their members \(1 and 1 before\); 1 records published, 1 refused/);
  await ownerDigests.append(FEDERAL_PEOPLE_SPLIT_LOG_KEY, record.digestId, record, AT);
  assert.equal(await federalPeopleSplitRecorded(ownerDigests), true);
});

test("a child that did not finish, or never reached its count check, leaves nothing recorded", () => {
  assert.equal(federalPeopleSplitRecord(run(1), AT, null), null);
  assert.equal(federalPeopleSplitRecord(run(null), AT, null), null);
  assert.equal(federalPeopleSplitRecord(run(0, "nothing counted"), AT, null), null);
});

test("the runner launches the split under its own capability, and the script runs under no other", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8"), script = readFileSync("scripts/split-federal-people.mts", "utf8");
  assert.match(runner, /capability: "FEDERAL_PEOPLE_SPLIT"[^)]*\}\)/);
  assert.match(script, /assertRuntimeAuthority\(\{ capabilities: \["FEDERAL_PEOPLE_SPLIT"\] \}\)/);
  assert.match(script, /if \(!federalPeopleCountClean\(split\.count\)\) throw/);
});
