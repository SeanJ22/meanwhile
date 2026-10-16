import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HeldPlaceCapture } from "../lib/civic-data/held-place-capture.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import type { StuckRowLike } from "../lib/control-plane/admin-view/blocker-causes.ts";
import { districtLabelOf } from "../lib/control-plane/admin-view/district-label.ts";
import { readPlaceOwed, resolvePlaceKey, type PlaceOwedDeps } from "../lib/control-plane/admin-view/place-owed-read.ts";
import { scorePlace, type OwedRowLike } from "../lib/control-plane/admin-view/place-scorecard.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { parseV6PlaceKey } from "../lib/control-plane/admin-view/v6-hunts-read.ts";
import {
  districtDivisions, forgetNationalGeography, labelOfDivisionId, readStateDistricts, unionDivisions, zipDivisionIds, type DistrictInfo,
} from "../lib/control-plane/admin-view/v6-national-geography.ts";
import {
  ADMIN_V6_NATIONAL_CONTRACT, forgetNationalScores, nationalRows, nationalScopeOf, scoreTargets, scoresWithin, v6NationalSection,
  type NationalDeps, type NationalHuntSources,
} from "../lib/control-plane/admin-view/v6-national-read.ts";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import { buildCensusDistrictEdge } from "../lib/census-geography/state-publication.ts";
import type { BuiltDataset, BuiltGrouping, BuiltScope } from "../lib/census-geography/dataset.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import { CENSUS_GEO_RECORD_CLASS, censusGeographyScope } from "../lib/census-geography/publication.ts";

const NOW = "2026-10-01T18:00:00.000Z";
const AZ = "ocd-division/country:us/state:az";
const COUNTRY = "ocd-division/country:us";

const district = (geoid: string, zips: string[], state = "az"): DistrictInfo => ({
  state, geoid, label: districtLabelOf(state, geoid), placeKey: `geo:${state}.congressional_district.${geoid}`,
  divisionId: `${AZ}/cd:${Number(geoid.slice(2))}`, zips,
});
const D5 = district("0405", ["85201", "85202"]);
const D6 = district("0406", ["85635", "85122", "85123"]);

function hunt(zip: string, over: { type?: string; geoid?: string; state?: string; lifetime?: boolean; spent?: number } = {}): { decision: ExpansionScopeDecision; spent: number } {
  const type = over.type ?? "zcta", geoid = over.geoid ?? zip, state = over.state ?? "AZ";
  const key = `${type}:2020/${geoid}`;
  return { spent: over.spent ?? 0, decision: {
    key, receiptId: `r-${key}`, geography: { type, geoid, version: `${type}:2020`, label: `${type} ${geoid}`, stateAbbr: state },
    priority: 1, budgetUsd: 5, note: null, decidedAt: "2026-09-30T00:00:00.000Z", ...(over.lifetime === false ? {} : { budgetStartedAt: "2026-09-30T00:00:00.000Z" }),
  } as unknown as ExpansionScopeDecision };
}

function huntsOf(list: { decision: ExpansionScopeDecision; spent: number }[], published = true): NationalHuntSources {
  return {
    scopes: list.map((h) => h.decision), malformedScopes: 0,
    attribution: published ? { readAt: NOW, providers: [], hunts: list.map(({ decision, spent }) => ({
      key: decision.key, receiptId: decision.receiptId, label: "x", startedAt: decision.budgetStartedAt ?? "", budgetUsd: 5, anthropicUsd: spent, otherUsd: 0,
      anthropicKnownUsd: spent, otherKnownUsd: 0, knownCombinedUsd: spent, budgetConsumedKnownUsd: spent, budgetUnpriced: 0, reservedUsd: 0, availableUsd: 5 - spent, unpriced: 0 })) } as never : null,
  };
}

const stuckRow = (id: string, stateCode: string | null, zip: string | null = null): StuckRowLike => ({
  id, state: "FAILED", lane: null, owner: null, blocker: null, label: id, subjectName: null, stateCode, overdue: null, band: null,
  waitingSince: null, eligibleAt: null, lastActivityAt: null, nextAction: null, assignmentKeys: zip ? [`zcta:2020/${zip}`] : [],
});

const countsByState = new Map([["az", 420], ["nj", 600]]);

