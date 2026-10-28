import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { censusWorkDivision } from "../lib/census-geography/division-id.ts";
import { containerOfRow, geographyOfRows, stateContainers, type ReadOnlyQuery, type Row } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { entryForCensusFixture } from "./helpers/place-map.ts";
import { statePeopleDivisions } from "../lib/sources/plural/acquisition.ts";
import { designationFromLabel, designationKey, indexDivisions, normalize, type PluralPerson, type RegistryDivisionLite } from "../lib/sources/plural/index.ts";
import { settleCoverageStateLegislators } from "../lib/registry/server.ts";
import { summarizeCoverage } from "../lib/registry/coverage.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import type { Division } from "../lib/registry/types.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

const NOW = "2026-10-12T12:00:00Z";
const SELECTION = { purpose: "representation" as const, asOf: NOW };

interface SourcePerson {
  id: string;
  name: string;
  state: string;
  chamber: string;
  district: string;
  party: string;
  startDate: string;
  sourceUrl: string;
}

interface Sample {
  row: Row & { type: "state_leg_upper" | "state_leg_lower"; geoid: string; label: string; state_abbr: string; ocd_id: null };
  match: "exact" | "numbered-seat" | "unassigned";
  people: SourcePerson[];
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/census-sld-2024-sample.json", import.meta.url), "utf8")) as {
  sources: { census: { versionId: string } };
  scopes: Row[];
  samples: Sample[];
  extras: (SourcePerson & { match: "jurisdiction-root" | "not-census-area" })[];
  coverageZip: { zip: string; geoid: string; overlap: { whole: boolean; zcta5: string; fraction: number } };
};

const states = [...new Set(fixture.samples.map(sample => sample.row.state_abbr))];
const sourcePeople = [...fixture.samples.flatMap(sample => sample.people), ...fixture.extras];

function jurisdiction(state: string): string {
  return `ocd-jurisdiction/country:us/${state === "dc" ? "district" : state === "pr" ? "territory" : "state"}:${state}/government`;
}

function person(source: SourcePerson): PluralPerson {
  return {
    id: source.id, name: source.name, state: source.state,
    current_chamber: source.chamber, current_district: source.district, current_party: source.party,
    roles: [{ type: source.chamber, district: source.district, current: true,
      jurisdiction: jurisdiction(source.state), ...(source.startDate ? { start_date: source.startDate } : {}) }],
    sourceUrl: source.sourceUrl,
    email: "", image: "", links: "", sources: source.sourceUrl,
    capitol_address: "", capitol_voice: "", district_address: "", district_voice: "",
  };
}

/** The same SQL row shape that stateContainers projects from the held pointer. */
const query: ReadOnlyQuery = async statements => {
  assert.equal(statements.length, 2);
  assert.match(statements[1]!.text, /g->>'stateAbbr' = \$4/);
  const state = statements[1]!.params[3];
  return [[{ version_id: fixture.sources.census.versionId }],
    [...fixture.scopes, ...fixture.samples.filter(sample => sample.row.state_abbr === state).map(sample => sample.row)]];
};

async function divisionsForAllSamples(): Promise<RegistryDivisionLite[]> {
  const all = await Promise.all(states.map(state => statePeopleDivisions(state, NOW, query)));
  return all.flatMap(slice => {
    assert.equal(slice.kind, "HELD");
    return slice.kind === "HELD" ? slice.value : [];
  });
}

test("the Census fixture retains real promoted labels, null OCD ids and the requested district encodings", () => {
  const geoids = new Set(fixture.samples.map(sample => sample.row.geoid));
  for (const geoid of ["25D05", "25D01", "25006", "25058", "50Y-6", "50CHS", "24028", "2401A", "2741A", "3804A", "0200B", "11002", "09ZZZ"]) {
    assert.ok(geoids.has(geoid), geoid);
  }
  for (const state of ["AZ", "TX", "NH", "MA", "VT", "MD", "MN", "ND", "AK", "DC", "WA", "WV", "DE", "CA", "ID", "PR", "CT"]) {
    assert.ok(states.includes(state), state);
  }
  assert.ok(fixture.samples.some(sample => /Belknap 01/.test(sample.row.label)));
  assert.ok(fixture.samples.some(sample => /Rockingham 02/.test(sample.row.label)));
  for (const sample of fixture.samples) {
    assert.equal(sample.row.ocd_id, null);
    assert.match(sample.row.label, /^[A-Z]{2} .*\(2024 plan\)$/);
    assert.equal(sample.people.length === 0, sample.match === "unassigned", sample.row.label);
  }
});

