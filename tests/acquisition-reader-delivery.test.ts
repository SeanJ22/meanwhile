import assert from "node:assert/strict";
import test from "node:test";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { allSeatHolders, governmentListingById, governmentListingsForDivisions, governmentListingsForState, seatHolderById, seatHoldersForDivision } from "../lib/registry/server.ts";
import { namedOfficeholders } from "../lib/ask/server-sources.ts";
import { governmentListingEvidence, readerGovernmentListings } from "../lib/ask/government-listings.ts";
import { incumbentHolderFor } from "../lib/ballot/incumbent-record.ts";
import { installRegistryAuthority, promotedFixtureBundle, syntheticStateLegislators } from "./helpers/promoted-fixtures.ts";
import type { RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import type { RegistrationReadModel } from "../lib/registration/candidate.ts";
import { readNativeMemberVotes } from "../lib/state-rollcalls/reader-votes.ts";
import { prlPersonKeys, prlStatementEvidence } from "../lib/sources/prl/person.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "../lib/sources/prl/types.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";

const DIVISION = "ocd-division/country:us/state:oh/sldl:1";
const PERSON = "plural:oh:11111111-1111-1111-1111-111111111111";

test("a cold state person reaches division, direct identity and Ask without federal or finance reads", async () => {
  const source = syntheticStateLegislators("US-NJ");
  const sample = source.roster.officeholders[0];
  const value: OfficialStateLegislatorReadModel = { ...source, jurisdiction: "US-OH", sourceId: "plural-openstates", roster: { ...source.roster,
    officeholders: [{ ...sample, id: PERSON, personId: "plural:11111111-1111-1111-1111-111111111111", name: "Morgan Example", state: "OH", photo: null }],
    divisions: [{ officeholderId: PERSON, ocdId: DIVISION, bodyId: null }], unmatched: [] } };
  const loaded: string[] = [];
  await withReaderAuthorityEdge({ edgeOnly: true, stateLegislators: { jurisdictions: new Set(["US-OH", "US-CA"]), load: async scope => {
    loaded.push(scope); assert.equal(scope, "US-OH"); return { value, versionId: "oh-one-person" };
  } } }, async () => {
    assert.equal((await seatHolderById(PERSON))?.name, "Morgan Example");
    assert.deepEqual((await seatHoldersForDivision(DIVISION)).map(row => row.id), [PERSON]);
    assert.deepEqual((await allSeatHolders([DIVISION])).map(row => row.id), [PERSON]);
    assert.deepEqual((await namedOfficeholders("What has Morgan Example said?", [], [DIVISION])).map(row => row.id), [PERSON]);
  });
  assert.ok(loaded.length > 0);
  assert.ok(loaded.every(scope => scope === "US-OH"));
});

const listing: RegistrationGovernmentListing = {
  id: "government:US-OH:nces:390001", aliases: [], jurisdictionId: null, state: "OH", name: "Example Education Agency",
  kind: "EDUCATION_AGENCY", governmentClass: "Local education agency", nativeIds: { nces_leaid: "390001" }, status: "Operational",
  sourceVintage: "2025–26 preliminary", website: null, officePhone: "555-0100", officeAddress: null, countyFips: "39049",
  associations: [], bodyIds: [], provenance: { sourceUrl: "https://nces.ed.gov/ccd/", sourceOrg: "NCES", collectedAt: "2026-10-01", verifiedAt: null },
};

test("unpaired government evidence reaches state inventory and named Ask without asserting address service or a board", async () => {
  const value = { state: "OH", governments: [listing], divisions: [], bodies: [] } as unknown as RegistrationReadModel;
  const loaded: string[] = [];
  await withReaderAuthorityEdge({ edgeOnly: true, registrations: { states: new Set(["oh"]), load: async state => {
    loaded.push(state); return { value, versionId: "oh-listings" };
  } } }, async () => {
    const page = await governmentListingsForState("OH", 0, 1);
    assert.deepEqual(page.records, [listing]); assert.equal(page.nextOffset, null);
    assert.deepEqual(await governmentListingById(listing.id), listing);
    assert.deepEqual((await governmentListingsForDivisions([DIVISION])).records, []);
    assert.deepEqual((await readerGovernmentListings("What is Example Education Agency?", [DIVISION], [])).records, [listing]);
    const evidence = governmentListingEvidence(listing);
    assert.equal(evidence.sourceUrl, listing.provenance.sourceUrl);
    assert.match(evidence.text, /service area has not been verified/);
    assert.ok(!evidence.bodyId);
  });
  assert.ok(loaded.every(state => state === "oh"));
});

test("a verified incumbent renders from the person bridge without a funding holding", async () => {
  await installRegistryAuthority();
  await withReaderAuthorityEdge(promotedFixtureBundle({ edgeOnly: true, promoted: new Map() }), async () => {
    assert.equal((await incumbentHolderFor("ballot-nj-morris:county-commissioner:selen"))?.id, "roster:morris#6");
    assert.equal(await incumbentHolderFor("ballot:unknown:Tayfun Selen"), null);
  });
});

test("native Arizona vote positions retain source labels and never read another person's votes", async () => {
  const member = "plural:az:11111111-1111-1111-1111-111111111111";
  const result = await readNativeMemberVotes(member, { holder: async () => { throw new Error("no roster lookup needed"); },
    nh: async () => { throw new Error("unrelated authority"); }, official: async () => null, legiscan: async () => [], plural: async (state, person) => {
      assert.equal(state, "AZ");
      assert.equal(person, "ocd-person/11111111-1111-1111-1111-111111111111");
      return [{ id: "vote:one", billId: "bill:one", billNumber: "HB 1", billTitle: "Water", session: "2026", organizationId: "org:one",
        chamber: "lower", date: "2026-09-01", motion: "Third reading", result: "unknown", counts: [], positions: [], unresolvedPositions: 1,
        sourceUrls: ["https://azleg.gov/roll/one"], sourceApiUrl: "https://v3.openstates.org/bills/one", retrievedAt: "2026-09-02T00:00:00Z", position: "excused" }];
    } });
  assert.equal(result?.votes[0].position, "excused"); assert.equal(result?.votes[0].result, "unknown");
  assert.equal(result?.votes[0].sourceOrg, "Plural / Open States");
});

test("PRL statements use native identity and match the requested topic before becoming quoted evidence", () => {
  assert.equal(prlPersonKeys(PERSON).openstatesId, "ocd-person/11111111-1111-1111-1111-111111111111");
  const rows = ["We must protect clean water for everyone.", "We must improve schools in every community."].map((text, index) => ({
    id: `prl:${index}`, datasetId: "state-rhetoric", nativePersonId: "ocd-person/11111111-1111-1111-1111-111111111111", text,
    date: "2026-09-01", sourceUrl: `https://example.gov/statements/${index}`, sourceLabel: "Official statement", retrievedAt: "2026-09-02T00:00:00Z", attribution: PRL_RHETORIC_ATTRIBUTION,
  }));
  const evidence = prlStatementEvidence(PERSON, { statements: rows, summaries: [], gaps: [] }, "What does Morgan Example say about water?", "Morgan Example");
  assert.equal(evidence.length, 1); assert.equal(evidence[0].verifiedStatement?.quote, rows[0].text);
  assert.equal(evidence[0].verifiedStatement?.date, "2026-09-01");
});