test("the country lists every state with its hunts, ZIPs worked of total, score and stuck, and a figure we lack is null", () => {
  const rows = nationalRows({
    scope: parseV6PlaceKey("us")!, hunts: huntsOf([hunt("85635", { spent: 1.25 }), hunt("85122"), hunt("07001", { state: "NJ" }), hunt("85001", { lifetime: false })]),
    stuck: [stuckRow("a", "az"), stuckRow("a", "az"), stuckRow("b", "az", "85635"), stuckRow("c", "nj")],
    zipCounts: countsByState, districts: null, scores: new Map([["st:az", 12.3], ["st:nj", null]]),
  });
  assert.equal(rows.length, 56);
  const az = rows.find((r) => r.placeKey === "st:az")!;
  assert.deepEqual([az.kind, az.parentKey, az.hunts, az.zipsWorked, az.zipsTotal, az.score, az.stuck, az.checklistItems],
    ["State", "us", 2, 1, 420, 12.3, 2, null], "a rolling-limit scope is not a hunt; the same stuck row listed twice counts once");
  const nj = rows.find((r) => r.placeKey === "st:nj")!;
  assert.deepEqual([nj.hunts, nj.zipsWorked, nj.zipsTotal, nj.score, nj.stuck], [1, 0, 600, null, 1]);
  const ak = rows.find((r) => r.placeKey === "st:ak")!;
  assert.deepEqual([ak.hunts, ak.zipsWorked, ak.zipsTotal, ak.score, ak.stuck], [0, 0, null, null, 0], "no hunt is zero, an unread ZIP total is null");
});

test("unread sources give null, never zero: no hunt list, no published accounting, no work index", () => {
  const unread = nationalRows({ scope: parseV6PlaceKey("us")!, hunts: { scopes: null, malformedScopes: 0, attribution: undefined }, stuck: null, zipCounts: null, districts: null, scores: new Map() });
  assert.ok(unread.every((r) => r.hunts === null && r.zipsWorked === null && r.zipsTotal === null && r.stuck === null && r.score === null));
  const noAccounting = nationalRows({ scope: parseV6PlaceKey("us")!, hunts: huntsOf([hunt("85635", { spent: 1 })], false), stuck: [], zipCounts: countsByState, districts: null, scores: new Map() });
  const az = noAccounting.find((r) => r.placeKey === "st:az")!;
  assert.equal(az.hunts, 1, "the hunt exists");
  assert.equal(az.zipsWorked, null, "whether it worked is unknown without its accounting");
  const malformed = nationalRows({ scope: parseV6PlaceKey("us")!, hunts: { ...huntsOf([hunt("85635")]), malformedScopes: 1 }, stuck: [], zipCounts: null, districts: null, scores: new Map() });
  assert.equal(malformed.find((r) => r.placeKey === "st:az")!.hunts, null);
});

test("a state lists its congressional districts as AZ-06 with ZIPs worked of total, a score and the stuck items in its ZIPs", () => {
  const rows = nationalRows({
    scope: parseV6PlaceKey("st:az")!,
    hunts: huntsOf([hunt("85635", { spent: 2 }), hunt("85122"), hunt("85201", { spent: 0.5 }), hunt("0406", { type: "congressional_district" }), hunt("07001", { state: "NJ" })]),
    stuck: [stuckRow("s1", "az", "85635"), stuckRow("s2", "az", "85122"), stuckRow("s3", "az"), stuckRow("s4", "az", "85201")],
    zipCounts: null, districts: [D5, D6], scores: new Map([[D6.placeKey, 41.6]]),
  });
  assert.deepEqual(rows.map((r) => r.name), ["AZ-05", "AZ-06"]);
  const six = rows[1];
  assert.deepEqual([six.kind, six.placeKey, six.parentKey, six.code], ["District", "geo:az.congressional_district.0406", "st:az", "AZ-06"]);
  assert.deepEqual([six.hunts, six.zipsWorked, six.zipsTotal, six.score, six.stuck], [3, 1, 3, 41.6, 2], "two ZIP hunts and the district's own hunt; one ZIP worked; two stuck ZIPs; the state-wide stuck row is not the district's");
  const five = rows[0];
  assert.deepEqual([five.hunts, five.zipsWorked, five.zipsTotal, five.score, five.stuck], [1, 1, 2, null, 1], "a district with no score yet shows null");
});

