import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { BallotWithDistrictMemberships } from "../lib/ballot/district-memberships.ts";

const root = new URL("../", import.meta.url);
const load = async (path: string) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const ks = Object.values((await load("data/ballot/2026-general/ks.json")).ballots)[0] as BallotWithDistrictMemberships;
const ms = Object.values((await load("data/ballot/2026-general/ms.json")).ballots)[0] as BallotWithDistrictMemberships;
const ksState = "ocd-division/country:us/state:ks";
const msState = "ocd-division/country:us/state:ms";
const addedKs = (set: BallotSet) => set.contests.filter(row => /^ks-ba01-2026-(district-court|magistrate)-/.test(row.id));
const addedMs = (set: BallotSet) => set.contests.filter(row => row.id.startsWith("ms-ba01-2026-"));

// These checks cover the actual reader-selection path, including negative
// cases where a judicial district spans counties but magistrate voters do not.
test("Kansas court routing distinguishes district voters from county magistrate voters", () => {
  assert.equal(addedKs(ks).length, 98);
  assert.equal(addedKs(ks).filter(row => row.type === "RETENTION").length, 56);
  assert.equal(ks.districtMemberships!.length, 78);
  for (const member of ks.districtMemberships!) {
    const selected = ballotForDivisions(ks, [member.memberOcdId]);
    const expected = ks.contests.filter(row => row.ocdId === member.districtOcdId).map(row => row.id).sort();
    assert.ok(expected.length > 0);
    assert.deepEqual(selected.contests.filter(row => row.ocdId === member.districtOcdId).map(row => row.id).sort(), expected);
  }
  const chase = ballotForDivisions(ks, [`${ksState}/county:chase`]);
  const lyon = ballotForDivisions(ks, [`${ksState}/county:lyon`]);
  assert.equal(addedKs(chase).length, 2);
  assert.equal(addedKs(lyon).length, 1);
  assert.ok(chase.contests.some(row => row.id === "ks-ba01-2026-magistrate-5-position-0"));
  assert.ok(!lyon.contests.some(row => row.id === "ks-ba01-2026-magistrate-5-position-0"));
  const trego = ballotForDivisions(ks, [`${ksState}/county:trego`]);
  const tregoRace = trego.contests.find(row => row.id === "ks-ba01-2026-magistrate-23-position-3")!;
  assert.ok(tregoRace);
  assert.deepEqual(trego.candidacies.filter(row => row.contestId === tregoRace.id).map(row => [row.givenName, row.familyName, row.partyLabel]).sort(), [
    ["Richard", "Hanks", "Democratic"], ["Travis", "Phillips", "Republican"],
  ]);
  assert.ok(!ballotForDivisions(ks, [`${ksState}/county:rooks`]).contests.some(row => row.id === tregoRace.id));
  assert.equal(ks.contests.find(row => row.id === "ks-ba01-2026-district-court-24-division-0")!.title, "District Court Judge, District 24");
});

test("Mississippi includes whole-county electorates and excludes partial-county electorates", () => {
  assert.equal(addedMs(ms).length, 95);
  assert.equal(ms.districtMemberships!.length, 139);
  for (const [county, races, names] of [
    ["harrison", 8, 10], ["jackson", 8, 12], ["rankin", 6, 10], ["pike", 4, 5],
    ["hinds", 1, 5], ["desoto", 9, 12], ["stone", 7, 9], ["lawrence", 5, 7],
  ] as const) {
    const selected = ballotForDivisions(ms, [`${msState}/county:${county}`]);
    const ids = new Set(addedMs(selected).map(row => row.id));
    assert.equal(ids.size, races, county);
    assert.equal(selected.candidacies.filter(row => ids.has(row.contestId)).length, names, county);
  }
  const hinds = ballotForDivisions(ms, [`${msState}/county:hinds`]);
  const da = hinds.contests.find(row => row.id === "ms-ba01-2026-district-attorney-7-special")!;
  assert.ok(da);
  assert.equal(hinds.candidacies.filter(row => row.contestId === da.id).length, 5);
  assert.ok(hinds.candidacies.filter(row => row.contestId === da.id).every(row => row.partyLabel === "Independent"));
  assert.ok(!hinds.contests.some(row => row.id.startsWith("ms-ba01-2026-circuit-7")));
  const pike = ballotForDivisions(ms, [`${msState}/county:pike`]);
  assert.deepEqual(pike.candidacies.filter(row => row.contestId === "ms-ba01-2026-circuit-6-3").map(row => row.familyName), ["David H. Strong Jr."]);
  for (const [set, state, foreign] of [[ks, ksState, `${msState}/county:jackson`], [ms, msState, `${ksState}/county:jackson`]] as const) {
    for (const divisions of [[state], [foreign]]) {
      assert.ok(!ballotForDivisions(set, divisions).contests.some(row => /^(ks|ms)-ba01-2026-(district-court|magistrate|chancery|circuit|appeals|district-attorney)-/.test(row.id)));
    }
  }
});

