import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { captureSha256 } from "../scripts/ba01-evidence.mts";

const state = (code: string) => Object.values((JSON.parse(readFileSync(`data/ballot/2026-general/${code}.json`, "utf8")) as GenericBallotProjection).ballots)[0];

test("TX special certifications keep both terms, every printed name and party", () => {
  const tx = state("tx");
  for (const [family, number, names] of [
    ["sldu", 22, [["David Cook", "Republican"], ["Amy Martinez-Salas", "Democratic"]]],
    ["sldl", 93, [["Alan Blaylock", "Republican"], ["Ericka Lomick", "Democratic"]]],
  ] as const) {
    const id = `tx-ba01-2026-special-${family}-${number}`;
    const contest = tx.contests.find(row => row.id === id);
    assert.equal(contest?.ocdId, `ocd-division/country:us/state:tx/${family}:${number}`);
    assert.deepEqual(tx.candidacies.filter(row => row.contestId === id).map(row => [row.familyName, row.partyLabel]), names);
  }
  assert.ok(tx.contests.some(row => row.id === "tx-sos-2026-state-representative-district-93"), "the regular full-term race stays separate");
});

test("Travis sample columns keep Todd Wong in Court at Law 1 and Andy Brown in County Judge", () => {
  const tx = state("tx");
  for (const [suffix, name] of [["county-judge", "Andy Brown"], ["judge-county-court-at-law-no-1", "Todd Wong"]]) {
    const id = `tx-ba01-2026-travis-${suffix}`;
    assert.deepEqual(tx.candidacies.filter(row => row.contestId === id).map(row => row.familyName), [name]);
    assert.equal(tx.contests.find(row => row.id === id)?.ocdId, "ocd-division/country:us/state:tx/county:travis");
  }
  assert.equal(tx.measures.filter(row => row.contestId.startsWith("tx-ba01-2026-austin-proposition-")).length, 8);
  assert.ok(tx.contests.filter(row => row.id.startsWith("tx-ba01-2026-austin-proposition-")).every(row =>
    row.ocdId === "ocd-division/country:us/state:tx/place:austin"));
});

test("San Francisco countywide roster and exact ballot questions retain their source captures", () => {
  const ca = state("ca");
  assert.equal(ca.candidacies.filter(row => row.id.startsWith("ca-sf-2026-")).length, 19);
  assert.equal(ca.measures.filter(row => row.id.startsWith("ca-sf-2026-")).length, 11);
  assert.equal(ca.contests.find(row => row.id === "ca-sf-2026-board-education")?.voteFor, 3);
  const sources = JSON.parse(readFileSync("data/ballot/sources/ba-01/ca/sources.json", "utf8"));
  for (const row of sources) {
    assert.equal(captureSha256(readFileSync(`data/ballot/sources/ba-01/ca/${row.file}`)), row.textHash);
  }
  const text = readFileSync("data/ballot/sources/ba-01/ca/sf-ballot-questions.txt", "utf8").replace(/\s+/g, " ");
  for (const row of ca.measures.filter(row => /^ca-sf-2026-proposition-/.test(row.id))) assert.ok(text.includes(row.questionText), row.id);
});

test("Texas county certification keeps both major-party fields and reuses Travis identities", () => {
  const ballot = state("tx");
  const report = JSON.parse(readFileSync("data/ballot/reports/ba01-tx-counties.json", "utf8"));
  assert.equal(report.countyCount, 254);
  assert.equal(report.candidateContests, 1222);
  assert.equal(report.candidacies, 1346);
  const source = JSON.parse(readFileSync("data/ballot/sources/ba-01/tx/core-source.json", "utf8"));
  assert.equal(createHash("sha256").update(gunzipSync(readFileSync("data/ballot/sources/ba-01/tx/2026-ballot-cert.pdf.gz"))).digest("hex"), source.rawHash);
  const rows = ballot.contests.filter(row => row.id.startsWith("tx-ba01-2026-county-"));
  assert.equal(rows.length, 1210);
  for (const county of ["harris", "dallas", "tarrant", "bexar"]) {
    const judge = rows.find(row => row.ocdId === `ocd-division/country:us/state:tx/county:${county}` && row.title === "COUNTY JUDGE");
    assert.ok(judge, county);
    const candidates = ballot.candidacies.filter(row => row.contestId === judge.id);
    assert.ok(candidates.some(row => row.partyLabel === "REP"));
    assert.ok(candidates.some(row => row.partyLabel === "DEM"));
    assert.ok(candidates.every(row => JSON.stringify(Object.keys(row).sort()) === JSON.stringify(Object.keys(candidates[0]).sort())));
    assert.ok(candidates.every(row => row.provenance.sourceUrl === source.url && row.provenance.collectedAt === source.retrievedAt));
  }
  assert.equal(rows.filter(row => row.ocdId.endsWith("/county:travis")).length, 0, "existing sample records are reused");
  assert.ok(rows.every(row => !/PRECINCT|STATE REPRESENTATIVE|STATE SENATOR|U\. S\./.test(row.title)));
});