test("a district lists its ZIPs with the same columns", () => {
  const rows = nationalRows({
    scope: parseV6PlaceKey("geo:az.congressional_district.0406")!,
    hunts: huntsOf([hunt("85635", { spent: 3 }), hunt("85122")]),
    stuck: [stuckRow("s1", "az", "85635"), stuckRow("s2", "az", "85635")],
    zipCounts: null, districts: [D5, D6], scores: new Map([["geo:az.zcta.85635", 7.4]]),
  });
  assert.deepEqual(rows.map((r) => r.name), ["ZIP 85635", "ZIP 85122", "ZIP 85123"]);
  const [a, b, c] = rows;
  assert.deepEqual([a.kind, a.parentKey, a.placeKey, a.hunts, a.zipsWorked, a.zipsTotal, a.score, a.stuck], ["ZIP", D6.placeKey, "geo:az.zcta.85635", 1, 1, 1, 7.4, 2]);
  assert.deepEqual([b.hunts, b.zipsWorked, b.score, b.stuck], [1, 0, null, 0], "a hunt that has spent nothing has not worked the ZIP");
  assert.deepEqual([c.hunts, c.zipsWorked, c.zipsTotal], [0, 0, 1]);
});

test("a geography with no list here, or a district that is not published, has no rows", () => {
  assert.deepEqual(nationalRows({ scope: parseV6PlaceKey("geo:az.zcta.85635")!, hunts: huntsOf([]), stuck: [], zipCounts: null, districts: [D6], scores: new Map() }), []);
  assert.deepEqual(nationalRows({ scope: parseV6PlaceKey("geo:az.congressional_district.0499")!, hunts: huntsOf([]), stuck: [], zipCounts: null, districts: [D6], scores: new Map() }), []);
  assert.deepEqual(nationalRows({ scope: parseV6PlaceKey("st:az")!, hunts: huntsOf([]), stuck: [], zipCounts: null, districts: null, scores: new Map() }), []);
});

test("district names: AZ-06, and AL for a state with one seat or a delegate", () => {
  assert.equal(districtLabelOf("az", "0406"), "AZ-06");
  assert.equal(districtLabelOf("WY", "5600"), "WY-AL");
  assert.equal(districtLabelOf("dc", "1198"), "DC-AL");
  assert.equal(districtLabelOf("ca", "0652"), "CA-52");
});

test("a malformed or repeated scope is refused, never widened to the country", () => {
  const q = (s: string) => nationalScopeOf(new URLSearchParams(s));
  assert.deepEqual(q("scope=us"), { ok: true, scopeKey: "us", scope: { kind: "country" } });
  assert.equal(q("scope=geo:az.congressional_district.0406").ok, true);
  assert.deepEqual(q(""), { ok: false, code: "DUPLICATE_OR_MISSING_PARAMETER" });
  assert.deepEqual(q("scope=us&scope=st:az"), { ok: false, code: "DUPLICATE_OR_MISSING_PARAMETER" });
  assert.deepEqual(q("scope=us&x=1"), { ok: false, code: "UNKNOWN_PARAMETER" });
  for (const bad of ["geo:az.bogus.1", "body:example", "st:arizona", "geo:az.congressional_district.", "ST:AZ"]) assert.equal(q(`scope=${bad}`).ok, false, bad);
  assert.deepEqual(q("scope=geo:az.bogus.1"), { ok: false, code: "INVALID_SCOPE" });
});

const artifactDirectory = mkdtempSync(join(tmpdir(), "admin-national-census-"));
const artifactStore = new LocalFileArtifactStore(artifactDirectory);
const priorArtifactDirectory = process.env.WTP_READER_EDGE_DIR;
process.env.WTP_READER_EDGE_DIR = artifactDirectory;
after(() => {
  if (priorArtifactDirectory === undefined) delete process.env.WTP_READER_EDGE_DIR;
  else process.env.WTP_READER_EDGE_DIR = priorArtifactDirectory;
  rmSync(artifactDirectory, { recursive: true, force: true });
});
const fixtureDataset = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
const fixtureScope = fixtureDataset.scopes.find(scope => scope.type === "congressional_district")!;