test("saved official geography captures and complete candidate pairs support the judicial batch", async () => {
  const evidence = "data/ballot/evidence/ba01-south/";
  for (const [body, receipt] of [
    ["ks-all-2026.html", "ks-all-2026.source.json"],
    ["ks-judicial/district-courts.html", "ks-judicial/district-courts.source.json"],
    ["ks-judicial/merit-selection.html", "ks-judicial/merit-selection.source.json"],
    ["ms-2026.pdf", "ms-2026.source.json"],
    ["ms-judicial/hinds-da-special.html", "ms-judicial/hinds-da-special.source.json"],
    ["ms-judicial/counties-2020.zip", "ms-judicial/counties-2020.source.json"],
    ["ms-judicial/chancery-2027.zip", "ms-judicial/chancery-2027.zip.source.json"],
    ["ms-judicial/circuit-2027.zip", "ms-judicial/circuit-2027.zip.source.json"],
    ["ms-judicial/court-appeals.zip", "ms-judicial/court-appeals.source.json"],
  ]) {
    const meta = await load(evidence + receipt);
    const raw = await readFile(new URL(evidence + body, root));
    assert.equal(meta.httpStatus, 200);
    assert.equal(createHash("sha256").update(raw).digest("hex"), meta.sha256, body);
  }
  const proof = await load(evidence + "ms-judicial/verified-electorates.json");
  assert.ok(proof.every((row: { symmetricDifferenceFraction?: number; countyUncoveredFractions?: Record<string, number> }) =>
    row.symmetricDifferenceFraction !== undefined ? row.symmetricDifferenceFraction < 1e-10 : Object.values(row.countyUncoveredFractions!).every(value => value < 1e-10)));
  const msIds = new Set(addedMs(ms).filter(row => !row.id.includes("district-attorney") && !row.id.includes("desoto-")).map(row => row.id));
  assert.equal(ms.candidacies.filter(row => msIds.has(row.contestId)).length, 119);
  for (const row of ms.candidacies.filter(row => msIds.has(row.contestId))) {
    assert.equal(row.partyLabel, "Nonpartisan");
    assert.equal(row.incumbent, null);
    assert.equal(row.websiteUrl, null);
    assert.ok(row.provenance.quote!.includes(row.familyName));
  }
});


test("DeSoto's countywide ballot exactly matches official Style 2 and retains the narrower gaps", async () => {
  const selected = ballotForDivisions(ms, [msState, `${msState}/cd:1`, `${msState}/county:desoto`]);
  assert.equal(selected.contests.length, 11);
  assert.equal(selected.candidacies.length, 18);
  for (const ident of ["ms-ba01-2026-chancery-17-place-1", "ms-ba01-2026-chancery-17-place-2",
    "ms-ba01-2026-circuit-21-place-1", "ms-ba01-2026-circuit-21-place-2", "ms-ba01-2026-circuit-21-place-3",
    "ms-ba01-2026-desoto-county-court-place-1", "ms-ba01-2026-desoto-county-attorney-special"]) {
    assert.ok(selected.contests.some(row => row.id === ident), ident);
  }
  assert.ok(!selected.contests.some(row => /(?:17-1|21-1|justice-court|school-board)/.test(row.id)));
  const evidence = "data/ballot/evidence/ba01-south/ms-desoto/";
  const receipt = await load(evidence + "ballot-styles.source.json");
  const raw = await readFile(new URL(evidence + "ballot-styles.pdf", root));
  assert.equal(createHash("sha256").update(raw).digest("hex"), receipt.sha256);
  assert.equal(receipt.sourceTexts.length, 8);
  for (const entry of receipt.sourceTexts) {
    const text = await readFile(new URL(evidence + entry.path, root), "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), entry.sha256);
  }
  const comparison = await load(evidence + "comparison.json");
  assert.deepEqual(comparison.official_styles.map((row: { style: number; officialContests: number; officialCandidates: number }) =>
    [row.style, row.officialContests, row.officialCandidates]), [[1, 12, 20], [2, 11, 18], [3, 13, 22], [4, 12, 20]]);
  assert.equal(comparison.official_styles[1].missing, null);
});

test("every imported Mississippi fact retains its exact source capture version", async () => {
  const packet = await load("data/ballot/2026-general/ms.json");
  const ballot = Object.values(packet.ballots)[0] as BallotWithDistrictMemberships;
  const receipts = packet.sourceReceipt.sources as { finalUrl: string; requestedUrl: string; retrievedAt: string; rawHash: string }[];
  const sample = await load("data/ballot/evidence/ba01-south/ms-2026.source.json");
  const captures = receipts.filter(row => row.finalUrl === sample.finalUrl && row.rawHash === sample.sha256);
  assert.ok(captures.some(row => row.retrievedAt === "2026-10-14T05:09:21.150Z"));
  assert.ok(captures.some(row => row.retrievedAt === sample.retrievedAt));
  for (const rows of [ballot.contests, ballot.candidacies, ballot.districtMemberships ?? []]) {
    for (const row of rows.filter(row => row.id.includes("-ba01-"))) {
      const source = row.provenance;
      assert.ok(receipts.some(receipt =>
        [receipt.finalUrl, receipt.requestedUrl].includes(source.sourceUrl ?? "") && receipt.retrievedAt === source.collectedAt), row.id);
    }
  }
});
