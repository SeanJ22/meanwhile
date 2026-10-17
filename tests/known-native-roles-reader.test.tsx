import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { stringify } from "yaml";
import { yamlToPeople, normalize } from "../lib/sources/plural/index.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { allSeatHolders, seatHoldersForDivision, seatHoldersForOffice, settleCoverageStateLegislators } from "../lib/registry/server.ts";
import { summarizeCoverage } from "../lib/registry/coverage.ts";
import { namedOfficeholders, readerOfficeholders } from "../lib/ask/server-sources.ts";
import { composeReaderOfficials, readerOfficialsQuestion, stateDivisionsOf } from "../lib/ask/reader-officials.ts";
import { GET as representation } from "../app/api/representation/[...division]/route.ts";
import { CoverageNotice } from "../components/map/coverage-notice.tsx";
import { DataProvider, type ShellData } from "../lib/state/data.tsx";
import { scopedHolders } from "../lib/officials/scoped-holders.ts";
import { groupOfficials } from "../lib/officials/tier-grouping.ts";
import { registryRuntimeProjectionIssues } from "../lib/registry/runtime-data-plane.ts";
import { withoutPlaceholderBodies } from "../lib/registry/census-placeholders.ts";
import { currentBodyRosters, rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { registryTransferImport, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";
import type { Division } from "../lib/registry/types.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

function stateRegistryArtifacts(versionId: string, states: readonly string[], value: RegistryRuntimeReadModel = registryTransferImport().projection.payload) {
  return Object.fromEntries(states.map(state => [state, { versionId: `${versionId}:${state}`, value: { kind: "PROMOTED_POINTERS" as const,
    entries: [provenEdgeEntry({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state), sourceId: "registry-reviewed-bindings",
      versionId: `${versionId}:${state}`, value: registryFixtureForState(state, value) })] } }]));
}


const NOW = "2026-10-09T18:00:00Z";
const STATE = "ocd-division/country:us/state:oh";
const PLACE = `${STATE}/place:example_city`;
const OTHER = `${STATE}/place:another_city`;
const source = (name: string) => `https://raw.githubusercontent.com/openstates/people/${"a".repeat(40)}/data/oh/${name}.yml`;

function fixture(dualRole = false): OfficialStateLegislatorReadModel {
  const rows = [
    { id: "00000000-0000-0000-0000-000000000001", name: "Morgan Governor", type: "governor", division: STATE },
    { id: "00000000-0000-0000-0000-000000000002", name: "Taylor Mayor", type: "mayor", division: PLACE },
    { id: "00000000-0000-0000-0000-000000000003", name: "Other Mayor", type: "mayor", division: OTHER },
    { id: "00000000-0000-0000-0000-000000000004", name: "Former Mayor", type: "mayor", division: PLACE, end: "2025-12-31" },
  ];
  const people = rows.flatMap(row => yamlToPeople(stringify({ id: `ocd-person/${row.id}`, name: row.name,
    roles: [{ type: row.type, jurisdiction: row.division.replace("ocd-division/", "ocd-jurisdiction/") + "/government",
      start_date: "2023-01-01", end_date: row.end ?? "2027-12-31" },
      ...(dualRole && row.name === "Taylor Mayor" ? [{ type: "councilmember",
        jurisdiction: PLACE.replace("ocd-division/", "ocd-jurisdiction/") + "/government",
        start_date: "2023-01-01", end_date: "2027-12-31" }] : [])],
    offices: [{ classification: "primary", voice: "555-0100", address: "1 Government Plaza" }],
    links: [{ url: "https://example.gov/profile" }], sources: [{ url: "https://example.gov/profile" }],
  }), "oh", source(row.id), NOW));
  return { formatVersion: 1, sourceId: "plural-openstates", jurisdiction: "US-OH", term: "a".repeat(40),
    generatedAt: NOW, roster: normalize(people, new Map(), NOW, "US-OH") };
}

function edge(value: OfficialStateLegislatorReadModel) {
  return { edgeOnly: true as const, stateLegislators: { load: async (scope: string) => {
    assert.equal(scope, "US-OH", "a local reader loads only its state's known people");
    return { value, versionId: "fixture:native-roles" };
  } } };
}

test("known governor and mayor reach real division routes and Ask without registry, federal or finance holdings", async () => {
  const value = fixture();
  assert.equal(value.roster.officeholders.length, 3, "expired membership does not become a current officeholder");
  await withReaderAuthorityEdge(edge(value), async () => {
    assert.deepEqual((await seatHoldersForOffice(STATE, "Governor")).map(row => row.name), ["Morgan Governor"]);
    assert.deepEqual((await seatHoldersForDivision(PLACE)).map(row => row.name), ["Taylor Mayor"]);
    const response = await representation(new Request(`https://example.test/api/representation/${PLACE}`), {
      params: Promise.resolve({ division: PLACE.split("/") }),
    });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.holderStatus, "HELD");
    assert.deepEqual(body.holders.map((row: SeatHolder) => row.name), ["Taylor Mayor"]);
    assert.equal(body.metadataStatus, "HOLDING_UNAVAILABLE");
    const held = await readerOfficeholders([PLACE]);
    assert.deepEqual(held.seats.map(row => row.name).sort(), ["Morgan Governor", "Taylor Mayor"]);
    for (const [question, expected] of [["Who is my governor?", "Morgan Governor"], ["Who is my mayor?", "Taylor Mayor"]]) {
      const ask = readerOfficialsQuestion(question)!;
      const answer = composeReaderOfficials({ ask, held: held.held, holdingFailed: held.loaderFailures > 0 });
      assert.ok(answer?.answer.includes(expected));
      assert.ok(answer?.citedUrls.some(url => url.startsWith("https://raw.githubusercontent.com/openstates/people/")));
      assert.ok(!answer?.answer.includes("Other Mayor") && !answer?.answer.includes("Former Mayor"));
    }
    assert.deepEqual((await namedOfficeholders("Tell me about Taylor Mayor", [], [PLACE])).map(row => row.name), ["Taylor Mayor"]);
    assert.equal((await allSeatHolders([PLACE])).length, 3, "named-person lookup can use the held state roster without claiming each person governs this place");
  });
});

