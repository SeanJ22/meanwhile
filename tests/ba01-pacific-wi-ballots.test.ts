import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import test from "node:test";
import type { BallotWithTickets } from "../lib/ballot/tickets.ts";

const root = new URL("../", import.meta.url);
const evidence = new URL("data/ballot/ba01-pacific-wi-evidence/", root);
const data = JSON.parse(readFileSync(new URL("data/ballot/2026-general/wi.json", root), "utf8"));
const ballot = Object.values(data.ballots)[0] as BallotWithTickets;

test("Wisconsin county acquisitions preserve their exact official PDF bytes", () => {
  const captures = JSON.parse(readFileSync(new URL("captures.json", evidence), "utf8"));
  for (const capture of captures) {
    assert.equal(createHash("sha256").update(gunzipSync(readFileSync(new URL(capture.file, evidence)))).digest("hex"), capture.rawHash);
    assert.ok(data.sourceReceipt.sources.some((source: { rawHash: string; retrievedAt: string }) =>
      source.rawHash === capture.rawHash && source.retrievedAt === capture.retrievedAt));
  }
});

test("Wisconsin county additions retain a captured source for every candidate and preserve the full minor-party CD6 field", () => {
  const cd6 = ballot.contests.find(c => c.title === "Representative in Congress District 6");
  const choices = ballot.candidacies.filter(c => c.contestId === cd6?.id);
  assert.deepEqual(choices.map(c => [c.familyName, c.partyLabel]), [
    ["Glenn Grothman", "Republican"], ["Brad Smith", "Democratic"],
    ["Matthew Arndt", "Wisconsin Green Party"], ["Elizabeth Anne Fitzgibbon", "Independent"],
    ["Mike Thurow", "Independent"],
  ]);
  for (const candidate of ballot.candidacies.filter(c => c.id.startsWith("ba01-pacific-wi-"))) {
    assert.ok(data.sourceReceipt.sources.some((source: { requestedUrl: string; retrievedAt: string }) =>
      source.requestedUrl === candidate.provenance.sourceUrl && source.retrievedAt === candidate.provenance.collectedAt));
  }
});

test("county-office choices stay in their county and retain every source-listed designation equally", () => {
  const sheriff = ballot.contests.find(c => c.title === "Winnebago County Sheriff");
  assert.equal(sheriff?.ocdId, "ocd-division/country:us/state:wi/county:winnebago");
  const choices = ballot.candidacies.filter(c => c.contestId === sheriff?.id);
  assert.deepEqual(choices.map(c => [c.familyName, c.partyLabel]), [
    ["Darin M. Rice", "Republican"], ["Jason W. Rippl", "Democratic"],
    ["Danielle Falesnik", "Strong. Fair. Ready to Lead"],
  ]);
  for (const candidate of choices) {
    assert.equal(candidate.websiteUrl, null);
    assert.equal(candidate.incumbent, null);
    assert.equal(candidate.slogan, null);
  }
  const cd3 = ballot.contests.find(c => c.title === "Representative in Congress District 3");
  assert.equal(ballot.candidacies.filter(c => c.contestId === cd3?.id).length, 4);
});

test("Wisconsin joint tickets preserve the held running-mate IDs and the official printed pair", () => {
  assert.equal(ballot.candidateTickets?.length, 2);
  for (const ticket of ballot.candidateTickets ?? []) {
    const lead = ballot.candidacies.find(c => c.id === ticket.leadCandidacyId);
    const mate = ballot.candidacies.find(c => c.id === ticket.runningMate.id);
    assert.ok(lead);
    assert.ok(mate);
    assert.deepEqual(ticket.runningMate, mate);
    assert.ok(ticket.provenance.quote?.includes(`${lead.givenName} ${lead.familyName}/${mate.givenName} ${mate.familyName}`));
  }
});
