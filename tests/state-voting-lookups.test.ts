import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readStateVotingLookups } from "../lib/ballot/state-voting-lookups.ts";
import { BALLOT_NAVIGATION_STATES } from "../lib/civic-data/ballot-navigation-scope.ts";
import type { PublishedElectionField } from "../lib/civic-data/election-fields.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";

const now = "2026-10-27T12:00:00.000Z";
const field = (state: string, url = `https://elections.${state.toLowerCase()}.gov/polling`): PublishedElectionField => ({
  id: `lookup:${state}`, kind: "ELECTION_FIELD", value: { state,
    divisionId: `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`,
    fieldKind: "polling_lookup", text: url, quote: "Find your polling place", dates: [], navigationUrl: url,
    url: `https://elections.${state.toLowerCase()}.gov/`, verifiedAt: now, collectedAt: now, sourceOrg: "State election office" },
});
const queryFor = (records: readonly PublishedElectionField[], choices: readonly Record<string, unknown>[] = []): ReadOnlyQuery =>
  async statements => statements.map(statement => statement.text.includes("WITH pointers")
    ? records.map(record => ({ ...record, valid: true })) : [...choices]);

test("all 50 states and DC have an existing sourced polling lookup and keep the state's own link", async () => {
  assert.equal(BALLOT_NAVIGATION_STATES.length, 51);
  for (const state of BALLOT_NAVIGATION_STATES) {
    const input = JSON.parse(await readFile(new URL(`../data/ballot/2026-navigation/${state.toLowerCase()}.json`, import.meta.url), "utf8"));
    const records = input.package.payload.records.filter((record: PublishedElectionField) => record.kind === "ELECTION_FIELD" && record.value.fieldKind === "polling_lookup");
    assert.ok(records.length, state);
    const result = await readStateVotingLookups([state], undefined, queryFor(records));
    assert.equal(result.length, 1, state);
    assert.equal(result[0].state, state);
    assert.ok(records.some((record: PublishedElectionField) => record.value.navigationUrl === result[0].url));
    assert.ok(result[0].name);
    assert.ok(result[0].sourceUrl);
  }
});

test("a newer state lookup replaces an older route", async () => {
  const old = field("AZ", "https://my.arizona.vote/PortalList.aspx"), current = field("AZ", "https://my.arizona.vote/WhereToVote.aspx?s=pollingplace");
  Object.assign(current, { id: "new", value: { ...current.value, verifiedAt: "2026-10-28T12:00:00.000Z" } });
  const result = await readStateVotingLookups(["AZ", "AZ"], undefined, queryFor([current, old]));
  assert.equal(result.length, 1);
  assert.equal(result[0].url, current.value.navigationUrl);
});

test("a removed lookup stays removed and a different state's route is refused", async () => {
  const record = field("WI");
  assert.deepEqual(await readStateVotingLookups(["WI"], undefined, queryFor([record], [
    { reader_id: record.id, resolved: "REMOVE" },
  ])), []);
  await assert.rejects(readStateVotingLookups(["WI"], undefined, queryFor([field("NH")])), /WRONG_STATE/);
});

test("an invalid published pointer cannot supply a lookup", async () => {
  const query: ReadOnlyQuery = async () => [[{ valid: false }]];
  await assert.rejects(readStateVotingLookups(["WI"], undefined, query), /PUBLISHED_PROOF_INVALID/);
});