function censusDataset(opts: { plans?: string[]; containers?: BuiltGrouping[] } = {}): BuiltDataset {
  const grouping = (geoid: string, zips: string[], extra: Partial<BuiltGrouping> = {}): BuiltGrouping => ({ geoid,
    ocdId: null, label: `AZ Congressional District ${Number(geoid.slice(2))} (119th Congress)`, stateFips: "04", stateAbbr: "AZ", memberStates: ["AZ"],
    overlaps: zips.map(zcta5 => ({ zcta5, whole: true, fraction: 1 })), ...extra });
  const groups = opts.containers ?? [grouping("0406", ["85635", "85122", "85635"]), grouping("0405", ["85201"]), grouping("04ZZ", ["85000"])];
  const scopes: BuiltScope[] = (opts.plans ?? ["cd:119"]).map(version => ({ ...fixtureScope, version,
    versionMeta: { ...fixtureScope.versionMeta, key: version }, groupings: structuredClone(groups), instanceCount: groups.length,
    zctaEdgeCount: groups.reduce((sum, group) => sum + group.overlaps.length, 0) }));
  return { ...fixtureDataset, scopes, zctaUniverse: [...new Set(groups.flatMap(group => group.overlaps.map(overlap => overlap.zcta5)))] };
}

function censusQuery(opts: { plans?: string[]; published?: boolean } = {}): { query: ReadOnlyQuery; calls: () => number } {
  let calls = 0;
  const index = buildCensusDistrictEdge(censusDataset(opts), "national-fixture", artifactStore);
  return { calls: () => calls, query: async statements => {
    calls += 1;
    assert.equal(statements.length, 1, "only the compact index is read from the canonical store");
    assert.equal(statements[0].params[0], CENSUS_GEO_RECORD_CLASS);
    assert.equal(statements[0].params[1], censusGeographyScope("AZ"));
    assert.match(statements[0].text, /^SELECT current_version_id AS version_id, payload FROM/);
    assert.match(statements[0].text, /payload->>'formatVersion' = '2'/);
    assert.doesNotMatch(statements[0].text, /jsonb_array_elements/);
    return opts.published === false ? [[]] : [[{ version_id: "cv-1", payload: await index }]];
  } };
}

test("a state's districts come from one read of the published Census lookup: ZIPs deduplicated, water and other states dropped", async () => {
  forgetNationalGeography();
  const mixed = censusDataset();
  const foreign = { ...structuredClone(mixed.scopes[0].groupings[0]), geoid: "0201", stateFips: "02", stateAbbr: "AK", memberStates: ["AK"] };
  await assert.rejects(buildCensusDistrictEdge(censusDataset({ containers: [...mixed.scopes[0].groupings, foreign] }), "mixed-state-fixture", artifactStore),
    /A Census publication contains exactly one state/);
  const { query, calls } = censusQuery();
  const read = await readStateDistricts("az", query);
  assert.ok(read.ok);
  if (!read.ok) return;
  assert.deepEqual(read.districts.map((d) => [d.label, d.geoid, d.divisionId, d.zips]), [
    ["AZ-05", "0405", `${AZ}/cd:5`, ["85201"]],
    ["AZ-06", "0406", `${AZ}/cd:6`, ["85122", "85635"]],
  ]);
  assert.equal(read.districts[1].placeKey, "geo:az.congressional_district.0406");
  await readStateDistricts("az", query);
  assert.equal(calls(), 1, "memoized for five minutes");
});

test("districts that cannot be read are a named gap: not published, two plans, or a failed read", async () => {
  forgetNationalGeography();
  const notPublished = await readStateDistricts("az", censusQuery({ published: false }).query);
  assert.deepEqual([notPublished.ok, !notPublished.ok && notPublished.code], [false, "DISTRICTS_NOT_PUBLISHED"]);
  const two = await readStateDistricts("az", censusQuery({ plans: ["cd:118", "cd:119"] }).query);
  assert.deepEqual([two.ok, !two.ok && two.code], [false, "DISTRICT_PLAN_AMBIGUOUS"]);
  const failed = await readStateDistricts("az", async () => { throw new Error("db down"); });
  assert.deepEqual([failed.ok, !failed.ok && failed.code], [false, "DISTRICTS_UNREAD"]);
  assert.equal(forgetNationalGeography(), undefined);
});