test("real Census labels and exact Open States district strings resolve to the same designation", () => {
  for (const sample of fixture.samples.filter(sample => sample.match === "exact")) {
    for (const member of sample.people) {
      assert.equal(designationFromLabel(sample.row.label), designationKey(member.district),
        `${sample.row.state_abbr} ${sample.row.geoid}: ${sample.row.label} / ${member.district}`);
    }
  }
  assert.equal(designationKey("Hampden, Hampshire and Worcester"), designationKey("Hampden-Hampshire-Worcester"));
  assert.equal(designationKey("Chittenden Southeast"), designationKey("Chittenden South East"));
  assert.equal(designationKey("Merrimack 08"), "MERRIMACK8");
  assert.equal(designationKey("Grand Isle"), "GRANDISLE", "AND is removed only as a whole word");
});

test("state acquisition derives the same district ids as the ZIP Census path and skips unassigned area", async () => {
  for (const state of states) {
    const census = await stateContainers(state, ["state_leg_upper", "state_leg_lower"], false, query);
    const held = await statePeopleDivisions(state, NOW, query);
    assert.equal(census.kind, "HELD");
    assert.equal(held.kind, "HELD");
    if (census.kind !== "HELD" || held.kind !== "HELD") continue;
    const expected = census.value.containers.map(container => censusWorkDivision(container.ref)).filter(id => id !== null);
    assert.deepEqual(held.value.map(division => division.ocdId), expected, state);
    const zip = "12345";
    const zipEntry = await entryForCensusFixture( { ...census,
      value: { ...census.value, known: true, containers: census.value.containers.map(container => ({
        ...container, overlaps: [{ zcta5: zip, whole: true, fraction: 1 }],
      })) } }, zip, SELECTION);
    assert.deepEqual(new Set(zipEntry.ids), new Set(expected), state);
  }
  assert.deepEqual((await statePeopleDivisions("CT", NOW, query)), {
    kind: "HELD", versionId: fixture.sources.census.versionId, value: [],
  });
});

test("unread and unpublished Census slices remain explicit acquisition results", async () => {
  const unread = await statePeopleDivisions("AZ", NOW, null);
  assert.equal(unread.kind, "UNREAD");
  const unpublished = await statePeopleDivisions("AZ", NOW, async () => [[], []]);
  assert.deepEqual(unpublished, { kind: "NOT_PUBLISHED" });
  const failed = await statePeopleDivisions("AZ", NOW, async () => { throw new Error("store unavailable"); });
  assert.equal(failed.kind, "UNREAD");
});

test("real district members link, while floterial and tribal seats retain distinct open work", async () => {
  const registry = await divisionsForAllSamples();
  const roster = normalize(sourcePeople.map(person), indexDivisions(registry), NOW, "US");
  assert.equal(roster.officeholders.length, sourcePeople.length);
  assert.equal(roster.divisions.length, sourcePeople.length - 2);
  for (const sample of fixture.samples.filter(sample => sample.match !== "unassigned")) {
    const container = containerOfRow(sample.row, false)!;
    const expected = censusWorkDivision(container.ref);
    for (const member of sample.people) {
      const holder = roster.officeholders.find(holder => holder.personId === `plural:${member.id.slice("ocd-person/".length)}`)!;
      assert.deepEqual(roster.divisions.filter(link => link.officeholderId === holder.id).map(link => link.ocdId), [expected],
        `${member.state} ${member.district}`);
    }
  }
  for (const member of fixture.extras.filter(member => member.match === "jurisdiction-root")) {
    const holder = roster.officeholders.find(holder => holder.personId === `plural:${member.id.slice("ocd-person/".length)}`)!;
    assert.deepEqual(roster.divisions.filter(link => link.officeholderId === holder.id).map(link => link.ocdId),
      [jurisdiction(member.state).replace("ocd-jurisdiction/", "ocd-division/").replace(/\/government$/, "")]);
  }
  assert.equal(roster.unmatched.length, 2);
  const reasons = fixture.extras.filter(member => member.match === "not-census-area").map(member => {
    const holder = roster.officeholders.find(holder => holder.personId === `plural:${member.id.slice("ocd-person/".length)}`)!;
    const reason = roster.unmatched.find(row => row.officeholderId === holder.id)!.reason;
    assert.match(reason, /area not in the Census district file/);
    assert.ok(reason.includes(member.district), reason);
    return reason;
  });
  assert.notEqual(reasons[0], reasons[1]);
});

