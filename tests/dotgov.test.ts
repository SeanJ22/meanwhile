import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acquireDotGov } from "../scripts/fetch-dotgov.mts";
import { dotGovCandidate } from "../lib/civic-data/candidate-builders.ts";
import { attachGovernmentDomains, DOTGOV_BOUNDARY, DOTGOV_SCOPE, dotGovSnapshotIssues, parseDotGovRegistry, readDotGovProjection, type DotGovSnapshot } from "../lib/civic-data/dotgov.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { dotGovCounts, dotGovStateScope } from "../lib/civic-data/dotgov.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { governmentListingsForDivisions } from "../lib/registry/server.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { parseCsv } from "../lib/reference/csv.ts";
import { governmentNativeId, type RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import type { RegistrationReadModel } from "../lib/registration/candidate.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import { isSourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";

const csv = readFileSync("tests/fixtures/dotgov/current-full.csv", "utf8");
const source = JSON.parse(readFileSync("tests/fixtures/dotgov/retrieval.json", "utf8")) as { sha: string; retrievedAt: string; sourceUrl: string; domains: number };
const NOW = "2026-10-12T20:00:00.000Z";
const domains = parseDotGovRegistry(csv);
const byType: Record<string, number> = {};
for (const row of domains) byType[row.type] = (byType[row.type] ?? 0) + 1;
const snapshot: DotGovSnapshot = {
  source: { sha: source.sha, url: source.sourceUrl, readAt: NOW },
  counts: { domains: domains.length, electionDomains: domains.filter(row => /election/i.test(row.type)).length, byType },
  domains, boundary: DOTGOV_BOUNDARY,
};
const stateSnapshot = (state: string): DotGovSnapshot => {
  const rows = domains.filter(row => row.state === state);
  return { ...snapshot, state, domains: rows, counts: dotGovCounts(rows), registryCounts: snapshot.counts };
};

function censusListing(name: string, state: string): RegistrationGovernmentListing {
  // Use the publisher's actual Census row, rather than an invented contact record.
  const [header, ...rows] = parseCsv(readFileSync("data/reference/census_govt_units_2022.csv", "utf8"));
  const row = rows.find(row => row[header.indexOf("unit_name")] === name && row[header.indexOf("state")] === state)!;
  assert.ok(row, `${state}:${name} must be a held Census government`);
  const value = (field: string) => row[header.indexOf(field)];
  return {
    id: governmentNativeId(state, "cog", value("census_id_pid6")), aliases: [], jurisdictionId: null, state, name,
    kind: "GOVERNMENT", governmentClass: value("gov_type"), nativeIds: { census_pid6: value("census_id_pid6") },
    status: value("is_active"), sourceVintage: "2022 Census of Governments", website: value("web_address") || null,
    officePhone: null, officeAddress: null, countyFips: null,
    associations: [{ divisionId: `ocd-division/country:us/state:${state.toLowerCase()}/place:test`, layer: "place", geoid: value("fips_state") + value("fips_place"), basis: "SOURCE_CODE" }],
    bodyIds: [], provenance: { sourceUrl: "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP", sourceOrg: "U.S. Census Bureau", collectedAt: "2026-09-23", verifiedAt: null },
  };
}

const city = censusListing("CITY OF TWENTYNINE PALMS", "CA");

test("the real CISA snapshot retains every domain and registrant, including non-election domains", () => {
  assert.equal(domains.length, source.domains);
  assert.equal(domains.length, 16_876);
  assert.equal(snapshot.counts.electionDomains, 719);
  assert.equal(domains.find(row => row.domain === "29palms.gov")?.organization, "City of Twentynine Palms");
  assert.deepEqual(dotGovSnapshotIssues(snapshot), []);
  const ca = stateSnapshot("CA");
  const candidate = dotGovCandidate({ snapshot: ca, rawText: csv, finalUrl: source.sourceUrl, retrievedAt: NOW });
  assert.equal(candidate.normalization.inputRecords, ca.domains.length);
  assert.equal(candidate.normalization.outputRecords, ca.domains.length);
  assert.equal(candidate.normalization.droppedRecords, 0);
  assert.equal(candidate.identities.length, ca.domains.length);
  assert.equal(candidate.scope, dotGovStateScope("CA"));
  assert.match(snapshot.boundary, /Census of Governments/);
});

test("the pinned acquisition keeps all real CSV rows and refuses conflicting duplicate identifiers", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => String(url).includes("api.github.com")
    ? new Response(JSON.stringify([{ sha: source.sha }]), { status: 200 })
    : new Response(csv, { status: 200 })) as typeof fetch;
  try {
    const acquisition = await acquireDotGov();
    try {
      assert.equal(acquisition.counts.domains, source.domains);
      assert.equal(acquisition.counts.electionDomains, 719);
      assert.equal(acquisition.snapshot().domains.length, 0, "the country marker carries only source counts");
      let retained = 0;
      for (const state of acquisition.states) {
        const held = acquisition.snapshot(state);
        assert.ok(held.domains.every(row => (row.state ?? "US") === state));
        retained += held.domains.length;
      }
      assert.equal(retained, source.domains, "every source row appears in exactly one state");
      assert.ok(acquisition.snapshot("CA").domains.some(row => row.domain === "29palms.gov"));
      assert.ok(!acquisition.csv("ID").includes("29palms.gov"));
    } finally { await acquisition.dispose(); }
  } finally { globalThis.fetch = original; }
  const first = csv.split("\n")[1]!;
  assert.throws(() => parseDotGovRegistry(`${csv}\n${first}\n`), /repeats a domain/);
  await assert.rejects(acquireDotGov(undefined, { fetchImpl: (async url => String(url).includes("api.github.com")
    ? new Response(JSON.stringify([{ sha: source.sha }])) : new Response(`${csv}\n${first}\n`)) as typeof fetch }), /repeats a domain/);
});