test("a district's divisions are the union over every one of its ZIPs, plus the district, its state and the country, each once", async () => {
  const byZip = new Map([["85635", [`${AZ}/county:cochise`, `${AZ}/place:sierra_vista`]], ["85122", [`${AZ}/county:pinal`, `${AZ}/county:cochise`]], ["85123", []]]);
  const read: string[] = [];
  const ids = await zipDivisionIds(D6.zips, async (zip) => { read.push(zip); return byZip.get(zip) ?? null; });
  assert.deepEqual([...read].sort(), ["85122", "85123", "85635"]);
  const union = await districtDivisions(D6, ids);
  assert.deepEqual(union.map((d) => d.id), [COUNTRY, AZ, D6.divisionId, `${AZ}/county:cochise`, `${AZ}/place:sierra_vista`, `${AZ}/county:pinal`]);
  assert.equal(new Set(union.map((d) => d.id)).size, union.length);
  assert.deepEqual(union.map((d) => d.label).slice(0, 3), ["United States", "AZ", "AZ-06"]);
  assert.equal(labelOfDivisionId(`${AZ}/county:cochise`), "Cochise County");
  assert.equal(labelOfDivisionId(`${AZ}/county:cochise/place:bisbee_ccd`), "Bisbee Ccd");
  assert.equal(unionDivisions([[`${AZ}/county:a`], [`${AZ}/county:a`]], []).length, 1);
});

test("a congressional district is a place with an owed list, read from held data once over the union of its divisions", async () => {
  assert.deepEqual(resolvePlaceKey("geo:az.congressional_district.0406"), { kind: "district", geoid: "0406", state: "az" });
  for (const bad of ["geo:az.congressional_district.06", "geo:az.congressional_district.04xx", "geo:az.cbsa.38060", "us"]) {
    const r = resolvePlaceKey(bad);
    assert.ok("says" in r && r.state === "REFUSED", bad);
  }
  const divisions = [{ id: COUNTRY, label: "United States" }, { id: AZ, label: "AZ" }, { id: D6.divisionId, label: "AZ-06" }, { id: `${AZ}/county:cochise`, label: "Cochise County" }];
  let resolved = 0, heldCalls = 0, heldIds: readonly string[] = [];
  const deps: PlaceOwedDeps = {
    now: () => NOW,
    resolveDivisions: async (place) => { resolved += 1; assert.equal(place.kind, "district"); return { label: "AZ-06", covers: "x", divisions }; },
    readHeld: async (ids) => { heldCalls += 1; heldIds = ids; return { subjects: [], held: [] }; },
  };
  const read = await readPlaceOwed("geo:az.congressional_district.0406", deps, { fresh: true });
  assert.equal(read.state, "READ");
  assert.deepEqual([resolved, heldCalls], [1, 1], "one resolution, one read of held data");
  assert.deepEqual([...heldIds], divisions.map((d) => d.id));
  if (read.state !== "READ") return;
  assert.equal(read.label, "AZ-06");
  assert.ok(read.rows.length > 0 && read.rows.every((r) => r.state === "missing"), "nothing held is still owed, never an empty place");
  await readPlaceOwed("geo:az.congressional_district.0406", deps);
  assert.equal(heldCalls, 1, "memoized like every other place");
});

test("the district place offers no send: the fleet's registry names governments, so a send would widen to the state", async () => {
  const { placeSendWords } = await import("../lib/control-plane/admin-view/v6-place-section.ts");
  assert.equal(placeSendWords("geo:az.congressional_district.0406", "AZ-06", []), null);
  assert.equal(placeSendWords("st:az", "Arizona"), "Deploy fleet to Arizona");
});

const held: HeldPlaceCapture = {
  subjects: [
    { id: "body-cochise", kind: "body", divisionIds: [`${AZ}/county:cochise`], label: "Cochise Board" },
    { id: "body-pinal", kind: "body", divisionIds: [`${AZ}/county:pinal`], label: "Pinal Board" },
    { id: "body-other", kind: "body", divisionIds: [`${AZ}/county:maricopa`], label: "Maricopa Board" },
  ],
  held: [
    { subjectId: "body-cochise", checklistId: "GOV-01", state: "published", sourceUrl: "https://a.gov", checkedAt: "2026-09-30T00:00:00.000Z", freshUntil: "2026-12-30T00:00:00.000Z", value: {} },
    { subjectId: "body-pinal", checklistId: "GOV-01", state: "held", sourceUrl: "https://b.gov", checkedAt: "2026-09-30T00:00:00.000Z", freshUntil: "2026-12-30T00:00:00.000Z", value: {} },
  ],
};
const targetOf = (d: DistrictInfo, ids: string[]) => ({ placeKey: d.placeKey, divisions: unionDivisions([ids], [{ id: COUNTRY, label: "United States" }, { id: AZ, label: "AZ" }, { id: d.divisionId, label: d.label }]) });

