import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readPlaceOfficialLegislatorRoster, readPlaceVotingSites, readPlaceDerivedCampaignSites } from "../lib/civic-data/held-place-slices.ts";
import { projectHeldPlaceFamilies } from "../lib/civic-data/held-place-families.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";

const db = new PGlite();
after(() => db.close());
const scope = "US-AZ", source = "az-legislature", state = "ocd-division/country:us/state:az";
const selected = `${state}/sldl:1`, other = `${state}/sldl:2`, at = "2026-10-29T10:00:00.000Z";
const full = { officeholders: [1, 2].map(n => ({ id: `${source}:${n}`, name: `Member ${n}`,
  officeTitle: "State Representative", level: "STATE", termStart: "2025-01-01", termEnd: "2027-01-01",
  websiteUrl: `https://azleg.gov/member/${n}`, email: n === 1 ? "public@azleg.gov" : null,
  phone: null, contactFormUrl: null, partyLabel: n === 1 ? "Party" : null,
  provenance: { sourceUrl: "https://azleg.gov/roster", collectedAt: at, rawEvidence: "unused source detail" },
  biography: "unused profile detail" })),
divisions: [{ officeholderId: `${source}:1`, ocdId: selected }, { officeholderId: `${source}:2`, ocdId: other }],
unmatched: [] } as unknown as OfficeholderSet;
const query: ReadOnlyQuery = async statements => Promise.all(statements.map(async statement =>
  (await db.query(statement.text, [...statement.params])).rows as Record<string, unknown>[]));