test("the first coverage read renders known local and state people with no legislative roster or invented body", async () => {
  await installRegistryAuthority();
  const value = fixture();
  const place: Division = { ocdId: PLACE, label: "Example City", divisionType: "place", tier: "local", geoid: "3912345",
    state: "OH", lsad: null, parentOcdId: STATE, funcstat: "A", classfp: "C1", canonicalOcdId: PLACE,
    canonicalMatch: "exact", sourceDataset: "TIGER_GENZ2025",
    provenance: { sourceUrl: "https://census.gov", sourceOrg: "Census fixture", collectedAt: NOW, verifiedAt: null } };
  const settled = await settleCoverageStateLegislators([place], new Map(), async scope => ({ kind: "BOOTSTRAP", value,
    detail: "Held fixture", metadata: { recordClass: "STATE_LEGISLATOR", scope, sourceId: value.sourceId, version: null,
      versionId: "native-roles", lastKnownGoodVersionId: "native-roles", sourceThrough: NOW, retrievedAt: NOW,
      promotedAt: null, stale: "CURRENT", staleAt: null } }));
  const coverage = summarizeCoverage([0, 0], [], new Map([[PLACE, place]]), [], 0, settled.officials, [place], null, settled.authorities);
  assert.deepEqual(coverage.bodies, [], "a people source does not invent body membership");
  assert.equal(coverage.unincorporated, false, "an absent body row does not negate the known municipal office");
  assert.deepEqual(coverage.statewideExecutives.map(row => row.name), ["Morgan Governor"]);
  assert.deepEqual(coverage.seats.flatMap(row => row.representatives.map(holder => holder.name)), ["Taylor Mayor"]);
  const data: ShellData = { allMeetings: [], meetings: [], venues: [], result: null, location: null, drawnDistricts: [],
    dropped: 0, searchFailed: false, atAddress: false, governing: null, zipPartial: null, basis: "ZIP" };
  const html = renderToStaticMarkup(<DataProvider value={data}><CoverageNotice tier="none" zip="43215" coverage={coverage} /></DataProvider>);
  assert.match(html, /Morgan Governor/); assert.match(html, /Taylor Mayor/);
  assert.doesNotMatch(html, /Other Mayor|Former Mayor/);
  assert.doesNotMatch(html, /no mayor or city council/);
  const statistical = { ...place, funcstat: "S", classfp: "U1" };
  const summary = (division: Division, officials = settled.officials) => summarizeCoverage([0, 0], [],
    new Map([[PLACE, division]]), [], 0, officials, [division], null);
  assert.equal(summary(statistical).unincorporated, false, "held municipal people prevent a contradictory negative claim");
  assert.equal(summary(statistical, new Map()).unincorporated, true, "positive statistical evidence still supports the existing absence statement");
  assert.equal(summary({ ...place, funcstat: null, classfp: null, lsad: null }, new Map()).unincorporated, false,
    "unknown municipal structure is a gap, not evidence that no mayor exists");
  await withReaderAuthorityEdge(edge(fixture(true)), async () => {
    const local = await seatHoldersForDivision(PLACE);
    assert.deepEqual(local.map(row => row.officeTitle).sort(), ["Councilmember", "Mayor"]);
    const dualCoverage = { ...coverage, seats: coverage.seats.map(seat => ({ ...seat, representatives: local })) };
    const dualHtml = renderToStaticMarkup(<DataProvider value={data}><CoverageNotice tier="none" zip="43215" coverage={dualCoverage} /></DataProvider>);
    assert.match(dualHtml, />Mayor<\/span>/);
    assert.match(dualHtml, />Council member<\/span>/);
    assert.equal(dualHtml.split("Taylor Mayor").length - 1, 2, "each current role remains visible with its own title");
  });
});