test("every row's score comes from one read of held data, and equals what that place's own owed list scores", async () => {
  let calls = 0, ids: readonly string[] = [];
  const deps = { now: () => NOW, readHeld: async (wanted: readonly string[]) => { calls += 1; ids = wanted; return held; } };
  const t6 = targetOf(D6, [`${AZ}/county:cochise`]), t5 = targetOf(D5, [`${AZ}/county:nowhere`]);
  const scores = await scoreTargets([t5, t6], deps);
  assert.equal(calls, 1, "not once per district, not once per ZIP");
  assert.equal(new Set(ids).size, ids.length);
  for (const t of [t5, t6]) {
    const alone = scorePlace(buildPlaceOwedList({ divisions: t.divisions, subjects: held.subjects, held: held.held, now: NOW }) as readonly OwedRowLike[], {}, []).measures.completeness.percent;
    assert.equal(scores.get(t.placeKey), alone, `${t.placeKey} matches a read of that place alone`);
  }
  assert.ok((scores.get(t6.placeKey) ?? 0) > (scores.get(t5.placeKey) ?? 0), "a place that holds more scores higher");
  assert.equal((await scoreTargets([], deps)).size, 0);
  assert.equal(calls, 1, "no targets, no read");
});

test("scores never hold the list back: not ready inside the budget is null scores and a response, and the next read has them", async () => {
  forgetNationalScores();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const deps = { now: () => NOW, readHeld: async () => { calls += 1; await gate; return held; } };
  const t = targetOf(D6, [`${AZ}/county:cochise`]);
  const first = await scoresWithin("k1", async () => [t], deps, 5);
  assert.deepEqual([first.ready, first.scores.size], [false, 0]);
  const second = await scoresWithin("k1", async () => [t], deps, 5);
  assert.equal(second.ready, false);
  assert.equal(calls, 1, "a second request joins the read already in flight");
  release();
  const third = await scoresWithin("k1", async () => [t], deps, 5_000);
  assert.equal(third.ready, true);
  assert.ok(typeof third.scores.get(t.placeKey) === "number");
  const again = await scoresWithin("k1", async () => { throw new Error("must not rebuild"); }, deps, 5);
  assert.equal(again.ready, true, "memoized");
  assert.equal(calls, 1);
});

test("a failed read of held data is null scores and a response; it is not remembered", async () => {
  forgetNationalScores();
  let calls = 0;
  const failing = { now: () => NOW, readHeld: async () => { calls += 1; throw new Error("db down"); } };
  const t = targetOf(D6, [`${AZ}/county:cochise`]);
  assert.deepEqual((await scoresWithin("k2", async () => [t], failing, 1_000)).ready, false);
  assert.deepEqual((await scoresWithin("k2", async () => [t], failing, 1_000)).ready, false);
  assert.equal(calls, 2, "tried again, not cached as a result");
});

function deps(over: Partial<NationalDeps> = {}): NationalDeps & { reads: { held: number; districts: number } } {
  const reads = { held: 0, districts: 0 };
  return { reads, now: () => NOW, scoreBudgetMs: 2_000,
    districts: async (state) => { reads.districts += 1; return state === "az" ? { ok: true, versionId: "cv-1", districts: [D5, D6] } : { ok: true, versionId: "cv-1", districts: [] }; },
    zipCounts: async () => countsByState,
    zipDivisions: async (zips) => new Map(zips.map((z) => [z, [`${AZ}/county:${z === "85635" ? "cochise" : "pinal"}`]] as const)),
    readHeld: async () => { reads.held += 1; return held; },
    ...over };
}

test("the country section is the contract envelope with 56 rows and one read of held data for the whole list", async () => {
  forgetNationalScores();
  const d = deps();
  const out = await v6NationalSection({ scopeKey: "us", scope: parseV6PlaceKey("us")!, sources: { hunts: huntsOf([hunt("85635", { spent: 1 })]), stuck: [stuckRow("a", "az")] }, deps: d });
  assert.ok(!("kind" in out));
  if ("kind" in out) return;
  assert.equal(out.contract, ADMIN_V6_NATIONAL_CONTRACT);
  assert.equal(out.contract, "admin-v6/national@1");
  assert.equal(out.scope, "us");
  assert.equal(out.data.length, 56);
  assert.equal(d.reads.held, 1);
  assert.equal(d.reads.districts, 0, "the country needs no district list");
  assert.deepEqual(out.missingParts, []);
  assert.match(out.revision, /^national:[0-9a-f]{24}$/);
  const az = out.data.find((r) => r.placeKey === "st:az")!;
  assert.deepEqual([az.hunts, az.zipsWorked, az.zipsTotal, az.stuck], [1, 1, 420, 1]);
  assert.ok(typeof az.score === "number", "the state has a score from the same single read");
});

