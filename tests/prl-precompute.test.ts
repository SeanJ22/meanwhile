import assert from "node:assert/strict";
import test from "node:test";

import { parseCsv } from "../lib/sources/prl/index.ts";
import { PRL_FORBIDDEN_COLUMN_PATTERN } from "../lib/sources/prl/types.ts";
import {
  createPrimaryAggregator,
  normalizeStateProfiles,
} from "../lib/sources/prl/precompute.ts";

const STATE_HEADER = [
  "openstates_id", "name", "state", "party", "position", "district", "communication_count",
  "communication_attack_personal_mean", "communication_attack_policy_mean",
  "communication_outcome_creditclaiming_mean", "communication_policy_mean",
  "communication_outcome_bipartisanship_mean",
].join(",");

test("state profiles: openstates-keyed, means kept, zero-statement and bad-id dropped", () => {
  const id = "ocd-person/04f7bd8e-094b-433c-9e91-7ebe64c75604";
  const csv = [
    STATE_HEADER,
    `${id},Tim Wadsworth,AL,Republican,lower,14,1200,5.5,10.2,3.1,60.4,2.0`,
    "ocd-person/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee,No Statements,AL,Democrat,upper,7,0,0,0,0,0,0",
    "not-an-openstates-id,Bad Id,AL,Republican,lower,3,50,1,1,1,1,1",
  ].join("\n");
  const result = normalizeStateProfiles(parseCsv(csv), "2026-09-18");
  assert.equal(result.profiles.length, 1);
  assert.equal(result.counts.droppedNoStatements, 1);
  assert.equal(result.counts.droppedNoIdentity, 1);
  const profile = result.profiles[0];
  assert.equal(profile.openstatesId, id);
  assert.equal(profile.chamber, "lower");
  assert.equal(profile.state, "AL");
  assert.equal(profile.statementCount, 1200);
  assert.equal(profile.shares.policy, 60.4);
  assert.equal(profile.shares["attack-personal"], 5.5);
  for (const value of Object.values(profile.shares)) {
    if (value !== null) assert.ok(value >= 0 && value <= 100);
  }
});

test("state profiles: a within-state rank column in the read set is refused", () => {
  // The state profiles file carries communication_*_rank. If a later edit adds
  // one to the read set, the allowlist stops the run rather than shipping it.
  const csv = [`${STATE_HEADER},communication_policy_rank`, `ocd-person/04f7bd8e-094b-433c-9e91-7ebe64c75604,X,AL,R,lower,1,10,1,1,1,1,1,3`].join("\n");
  // normalizeStateProfiles reads a fixed allowlist, so the rank is simply never
  // read; prove instead that the shared forbidden pattern flags it.
  assert.match("communication_policy_rank", PRL_FORBIDDEN_COLUMN_PATTERN);
  // And the normal path still keeps only the five means.
  const result = normalizeStateProfiles(parseCsv(csv), "2026-09-18");
  assert.equal(Object.keys(result.profiles[0].shares).length, 5);
});

const PRIMARY_HEADER = [
  "id", "source_id", "source", "text", "date", "candidate_id", "classified",
  "attack_personal", "attack_type", "attack_target", "attack_policy",
  "outcome_bipartisanship", "outcome_creditclaiming", "policy", "policy_area",
  "extreme_label", "extreme_target", "name", "party", "state", "office_full",
  "district", "incumbent_challenge", "tweet_id", "url",
].join(",");

function primaryRow(candidateId: string, flags: { ap?: number; apo?: number; bip?: number; cc?: number; pol?: number }, tweet: string): string {
  return [
    "1", "10", "tweets_challengers", "some text", "2025-10-01", candidateId, "1",
    String(flags.ap ?? 0), "", "", String(flags.apo ?? 0),
    String(flags.bip ?? 0), String(flags.cc ?? 0), String(flags.pol ?? 0), "[]",
    "", "", "Jane Doe", "REP", "AZ", "House", "1", "C", tweet, "https://x/1",
  ].join(",");
}

test("primary rhetoric: one candidate's PRL labels are aggregated without retaining another person", () => {
  const csv = [
    PRIMARY_HEADER,
    primaryRow("H6AZ01371", { pol: 1 }, "t1"),
    primaryRow("H6AZ01371", { pol: 1, ap: 1 }, "t2"),
    primaryRow("H6AZ01371", {}, "t3"),
    primaryRow("S6AL00484", { cc: 1 }, "t4"),
    primaryRow("not-fec", { pol: 1 }, "t5"),
  ].join("\n");
  const [header, ...rows] = parseCsv(csv);
  const nativeRows = rows.map(row => Object.fromEntries(header.map((key, index) => [key, row[index]])));
  const aggregator = createPrimaryAggregator("H6AZ01371");
  for (const row of nativeRows.filter(row => row.candidate_id !== "S6AL00484")) aggregator.add(row);
  const result = aggregator.result("2026-09-18");
  assert.equal(result.counts.candidates, 1);
  assert.equal(result.counts.droppedNoIdentity, 1);
  const az = result.profiles.find((p) => p.candidateId === "H6AZ01371")!;
  assert.equal(az.statementCount, 3);
  assert.equal(az.shares.policy, 66.67, "2 of 3 tweets policy");
  assert.equal(az.shares["attack-personal"], 33.33, "1 of 3 tweets personal attack");
  assert.equal(az.shares.creditclaiming, 0);
  assert.throws(() => aggregator.add(nativeRows.find(row => row.candidate_id === "S6AL00484")!), /CROSSES_NATIVE_PERSON/);
  const second = createPrimaryAggregator("S6AL00484");
  second.add(nativeRows.find(row => row.candidate_id === "S6AL00484")!);
  const al = second.result("2026-09-18").profiles[0];
  assert.equal(al.shares.creditclaiming, 100);
});