test("an exact official office holder takes precedence without joining names or removing other council seats", async () => {
  const value = fixture();
  const { projection } = registryTransferImport();
  const official = { ...projection.payload.statewideExecutives[0], stateOcdId: STATE,
    holder: { ...projection.payload.statewideExecutives[0].holder, id: "official:oh-governor", name: "Official Governor", officeTitle: "Governor", photoUrl: null } };
  const bridge = projection.payload.officialCandidacies.rows.find(row => row.holder.id === projection.payload.statewideExecutives[0].holder.id)!;
  const registry = {
    ...projection.payload, statewideExecutives: [...projection.payload.statewideExecutives, official],
    registry: withoutPlaceholderBodies(projection.payload.registry),
    officialCandidacies: { ...projection.payload.officialCandidacies, rows: [...projection.payload.officialCandidacies.rows,
      { ...bridge, holder: { ...bridge.holder, id: official.holder.id, name: official.holder.name,
        officeTitle: official.holder.officeTitle, divisions: [STATE] }, status: "NO_APPLICABLE_CANDIDACY" as const,
        candidacy: null, unresolvedCandidacyIds: [] }], },
  };
  assert.deepEqual(registryRuntimeProjectionIssues(registry), [], "the competing authority is a valid reader projection");
  const artifacts = stateRegistryArtifacts("fixture:official", ["OH"], registry);
  await withReaderAuthorityEdge({ ...edge(value), selection: { states: ["OH"], keys: new Set([STATE, PLACE]) },
    stateAuthorities: { families: new Set(["registry-runtime"] as const), load: async (family, state) =>
      family === "registry-runtime" && state === "OH" ? artifacts.OH.value : null } }, async () => {
    assert.deepEqual((await seatHoldersForOffice(STATE, "Governor")).map(row => row.name), ["Official Governor"]);
    const all = await allSeatHolders([PLACE]);
    assert.ok(all.some(row => row.name === "Official Governor"));
    assert.ok(!all.some(row => row.name === "Morgan Governor"));
    const holder = (await seatHoldersForDivision(PLACE))[0];
    const first = { ...holder, id: "council:one", officeTitle: "Councilmember" };
    const second = { ...first, id: "council:two", personId: "another-native-person", nativeIds: undefined };
    assert.equal(scopedHolders([first], [second]).length, 2, "a multi-seat office is not a person identity");
  });
});

test("coverage gives the exact official mayor precedence over a conflicting bulk office record", async () => {
  await installRegistryAuthority();
  const roster = currentBodyRosters().find(row => /\/place:[^/]+#governing$/.test(row.bodyId) &&
    row.members.some(member => member.officeTitle === "Mayor"))!;
  assert.ok(roster, "fixture has a directly sourced municipal mayor");
  const divisionId = roster.bodyId.split("#")[0];
  const division = registryTransferImport().projection.payload.registry.divisions.find(row => row.ocdId === divisionId)!;
  const official = rosterHoldersForBody(roster.bodyId).find(row => row.officeTitle === "Mayor")!;
  const bulk = { ...official, id: "plural:fixture:old-mayor", personId: "plural:fixture:old-mayor", name: "Superseded Bulk Mayor" };
  const coverage = summarizeCoverage([0, 0], [], new Map([[divisionId, division]]), [], 0,
    new Map([[divisionId, [bulk]]]), [division], null);
  const mayors = coverage.seats.flatMap(row => row.representatives).filter(row => row.officeTitle === "Mayor");
  assert.deepEqual(mayors.map(row => row.id), [official.id]);
});