test("a state section lists its districts, and scores arrive from one read for all of them", async () => {
  forgetNationalScores();
  const d = deps();
  const out = await v6NationalSection({ scopeKey: "st:az", scope: parseV6PlaceKey("st:az")!, sources: { hunts: huntsOf([hunt("85635", { spent: 1 })]), stuck: [stuckRow("a", "az", "85635")] }, deps: d });
  assert.ok(!("kind" in out));
  if ("kind" in out) return;
  assert.deepEqual(out.data.map((r) => r.name), ["AZ-05", "AZ-06"]);
  assert.equal(d.reads.held, 1);
  assert.deepEqual(out.data.map((r) => r.zipsTotal), [2, 3]);
  assert.ok(out.data.every((r) => typeof r.score === "number"));
  assert.equal(out.data[1].stuck, 1);
});

test("a district section lists its ZIPs; a score that is not ready is null and the response still arrives", async () => {
  forgetNationalScores();
  const slow = deps({ scoreBudgetMs: 1, readHeld: async () => { await new Promise((r) => setTimeout(r, 40)); return held; } });
  const out = await v6NationalSection({ scopeKey: D6.placeKey, scope: parseV6PlaceKey(D6.placeKey)!, sources: { hunts: huntsOf([]), stuck: [] }, deps: slow });
  assert.ok(!("kind" in out));
  if ("kind" in out) return;
  assert.deepEqual(out.data.map((r) => r.name), ["ZIP 85635", "ZIP 85122", "ZIP 85123"]);
  assert.ok(out.data.every((r) => r.score === null));
  assert.deepEqual(out.missingParts, ["Place scores are still being read."]);
});

test("districts that cannot be read are a refusal, not a state with no districts; other geographies get an empty list", async () => {
  forgetNationalScores();
  const refused = await v6NationalSection({ scopeKey: "st:az", scope: parseV6PlaceKey("st:az")!, sources: { hunts: huntsOf([]), stuck: [] },
    deps: deps({ districts: async () => ({ ok: false, code: "DISTRICTS_UNREAD", says: "The Census geography for AZ could not be read" }) }) });
  assert.deepEqual(refused, { kind: "refused", status: 503, code: "DISTRICTS_UNREAD", says: "The Census geography for AZ could not be read" });
  const ambiguous = await v6NationalSection({ scopeKey: "st:az", scope: parseV6PlaceKey("st:az")!, sources: { hunts: huntsOf([]), stuck: [] },
    deps: deps({ districts: async () => ({ ok: false, code: "DISTRICT_PLAN_AMBIGUOUS", says: "two plans" }) }) });
  assert.ok("kind" in ambiguous && ambiguous.status === 409);
  const d = deps();
  const zip = await v6NationalSection({ scopeKey: "geo:az.zcta.85635", scope: parseV6PlaceKey("geo:az.zcta.85635")!, sources: { hunts: huntsOf([]), stuck: [] }, deps: d });
  assert.ok(!("kind" in zip) && zip.data.length === 0);
  assert.deepEqual([d.reads.districts, d.reads.held], [0, 0], "a ZIP scope reads nothing");
});

test("sources that were not read are said once and shown as unknown", async () => {
  forgetNationalScores();
  const out = await v6NationalSection({ scopeKey: "us", scope: parseV6PlaceKey("us")!, sources: { hunts: { scopes: null, malformedScopes: 0, attribution: undefined }, stuck: null },
    deps: deps({ zipCounts: async () => null, readHeld: async () => { throw new Error("db down"); } }) });
  assert.ok(!("kind" in out));
  if ("kind" in out) return;
  assert.equal(out.data.length, 56, "the list still arrives");
  assert.ok(out.data.every((r) => r.hunts === null && r.stuck === null && r.zipsTotal === null && r.score === null));
  assert.equal(out.missingParts.length, 4);
});