test("numbered seat fallback respects a chamber's actual lettered districts", async () => {
  const index = indexDivisions(await divisionsForAllSamples());
  const id = fixture.samples.find(sample => sample.row.state_abbr === "ID" && sample.match === "numbered-seat")!;
  assert.deepEqual(id.people.map(member => member.district).sort(), ["1A", "1B"]);
  assert.equal(normalize(id.people.map(person), index, NOW, "US-ID").divisions.length, 2);
  const maryland = fixture.samples.find(sample => sample.row.state_abbr === "MD" && sample.row.type === "state_leg_lower" && sample.row.geoid === "24028")!;
  const unknownLetteredSeat = person({ ...maryland.people[0]!, district: "28A" });
  const unmatched = normalize([unknownLetteredSeat], index, NOW, "US-MD");
  assert.equal(unmatched.divisions.length, 0, "a missing Maryland subdistrict cannot fall back to an unsplit district");
  assert.equal(unmatched.unmatched.length, 1);
  const directlyIndexed = indexDivisions(await divisionsForAllSamples());
  directlyIndexed.set("id|lower|1A", "fixture:direct-lettered-division");
  const direct = normalize([person(id.people.find(member => member.district === "1A")!)], directlyIndexed, NOW, "US-ID");
  assert.deepEqual(direct.divisions.map(link => link.ocdId), ["fixture:direct-lettered-division"],
    "a direct lettered match takes precedence over numeric fallback");
});

test("at-large DC and PR legislators render as root seats without executives or federal senators", async () => {
  await installRegistryAuthority();
  const members = fixture.extras.filter(member => member.match === "jurisdiction-root");
  const roster = normalize(members.map(person), new Map(), NOW, "US");
  const officials = indexByDivision([roster]);
  const roots = ["dc", "pr"].map<Division>(state => {
    const ocdId = jurisdiction(state).replace("ocd-jurisdiction/", "ocd-division/").replace(/\/government$/, "");
    const seed = officials.get(ocdId)![0]!;
    officials.get(ocdId)!.push(
      { ...seed, id: `fixture:${state}:governor`, name: "Fixture Executive", officeTitle: "Governor", chamber: undefined, memberships: undefined },
      { ...seed, id: `fixture:${state}:us-senator`, name: "Fixture Federal Senator", officeTitle: "U.S. Senator", chamber: "senate", memberships: undefined },
    );
    return { ocdId, divisionType: state === "dc" ? "district" : "state", tier: "state", state: state.toUpperCase(),
      label: state === "dc" ? "District of Columbia" : "Puerto Rico", parentOcdId: "ocd-division/country:us",
      lsad: null, funcstat: null, classfp: null, geoid: null, canonicalOcdId: null, canonicalMatch: "none",
      sourceDataset: "DERIVED", provenance: { sourceUrl: "https://www.census.gov/", sourceOrg: "U.S. Census Bureau", collectedAt: NOW, verifiedAt: null } };
  });
  const coverage = summarizeCoverage([0, 0], [], new Map(roots.map(root => [root.ocdId, root])), [], 0, officials, roots);
  assert.equal(coverage.seats.length, 2);
  for (const root of roots) {
    const expected = members.filter(member => member.state === root.state?.toLowerCase()).map(member => member.name).sort();
    const seat = coverage.seats.find(seat => seat.ocdId === root.ocdId)!;
    assert.deepEqual(seat.representatives.map(holder => holder.name).sort(), expected);
    assert.ok(seat.representatives.every(holder => ["upper", "lower"].includes(holder.chamber ?? "")));
  }
  const dc = person(members.find(member => member.state === "dc" && member.district === "At-Large")!);
  const direct = normalize([dc], new Map([["dc|upper|ATLARGE", "fixture:direct-at-large-division"]]), NOW, "US-DC");
  assert.equal(direct.divisions[0]?.ocdId, "fixture:direct-at-large-division", "a direct match takes precedence over the jurisdiction root");
  const withoutJurisdiction = { ...dc, roles: dc.roles?.map(role => ({ ...role, jurisdiction: undefined })) };
  const unresolved = normalize([withoutJurisdiction], new Map(), NOW, "US-DC");
  assert.equal(unresolved.divisions.length, 0, "an at-large label alone establishes no jurisdiction root");
  assert.equal(unresolved.unmatched.length, 1);
});