test("captured county mayors and district executives reach exact routes, first coverage and Ask without invented bodies", async () => {
  await installRegistryAuthority();
  const captured = JSON.parse(readFileSync(new URL("./fixtures/plural/held-native-edge-cases.json", import.meta.url), "utf8")) as {
    scope: string; source_url: string; body: string;
  }[];
  const models = new Map<string, OfficialStateLegislatorReadModel>();
  for (const jurisdiction of new Set(captured.map(row => row.scope.split(":")[0] as `US-${string}`))) {
    const native = captured.filter(row => row.scope.startsWith(`${jurisdiction}:`)).flatMap(row =>
      yamlToPeople(row.body, jurisdiction.slice(3).toLowerCase(), row.source_url, NOW));
    models.set(jurisdiction, { formatVersion: 1, sourceId: "plural-openstates", jurisdiction,
      term: "d5cc49a9e5bc70e22f0ab0273842973fc1b144fa", generatedAt: NOW,
      roster: normalize(native, new Map(), NOW, jurisdiction) });
  }
  const dc = "ocd-division/country:us/district:dc";
  assert.deepEqual(stateDivisionsOf([`${dc}/ward:1`, "ocd-division/country:us/territory:pr/sldl:1"]),
    [dc, "ocd-division/country:us/territory:pr"]);
  const cases = [
    { scope: "US-HI", id: "ocd-division/country:us/state:hi/county:honolulu", type: "county", name: "Rick Blangiardi", title: "Mayor", question: "Who is my county mayor?" },
    { scope: "US-HI", id: "ocd-division/country:us/state:hi/county:kauai", type: "county", name: "Derek S.K. Kawakami", title: "Mayor", question: "Who is my mayor?" },
    { scope: "US-DC", id: dc, type: "state", name: "Muriel Bowser", title: "Mayor", question: "Who is my mayor?" },
    { scope: "US-DE", id: "ocd-division/country:us/state:de", type: "state", name: "Anthony Albence", title: "Chief Election Officer", question: "Who is my chief election officer?" },
    { scope: "US-PR", id: "ocd-division/country:us/territory:pr", type: "state", name: "Francisco Rosado Colomer", title: "Chief Election Officer", question: "Who is my chief election officer?" },
  ];
  const authority = { edgeOnly: true as const, stateLegislators: { load: async (scope: string) => {
    const value = models.get(scope);
    return value ? { value, versionId: `fixture:held-native:${scope}` } : null;
  } } };
  for (const example of cases) {
    await withReaderAuthorityEdge(authority, async () => {
      const response = await representation(new Request(`https://example.test/api/representation/${example.id}`), {
        params: Promise.resolve({ division: example.id.split("/") }),
      });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(payload.holders.map((row: SeatHolder) => [row.name, row.officeTitle]), [[example.name, example.title]]);
      const held = await readerOfficeholders([example.id]);
      const answer = composeReaderOfficials({ ask: readerOfficialsQuestion(example.question)!, held: held.held,
        holdingFailed: held.loaderFailures > 0, placesReached: 4 });
      assert.ok(answer?.answer.includes(example.name));
      assert.doesNotMatch(answer?.answer ?? "", /which city's mayor is yours/);
      assert.ok(answer?.citedUrls.some(url => url.includes("/openstates/people/")));
      assert.ok(!payload.holders.some((row: SeatHolder) => row.name === "Janesville City Council" || row.officeTitle === "Governor"));
    });
    const division: Division = { ocdId: example.id, label: example.id === dc ? "District of Columbia" : example.id.split(":").at(-1)!,
      divisionType: example.type, tier: example.type === "county" ? "local" : "state", state: example.scope.slice(3),
      geoid: null, lsad: null, parentOcdId: null, funcstat: "A", classfp: null, canonicalOcdId: example.id,
      canonicalMatch: "exact", sourceDataset: "TIGER_GENZ2025",
      provenance: { sourceUrl: "https://census.gov", sourceOrg: "Census fixture", collectedAt: NOW, verifiedAt: null } };
    const value = models.get(example.scope)!;
    const settled = await settleCoverageStateLegislators([division], new Map(), async scope => ({ kind: "BOOTSTRAP", value,
      detail: "Held native source fixture", metadata: { recordClass: "STATE_LEGISLATOR", scope, sourceId: value.sourceId, version: null,
        versionId: "native-roles", lastKnownGoodVersionId: "native-roles", sourceThrough: NOW, retrievedAt: NOW,
        promotedAt: null, stale: "CURRENT", staleAt: null } }));
    const coverage = summarizeCoverage([0, 0], [], new Map([[example.id, division]]), [], 0, settled.officials, [division], null, settled.authorities);
    assert.deepEqual(coverage.bodies, [], "a native office never invents a board membership");
    const groups = groupOfficials(coverage);
    assert.ok([...groups.local, ...groups.state].some(row => row.holder.name === example.name && row.holder.officeTitle === example.title));
    const data: ShellData = { allMeetings: [], meetings: [], venues: [], result: null, location: null, drawnDistricts: [],
      dropped: 0, searchFailed: false, atAddress: false, governing: null, zipPartial: null, basis: "ZIP" };
    const html = renderToStaticMarkup(<DataProvider value={data}><CoverageNotice tier="none" zip="96813" coverage={coverage} /></DataProvider>);
    assert.ok(html.includes(example.name), `${example.name} appears on first coverage`);
  }
});