test("a growing foreign-state source stays on disk while a place asks only for its own domains", async () => {
  const encoder = new TextEncoder();
  let next = 0;
  const fetchImpl = (async input => {
    if (String(input).includes("api.github.com")) return new Response(JSON.stringify([{ sha: "2".repeat(40) }]));
    return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
      if (next === 0) controller.enqueue(encoder.encode("Domain name,Domain type,Organization name,Suborganization name,City,State\nlocal-id.gov,City,Local ID,,Local,ID\n"));
      if (next === 50000) { controller.close(); return; }
      const end = Math.min(50000, next + 100);
      let chunk = "";
      for (; next < end; next++) chunk += `foreign-${next}.gov,City,Foreign ${next},,Other,LA\n`;
      controller.enqueue(encoder.encode(chunk));
    } }));
  }) as typeof fetch;
  const held = await acquireDotGov(undefined, { fetchImpl, minimumElectionDomains: 0 });
  try {
    assert.equal(held.counts.domains, 50001);
    assert.deepEqual(held.snapshot("ID").domains.map(row => row.domain), ["local-id.gov"]);
    assert.equal(held.csv("ID").split("\n").filter(Boolean).length, 2);
    assert.equal(held.snapshot().domains.length, 0);
  } finally { await held.dispose(); }
});

test("native malformed CSV is publisher evidence, while held-source failures remain operational", async () => {
  for (const row of ['"unterminated', 'un"quoted', '"closed"bad', "x".repeat(4 * 1024 * 1024 + 1)]) {
    await assert.rejects(acquireDotGov(undefined, { fetchImpl: (async url => String(url).includes("api.github.com")
      ? new Response(JSON.stringify([{ sha: source.sha }])) : new Response(`${csv.split("\n")[0]}\n${row}`)) as typeof fetch }),
    (error: unknown) => isSourceAcquisitionFailure(error) && error.code === "PUBLISHER_DOCUMENT_INVALID" && /malformed registry CSV/.test(error.message));
  }
  const unavailable = new Error("held archive unavailable");
  await assert.rejects(acquireDotGov(undefined, {
    fetchImpl: (async () => new Response(JSON.stringify([{ sha: source.sha }]))) as typeof fetch,
    archive: { get: async () => { throw unavailable; }, head: async () => null, put: async () => undefined },
  }), error => error === unavailable && !isSourceAcquisitionFailure(error));
});