async function fixture() {
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE FUNCTION reader_payload_node(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;
    CREATE FUNCTION reader_payload_value(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;
    CREATE FUNCTION reader_payload_members(value jsonb) RETURNS TABLE(ordinal_index bigint,item jsonb)
      LANGUAGE sql IMMUTABLE AS $$ SELECT n,item FROM jsonb_array_elements(value) WITH ORDINALITY a(item,n) $$;
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,source_id text,record_class text,scope text,state text,
      acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,
      read_model_fingerprint text,normalized_hash text,candidate jsonb,validation_receipt jsonb,retrieved_at timestamptz);
    CREATE TABLE civic_data_promotions(key text PRIMARY KEY,source_id text,record_class text,scope text,current_version_id text,
      last_known_good_version_id text,payload_fingerprint text,payload jsonb,validation_receipt jsonb,promoted_at timestamptz);`);
  const fingerprint = "a".repeat(64), receipt = { decision: "GOOD", candidateId: "v1", sourceId: source,
    recordClass: "STATE_LEGISLATOR", scope, validatedAt: at };
  await db.query(`INSERT INTO civic_data_candidates VALUES('v1',$1,'STATE_LEGISLATOR',$2,'PROMOTED',true,'v1','v1',$3,$3,$4,$5,$6)`,
    [source, scope, fingerprint, { normalization: { succeeded: true, normalizedHash: fingerprint }, sourceEvidence: "x".repeat(100_000) }, receipt, at]);
  await db.query(`INSERT INTO civic_data_promotions VALUES($1,$2,'STATE_LEGISLATOR',$3,'v1','v1',$4,$5,$6,$7)`,
    [`STATE_LEGISLATOR:${scope}`, source, scope, fingerprint, { formatVersion: 1, jurisdiction: scope, sourceId: source, roster: full }, receipt, at]);
}

test("place state-roster reads preserve every captured field while selecting only the named divisions", async () => {
  await fixture();
  const read = await readPlaceOfficialLegislatorRoster(scope, source, [selected], query);
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, "v1");
  assert.deepEqual(read.value!.roster.divisions, full.divisions.slice(0, 1));
  assert.deepEqual(read.value!.roster.officeholders.map(row => row.id), [`${source}:1`]);
  const expected = projectHeldPlaceFamilies([selected], null, { rosters: [full] });
  assert.deepEqual(projectHeldPlaceFamilies([selected], null, { rosters: [read.value!.roster] }), expected);
  assert.ok(!JSON.stringify(read).includes("unused"));
  assert.ok(JSON.stringify(read).length < 2_000);
  const empty = await readPlaceOfficialLegislatorRoster(scope, source, [state], query);
  assert.equal(empty.kind, "PROMOTED", "a valid roster with no people in the selected division remains a successful read");
  assert.deepEqual(empty.value!.roster.officeholders, []);
});

test("place state-roster proof failures remain failures and an absent pointer remains absent", async () => {
  const mutations = [
    "UPDATE civic_data_candidates SET state='FAILED'",
    "UPDATE civic_data_candidates SET read_model_fingerprint=repeat('b',64)",
    "UPDATE civic_data_promotions SET last_known_good_version_id='old'",
    "UPDATE civic_data_promotions SET validation_receipt=jsonb_set(validation_receipt,'{sourceId}','\"different-source\"')",
    "UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{sourceId}','\"different-source\"')",
    "UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{roster,officeholders,0,id}','\"foreign:1\"')",
    "UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{roster,officeholders,1,id}','\"az-legislature:1\"')",
    "UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{roster,divisions,1,officeholderId}','\"missing\"')",
  ];
  for (const mutation of mutations) {
    await fixture();
    await db.exec(mutation);
    await assert.rejects(readPlaceOfficialLegislatorRoster(scope, source, [selected], query), /STORE_UNREACHABLE/, mutation);
  }
  await fixture();
  await db.exec("DELETE FROM civic_data_promotions");
  assert.equal((await readPlaceOfficialLegislatorRoster(scope, source, [selected], query)).kind, "NOT_RECORDED");
  await assert.rejects(readPlaceOfficialLegislatorRoster(scope, source, [selected], async () => { throw new Error("offline"); }), /offline/);
});

test("place voting-site reads preserve the selected jurisdiction's checklist facts and reject invalid publication heads", async () => {
  await fixture();
  const votingScope = "US-AZ:voting-sites";
  const voting = { generatedAt: at, jurisdictions: [selected, other].map(ocdId => ({ ocdId, name: ocdId,
    model: "VOTE_CENTER", election: "2026-11-03", collectedAt: at, sourceUrl: "https://az.gov/vote",
    sites: [{ id: ocdId, name: "Voting center", address: "Public building", lat: null, lng: null,
      kind: "VOTE_CENTER", room: null, election: "2026-11-03", serves: null }],
    refusal: null, sources: [{ url: "https://az.gov/vote", publisher: "Arizona" }] })) } as VotingSitesFile;
  const receipt = { decision: "GOOD", candidateId: "v1", sourceId: source, recordClass: "VOTING_SITE", scope: votingScope, validatedAt: at };
  await db.query("UPDATE civic_data_candidates SET record_class='VOTING_SITE',scope=$1,validation_receipt=$2", [votingScope, receipt]);
  await db.query("UPDATE civic_data_promotions SET key=$1,record_class='VOTING_SITE',scope=$2,validation_receipt=$3,payload=$4",
    [`VOTING_SITE:${votingScope}`, votingScope, receipt, voting]);
  const read = await readPlaceVotingSites(votingScope, [selected], query);
  assert.equal(read.kind, "PROMOTED");
  assert.deepEqual(read.value, { generatedAt: at, jurisdictions: voting.jurisdictions.slice(0, 1) });
  assert.deepEqual(projectHeldPlaceFamilies([selected], null, { votingSites: read.value }),
    projectHeldPlaceFamilies([selected], null, { votingSites: voting }));
  const empty = await readPlaceVotingSites(votingScope, [state], query);
  assert.equal(empty.kind, "PROMOTED");
  assert.deepEqual(empty.value!.jurisdictions, []);
  await db.exec("UPDATE civic_data_candidates SET state='FAILED'");
  await assert.rejects(readPlaceVotingSites(votingScope, [selected], query), /STORE_UNREACHABLE/);
  await db.exec("DELETE FROM civic_data_promotions");
  assert.equal((await readPlaceVotingSites(votingScope, [selected], query)).kind, "NOT_RECORDED");
});

test("place campaign-site reads use only exact ballot reader and candidacy keys", async () => {
  await fixture();
  const campaignScope = "US-AZ:candidate-campaign-sites-derived";
  const records = [{ id: "reader:selected", candidacyId: "canonical:selected", campaign: { url: "https://selected.example", evidence: { readAt: at } } },
    { id: "reader:alias", candidacyId: "canonical:alias", campaign: { url: "https://alias.example" } },
    { id: "reader:outside", candidacyId: "canonical:outside", campaign: { url: "https://outside.example" } }];
  const receipt = { decision: "GOOD", candidateId: "v1", sourceId: source, recordClass: "CURATED_READER_RECORD", scope: campaignScope, validatedAt: at };
  await db.query("UPDATE civic_data_candidates SET record_class='CURATED_READER_RECORD',scope=$1,validation_receipt=$2", [campaignScope, receipt]);
  await db.query("UPDATE civic_data_promotions SET key=$1,record_class='CURATED_READER_RECORD',scope=$2,validation_receipt=$3,payload=$4",
    [`CURATED_READER_RECORD:${campaignScope}`, campaignScope, receipt, { records }]);
  const read = await readPlaceDerivedCampaignSites(campaignScope, ["reader:selected", "canonical:alias"], query);
  assert.equal(read.kind, "PROMOTED");
  assert.deepEqual(read.value!.records, records.slice(0, 2));
  assert.deepEqual((await readPlaceDerivedCampaignSites(campaignScope, [], query)).value!.records, []);
  await db.exec("UPDATE civic_data_candidates SET state='FAILED'");
  await assert.rejects(readPlaceDerivedCampaignSites(campaignScope, ["reader:selected"], query), /STORE_UNREACHABLE/);
  await assert.rejects(readPlaceDerivedCampaignSites("US:other", [], query), /HELD_PLACE_CAMPAIGN_SCOPE_INVALID/);
  await db.exec("DELETE FROM civic_data_promotions");
  assert.equal((await readPlaceDerivedCampaignSites(campaignScope, [], query)).kind, "NOT_RECORDED");
});
