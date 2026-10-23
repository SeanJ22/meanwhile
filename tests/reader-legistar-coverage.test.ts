import assert from "node:assert/strict";
import test from "node:test";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { BodyFacts } from "../lib/facts/registry-overlay.ts";
import type { Body } from "../lib/registry/types.ts";

const division = "ocd-division/country:us/state:az/place:mesa";
const at = "2026-10-23T09:00:00Z";
const source = { sourceUrl: "https://webapi.legistar.com/v1/mesa/bodies?$top=1000", sourceOrg: "Mesa", collectedAt: at, verifiedAt: at };
const body = (id: string): Body => ({ id, ocdId: division, name: "City Council", bodyClass: "UNCLASSIFIED", bodyOrigin: "SOURCED",
  coverageStatus: "NOT_ATTEMPTED", agendaSourceType: "LEGISTAR", agendaSourceRef: null, meetingCadence: null, homepageUrl: null,
  demandCount: 0, sourceDataset: "GOV_DIRECTORY", provenance: source });
const runtime = (bodies: Body[]): RegistryRuntimeReadModel => ({ formatVersion: 1, registry: { generatedAt: at, bodies, divisions: [{
  ocdId: division, label: "Mesa", divisionType: "place", tier: "local", state: "AZ", parentOcdId: "ocd-division/country:us/state:az",
  lsad: null, funcstat: null, classfp: null, geoid: null, canonicalOcdId: null, canonicalMatch: "none", sourceDataset: "TIGER_CB2023", provenance: source,
}] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialPhotos: { photos: [] }, rosterPhotos: {},
  officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] } });

test("registered and acquired Legistar boards both require members in the reader answer", () => {
  const registered = body(division + "#governing"), acquired = body(division + "#commission");
  const facts: BodyFacts[] = [registered, acquired].map(b => ({ id: b.id, division, fields: { name: b.name, provenance: source },
    roster: null, dispositions: [], comment: null, sittings: [] }));
  for (const sourceUrl of ["https://webapi.legistar.com/v1/mesa/events?event=1", "https://mesa.legistar.com/Calendar.aspx"]) {
    facts.push({ ...facts[1], id: division + "#calendar:" + facts.length, fields: { name: "Calendar body", provenance: { ...source, sourceUrl } } });
  }
  const state = { state: "AZ", version: at, registry: runtime([registered]) };
  assert.deepEqual(stateCoverage(state, [division], 33.4, -111.8, [], facts).bodies, []);
  const id = "legistar:mesa:person:1:office:1";
  const seated = { ...facts[1], roster: { bodyId: acquired.id, bodyName: acquired.name!, sourceUrl: source.sourceUrl,
    sourceOrg: "Mesa", collectedAt: at, partisanship: "UNDETERMINED" as const, members: [{ id, name: "Current Member", officeTitle: "Member",
      termStart: null, termEnd: null, termNote: null, email: null, phone: null, websiteUrl: null }] },
    dispositions: [{ sourceId: id, canonicalId: id, state: "READER_ELIGIBLE" as const, reason: "Saved official source" }] };
  const shown = stateCoverage(state, [division], 33.4, -111.8, [], [facts[0], seated]).bodies;
  assert.deepEqual(shown.map(b => [b.bodyId, b.readerRoster?.members.map(m => m.name)]), [[acquired.id, ["Current Member"]]]);
});
