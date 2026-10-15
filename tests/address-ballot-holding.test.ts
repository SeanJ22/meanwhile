import assert from "node:assert/strict";
import test from "node:test";
import { addressContestScopeFor } from "../lib/ballot/address-scope.ts";
import { applyBallotContestScope } from "../lib/ballot/contest-visibility.ts";
import { MissingBallotProjectionError } from "../lib/ballot/holding.ts";
import type { RegisteredBallotSource } from "../lib/ballot/registry.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { CivicDataStoreUnavailableError, civicDataReadNotInitialized } from "../lib/civic-data/read-model.ts";

const division = "ocd-division/country:us/state:nh/sldl:702";
const ballot = { contests: [{ id: "fixture:contest", ocdId: division }], absences: [] } as unknown as BallotSet;
function source(fetch: () => Promise<unknown[]>, normalize = () => ballot): RegisteredBallotSource {
  return { state: "nh", source: { name: "controlled-ballot", fetch, normalize, upsert: async () => ({ inserted: 0, updated: 0 }) } };
}
function unavailable(recordClass: Parameters<typeof civicDataReadNotInitialized>[0]) {
  const result = civicDataReadNotInitialized(recordClass, "controlled:scope", "The source holding is unavailable");
  assert.equal(result.kind, "STORE_UNREACHABLE");
  if (result.kind !== "STORE_UNREACHABLE") throw new Error("Expected an unavailable holding");
  return new CivicDataStoreUnavailableError(result);
}

test("only a successfully read applicable ballot establishes a narrowing set", async () => {
  const held = source(async () => [ballot]);
  assert.deepEqual(await addressContestScopeFor([division], async () => [held]), {
    contestIds: ["fixture:contest"], ballotStatus: "HELD",
  });
  assert.deepEqual(await addressContestScopeFor([division], async () => []), {
    contestIds: [], ballotStatus: "NOT_RECORDED",
  });
  for (const recordClass of ["BALLOT_CANDIDACY", "BALLOT_FILING"] as const) {
    const missing = source(async () => { throw unavailable(recordClass); });
    assert.deepEqual(await addressContestScopeFor([division], async () => [missing, held]), {
      contestIds: [], ballotStatus: "HOLDING_UNAVAILABLE",
    }, "a surviving partial source cannot hide contests from an unread authority");
  }
  const missing = source(async () => { throw new MissingBallotProjectionError("controlled-ballot"); });
  assert.deepEqual(await addressContestScopeFor([division], async () => [missing]), {
    contestIds: [], ballotStatus: "NOT_RECORDED",
  });
});

test("a known ballot absence stays distinct from a missing holding", async () => {
  const absence = { contests: [], absences: [{ ocdId: division }] } as unknown as BallotSet;
  assert.deepEqual(await addressContestScopeFor([division], async () => [source(async () => [absence], () => absence)]), {
    contestIds: [], ballotStatus: "HELD",
  });
});

test("an address ballot set belongs only to its explicitly selected election", async () => {
  const dated = { ...ballot, election: { id: "controlled-election", date: "2026-11-03", state: "NH", name: "Controlled election" } };
  const read = async () => [source(async () => [dated], () => dated)];
  assert.deepEqual(await addressContestScopeFor([division], read, {
    purpose: "election", asOf: "2026-10-15", electionDate: "2026-11-03",
  }), { contestIds: ["fixture:contest"], ballotStatus: "HELD" });
  assert.deepEqual(await addressContestScopeFor([division], read, {
    purpose: "election", asOf: "2026-10-15", electionDate: "2024-11-05",
  }), { contestIds: [], ballotStatus: "NOT_RECORDED" });
  assert.deepEqual(await addressContestScopeFor([division], read, {
    purpose: "representation", asOf: "2026-10-15",
  }), { contestIds: [], ballotStatus: "NOT_RECORDED" });
});

test("arbitrary source and normalization errors, and unrelated holding errors, remain failures", async () => {
  const parseError = new Error("Malformed ballot source");
  await assert.rejects(addressContestScopeFor([division], async () => [source(async () => [], () => { throw parseError; })]), error => error === parseError);
  const sourceError = new Error("Source implementation failed");
  await assert.rejects(addressContestScopeFor([division], async () => [source(async () => { throw sourceError; })]), error => error === sourceError);
  const unrelated = unavailable("STATE_LEGISLATOR");
  await assert.rejects(addressContestScopeFor([division], async () => [source(async () => { throw unrelated; })]), error => error === unrelated);
});

test("an unavailable address ballot restores contests hidden by the preceding address", () => {
  const sections: { dataset: DOMStringMap }[] = [
    { dataset: { contestId: "fixture:contest", couldGovern: "true" } },
    { dataset: { contestId: "fixture:other", couldGovern: "true" } },
  ];
  assert.equal(applyBallotContestScope(sections, ["fixture:contest"]), 1);
  assert.equal(sections[1].dataset.scopedOut, "true");
  assert.equal(sections[0].dataset.couldGovern, undefined);
  assert.equal(applyBallotContestScope(sections, null), 0);
  assert.ok(sections.every(section => section.dataset.scopedOut === undefined));
  assert.ok(sections.every(section => section.dataset.couldGovern === "true"));
  assert.ok(sections.every(section => section.dataset.couldGovernParked === undefined));
});
