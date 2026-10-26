import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { joinFederalMoneyFacts } from "../lib/federal-money/join.ts";
import { compareFederalMoneyActions, federalMoneyActionDate, federalMoneyLookupKeys, type FederalMoneyFact, type FederalMoneyProjection } from "../lib/federal-money/model.ts";
import { publishFederalMoneyPartition } from "../lib/federal-money/edge-publication.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { federalMoneyRows } from "../lib/federal-money/view.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { federalGovernmentName } from "../lib/federal-money/recipient.ts";

const state = "ocd-division/country:us/state:wi";
const county = `${state}/county:milwaukee`;
const fact: FederalMoneyFact = { id: "usaspending:synthetic", source: "usaspending", sourceId: "synthetic", state: "WI", kind: "GRANT", title: "Housing assistance", amount: 100, amountLabel: "Federal obligation", period: "2026-05-01", recipient: "Synthetic government", uei: null,
  identifiers: { census_pid6: "136508" }, geography: [], bodyIds: [], divisionIds: [], joinStatus: "UNJOINED", joinReason: "Pending native match", details: {},
  provenance: { sourceUrl: "https://api.usaspending.gov/api/v2/", sourceOrg: "USAspending", publicationDate: "2026-10-01", retrievedAt: "2026-10-25T00:00:00.000Z", official: true, rawHash: createHash("sha256").update("synthetic").digest("hex") } };

test("published native government aliases bind county, city and district cards with no registration body rows", () => {
  for (const division of [county, `${state}/place:milwaukee`, `${state}/school_district:milwaukee_school_district`]) {
    const body = `${division}#governing`;
    const id = "government:US-WI:cog:136508";
    const [joined] = joinFederalMoneyFacts([fact], { bodies: [], divisions: [], governments: [{ id, aliases: [body], bodyIds: [], nativeIds: { census_pid6: "136508" }, associations: [{ divisionId: division, layer: "county", geoid: "55079", basis: "SOURCE_CODE" }] }] });
    assert.deepEqual(joined.bodyIds, [id, body].sort());
    assert.equal(federalMoneyRows([joined], { divisionId: division, bodyId: body })[0].relationship, "BOTH");
    const [unrelated] = joinFederalMoneyFacts([{ ...fact, identifiers: { census_pid6: "different" } }], { bodies: [], divisions: [], governments: [{ id, aliases: [body], bodyIds: [], nativeIds: { census_pid6: "136508" }, associations: [] }] });
    assert.deepEqual(unrelated.bodyIds, [], "a place or similar recipient name never establishes a recipient");
  }
});

test("exact legal government names require the recipient's own state and a unique government", () => {
  const government = { id: "government:US-WI:cog:136508", state: "WI", name: "COUNTY OF MILWAUKEE", aliases: [`${county}#governing`], bodyIds: [], nativeIds: {}, associations: [{ divisionId: county, layer: "county", geoid: "55079", basis: "SOURCE_CODE" as const }] };
  const input = { bodies: [], divisions: [], governments: [government] };
  const receipt = { ...fact, identifiers: {}, recipient: "MILWAUKEE, COUNTY OF", details: { recipientState: "WI" } };
  assert.equal(federalGovernmentName(receipt.recipient), federalGovernmentName(government.name));
  assert.deepEqual(joinFederalMoneyFacts([receipt], input)[0].bodyIds, [government.id, ...government.aliases].sort());
  for (const recipient of ["MILWAUKEE COUNTY HOUSING INC", "CITY OF MILWAUKEE", "DEPARTMENT OF COMMERCE NORTH CAROLINA"]) {
    assert.deepEqual(joinFederalMoneyFacts([{ ...receipt, recipient }], input)[0].bodyIds, [], recipient);
  }
  for (const recipientState of [null, "AZ"]) {
    assert.deepEqual(joinFederalMoneyFacts([{ ...receipt, details: { recipientState }, geography: [{ type: "county", geoid: "55079" }] }], input)[0].bodyIds, []);
  }
  const ambiguous = { ...input, governments: [government, { ...government, id: "government:US-WI:cog:duplicate" }] };
  assert.deepEqual(joinFederalMoneyFacts([receipt], ambiguous)[0].bodyIds, []);
  const district = { ...government, name: "Milwaukee Area Technical College District", id: "government:US-WI:cog:district" };
  assert.ok(joinFederalMoneyFacts([{ ...receipt, recipient: "MILWAUKEE AREA TECHNICAL COLLEGE DISTRICT" }], { ...input, governments: [district] })[0].bodyIds.includes(district.id));
});

test("a body opens the existing recipient government's published index through its held identity", async t => {
  const directory = mkdtempSync(join(tmpdir(), "money-native-alias-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  const id = "government:US-WI:cog:136508";
  const records = [{ ...fact, bodyIds: [id], joinStatus: "JOINED" as const }];
  const projection: FederalMoneyProjection = { formatVersion: 2, source: "usaspending", state: "WI", partition: { year: "2026", place: "uei:synthetic", shard: "" }, records, lookupKeys: federalMoneyLookupKeys(records), counts: { loaded: 1, joined: 1, unjoined: 0 } };
  await publishFederalMoneyPartition({ store: artifactStore, projection, previous: null, versionId: "synthetic", checkedAt: fact.provenance.retrievedAt });
  const target = { divisionId: county, bodyId: `${county}#governing`, bodyIds: [id] };
  const read = await readFederalMoneyForPlace(target, { artifactStore });
  assert.equal(read.sources[0].records.length, 1);
  assert.deepEqual(read.recipientIds, [id, target.bodyId].sort());
  assert.equal(federalMoneyRows(read.sources[0].records, target)[0].relationship, "RECIPIENT");
  assert.equal((await readFederalMoneyForPlace({ ...target, bodyIds: [] }, { artifactStore })).sources[0].records.length, 0);
});

test("action dates order the initial artifact page and override a recent refresh of an old award", async t => {
  const directory = mkdtempSync(join(tmpdir(), "money-action-order-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  const older = { ...fact, period: "2003-08-14", divisionIds: [county], joinStatus: "JOINED" as const };
  const newer = { ...older, id: "usaspending:newer", sourceId: "newer", period: "2026-07-04", provenance: { ...older.provenance, publicationDate: "2026-07-05" } };
  assert.ok(compareFederalMoneyActions(older, newer) > 0);
  assert.equal(federalMoneyActionDate({ ...older, details: { actionDate: "2026-08-02" } }), "2026-08-02T00:00:00.000Z");
  assert.equal(federalMoneyActionDate({ ...older, period: null }), "");
  for (const row of [older, newer]) {
    const records = [row];
    const projection: FederalMoneyProjection = { formatVersion: 2, source: "usaspending", state: "WI", partition: { year: row.period!.slice(0, 4), place: "county:55079", shard: "" }, records, lookupKeys: federalMoneyLookupKeys(records), counts: { loaded: 1, joined: 1, unjoined: 0 } };
    await publishFederalMoneyPartition({ store: artifactStore, projection, previous: null, versionId: row.id, checkedAt: fact.provenance.retrievedAt });
  }
  const read = await readFederalMoneyForPlace({ divisionId: county }, { artifactStore });
  assert.deepEqual(read.sources[0].records.map(row => row.id), [newer.id, older.id]);
  assert.equal(read.nextCursor, null);
});
