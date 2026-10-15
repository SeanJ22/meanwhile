import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { withSourceTransport } from "./helpers/source-fetch.ts";
import { acquireDotGov } from "../scripts/fetch-dotgov.mts";
import { dotGovCandidate } from "../lib/civic-data/candidate-builders.ts";
import { attachGovernmentDomains, DOTGOV_BOUNDARY, DOTGOV_SCOPE, dotGovSnapshotIssues, parseDotGovRegistry, readDotGovProjection, type DotGovSnapshot } from "../lib/civic-data/dotgov.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { governmentListingsForDivisions } from "../lib/registry/server.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { parseCsv } from "../lib/reference/csv.ts";
import { governmentNativeId, type RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import type { RegistrationReadModel } from "../lib/registration/candidate.ts";
import { promotedEdgePointers, readPromotedEdgeFamilies } from "../lib/civic-data/promoted-edge-publication.ts";
import type { PromotedFamilyArtifactValue } from "../lib/meetings/edge-artifacts.ts";
import { READER_MAP_AUTHORITY_FAMILIES } from "../lib/meetings/edge-serving.ts";

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
  const candidate = dotGovCandidate({ snapshot, rawText: csv, finalUrl: source.sourceUrl, retrievedAt: NOW });
  assert.equal(candidate.normalization.inputRecords, domains.length);
  assert.equal(candidate.normalization.outputRecords, domains.length);
  assert.equal(candidate.normalization.droppedRecords, 0);
  assert.equal(candidate.identities.length, domains.length);
  assert.match(snapshot.boundary, /Census of Governments/);
});

test("the pinned acquisition keeps all real CSV rows and refuses conflicting duplicate identifiers", async () => {
  const transport: typeof fetch = async url => String(url).includes("api.github.com")
    ? new Response(JSON.stringify([{ sha: source.sha }]), { status: 200 })
    : new Response(csv, { status: 200 });
  const acquisition = await withSourceTransport(transport, acquireDotGov);
  assert.equal(acquisition.snapshot.domains.length, source.domains);
  assert.equal(acquisition.snapshot.counts.electionDomains, 719);
  assert.ok(acquisition.snapshot.domains.some(row => row.domain === "29palms.gov"));
  const first = csv.split("\n")[1]!;
  assert.throws(() => parseDotGovRegistry(`${csv}\n${first}\n`), /repeats a domain/);
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

test("a full CISA candidate promotes through the typed Reader and reaches geographic government listings from the edge", async () => {
  const store = new MemoryRoutineDataStore();
  const candidate = dotGovCandidate({ snapshot, rawText: csv, finalUrl: source.sourceUrl, retrievedAt: NOW });
  const outcome = await processRegisteredRoutineCandidate(store, "dotgov", candidate, NOW);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? outcome.candidate.failureCode ?? "The CISA candidate was refused.");
  const read = await readDotGovProjection({ store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.value?.domains.length, source.domains);
  const published = await readPromotedEdgeFamilies({ store, servedManifest: null, now: NOW,
    families: { "government-domains": promotedEdgePointers()["government-domains"] } });
  assert.deepEqual(published.skipped, []);
  const family = published.authority["government-domains"];
  assert.ok(family && "value" in family);
  const edge = (family.value as PromotedFamilyArtifactValue).entries[0]!;
  assert.ok(edge);
  const model = { state: "CA", governments: [city], divisions: [], bodies: [] } as unknown as RegistrationReadModel;
  const listings = await withReaderAuthorityEdge({
    edgeOnly: true,
    promoted: new Map([[`DOTGOV_REFERENCE:${DOTGOV_SCOPE}`, edge]]),
    registrations: { states: new Set(["ca"]), load: async () => ({ value: model, versionId: "census-fixture" }) },
  }, () => governmentListingsForDivisions([city.associations[0].divisionId]));
  assert.deepEqual(listings.unavailableStates, []);
  assert.equal(listings.records.length, 1);
  assert.ok(listings.records[0].govDomains?.some(row => row.domain === "29palms.gov"));
  assert.ok(READER_MAP_AUTHORITY_FAMILIES.includes("government-domains"));
  assert.deepEqual(promotedEdgePointers()["government-domains"].map(row => row.scope), [DOTGOV_SCOPE]);
});