test("coverage puts a real legislator under the ZIP-derived lower-chamber Census id", async () => {
  await installRegistryAuthority();
  const sample = fixture.samples.find(sample => sample.row.geoid === fixture.coverageZip.geoid && sample.row.type === "state_leg_lower")!;
  const census = geographyOfRows([...fixture.scopes, sample.row], false);
  const zip = fixture.coverageZip.zip;
  const entry = await entryForCensusFixture( {
    kind: "HELD", versionId: fixture.sources.census.versionId,
    value: { ...census, known: true, containers: census.containers.map(container => ({
      ...container, overlaps: [fixture.coverageZip.overlap],
    })) },
  }, zip, SELECTION);
  assert.deepEqual(entry.ids, ["ocd-division/country:us/state:md/sldl:28"]);
  const held = await statePeopleDivisions("MD", NOW, query);
  assert.equal(held.kind, "HELD");
  if (held.kind !== "HELD") return;
  const roster = normalize(sample.people.map(person), indexDivisions(held.value), NOW, "US-MD");
  const value: OfficialStateLegislatorReadModel = { formatVersion: 1, sourceId: "plural-openstates",
    jurisdiction: "US-MD", term: "2025-2026", generatedAt: NOW, roster };
  const division: Division = {
    ocdId: entry.ids[0]!, divisionType: "sldl", tier: "state", state: "MD", label: sample.row.label,
    parentOcdId: "ocd-division/country:us/state:md", lsad: null, funcstat: null, classfp: null,
    geoid: sample.row.geoid, canonicalOcdId: null, canonicalMatch: "none", canonicalGap: "UNDETERMINED",
    sourceDataset: "CENSUS_RELATIONSHIPS",
    provenance: { sourceUrl: "https://www.census.gov/", sourceOrg: "U.S. Census Bureau", collectedAt: NOW, verifiedAt: null },
  };
  const settled = await settleCoverageStateLegislators([division], new Map(), async scope => ({
    kind: "BOOTSTRAP", value, detail: "Held source fixture",
    metadata: { recordClass: "STATE_LEGISLATOR", scope, sourceId: value.sourceId, version: value.term,
      versionId: "fixture:state-legislator-census", lastKnownGoodVersionId: "fixture:state-legislator-census",
      sourceThrough: NOW, retrievedAt: NOW, promotedAt: null, stale: "CURRENT", staleAt: null },
  }));
  assert.deepEqual(settled.officials.get(entry.ids[0]!)?.map(holder => holder.name), sample.people.map(member => member.name));
  const coverage = summarizeCoverage([0, 0], [], new Map([[division.ocdId, division]]), [], 0,
    settled.officials, [division], null, settled.authorities);
  assert.equal(coverage.seats[0]?.ocdId, entry.ids[0]);
  assert.deepEqual(coverage.seats[0]?.representatives.map(holder => holder.name), sample.people.map(member => member.name));
});