test("domain enrichment preserves the government denominator, source website and geographic associations", () => {
  const attached = attachGovernmentDomains([city], snapshot);
  assert.equal(attached.length, 1);
  assert.equal(attached[0].id, city.id);
  assert.equal(attached[0].website, city.website);
  assert.deepEqual(attached[0].associations, city.associations);
  assert.ok(attached[0].govDomains?.some(row => row.domain === "29palms.gov" && row.sourceUrl === source.sourceUrl));
  assert.equal(attachGovernmentDomains([{ ...city, state: "AZ" }], snapshot)[0].govDomains?.length, 0);
  assert.equal(attachGovernmentDomains([{ ...city, name: "An unmatched registrant" }], snapshot)[0].govDomains?.length, 0);
  const ambiguous = attachGovernmentDomains([city, { ...city, id: `${city.id}:duplicate` }], snapshot);
  assert.ok(ambiguous.every(row => row.govDomains?.length === 0));
  assert.equal(snapshot.domains.length, source.domains, "unmatched rows remain in the complete registry");
});

test("a state CISA candidate promotes through the typed Reader and reaches geographic government listings", async () => {
  const store = new MemoryRoutineDataStore();
  const ca = stateSnapshot("CA");
  const candidate = dotGovCandidate({ snapshot: ca, rawText: csv, finalUrl: source.sourceUrl, retrievedAt: NOW });
  const outcome = await processRegisteredFanOutCandidate(store, "dotgov", candidate, NOW);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? outcome.candidate.failureCode ?? "The CISA candidate was refused.");
  const read = await readDotGovProjection({ state: "CA", store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.value?.domains.length, ca.domains.length);
  const edge = provenEdgeEntry({ recordClass: "DOTGOV_REFERENCE", scope: dotGovStateScope("CA"),
    sourceId: candidate.sourceId, versionId: candidate.id, value: read.value!, retrievedAt: NOW });
  const model = { state: "CA", governments: [city], divisions: [], bodies: [] } as unknown as RegistrationReadModel;
  const listings = await withReaderAuthorityEdge({
    edgeOnly: true,
    promoted: new Map([[`DOTGOV_REFERENCE:${dotGovStateScope("CA")}`, edge]]),
    registrations: { load: async () => ({ value: model, versionId: "census-fixture" }) },
  }, () => governmentListingsForDivisions([city.associations[0].divisionId]));
  assert.deepEqual(listings.unavailableStates, []);
  assert.equal(listings.records.length, 1);
  assert.ok(listings.records[0].govDomains?.some(row => row.domain === "29palms.gov"));
});

test("CISA publication requires exact state records and rejects a country array", () => {
  assert.throws(() => dotGovCandidate({ snapshot, rawText: csv, finalUrl: source.sourceUrl, retrievedAt: NOW }), /exact state/);
});

test("one real source-release record advances the routine clock without retaining country records", async () => {
  const store = new MemoryRoutineDataStore();
  const marker: DotGovSnapshot = { ...snapshot, domains: [], counts: dotGovCounts([]), registryCounts: snapshot.counts,
    release: { sha: snapshot.source.sha, url: snapshot.source.url, readAt: snapshot.source.readAt, counts: snapshot.counts } };
  const candidate = dotGovCandidate({ snapshot: marker, rawText: csv, finalUrl: source.sourceUrl, retrievedAt: NOW });
  const outcome = await processRegisteredRoutineCandidate(store, "dotgov", candidate, NOW);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? "source release refused");
  assert.equal(candidate.scope, DOTGOV_SCOPE);
  assert.equal(candidate.normalization.outputRecords, 1);
  const read = await readDotGovProjection({ store, now: NOW, bypassCache: true });
  assert.equal(read.value?.domains.length, 0);
  assert.equal(read.value?.release?.counts.domains, source.domains);
});
