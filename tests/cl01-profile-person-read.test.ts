import assert from "node:assert/strict";
import test from "node:test";
import type { CivicDataReadStore, PromotedEdgeEntry } from "../lib/civic-data/read-model.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { readHeldPersonIdentity } from "../lib/officials/person-read.ts";
import { statePeopleSourcePointers } from "../lib/officials/people-identity.ts";
import type { Officeholder } from "../lib/officials/types.ts";
import { prlPersonKeys } from "../lib/sources/prl/person.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";
import type { FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import { federalDirectoryScope } from "../lib/officials/federal-directory-data-plane.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { readPrlForSubject } from "../lib/sources/prl/person.ts";

const uuid = "04f7bd8e-094b-433c-9e91-7ebe64c75604";
const person: Officeholder = {
  id: "az-legislature:2381", personId: "az-legislature:2381", name: "Held Official", officeTitle: "State Senator", level: "STATE",
  nativeIds: { reader: ["az-legislature:2381", "az-legislature:old-id"], "ocd-person": [`ocd-person/${uuid}`], fec: ["H4AZ01001"] },
  termStart: "2025-01-13", termEnd: "2027-01-11", birthDate: null, partyLabel: "Democratic", websiteUrl: "https://www.azleg.gov/member/2381",
  contactFormUrl: null, phone: null, email: null, campaignUrl: null, photo: null, state: "AZ", chamber: "upper",
  provenance: { sourceUrl: "https://www.azleg.gov/member/2381", sourceOrg: "Arizona Legislature", collectedAt: "2026-10-24", verifiedAt: "2026-10-24" },
  fieldSources: { name: { sourceUrl: "https://www.azleg.gov/roster", sourceOrg: "Arizona Legislature", collectedAt: "2026-10-23", verifiedAt: "2026-10-24" } },
};

function storeFor(entries: readonly Extract<PromotedEdgeEntry, {kind: "PROMOTED"}>[]) {
  const calls: string[] = [], entriesByKey = new Map(entries.map(entry => [entry.projection.key, entry]));
  const store: CivicDataReadStore = {
    async readPromotion() { throw new Error("Native lookup uses the published entry"); },
    async readCandidate() { throw new Error("Native lookup uses the published entry"); },
    async readPromotedEntry(recordClass, scope) {
      calls.push(`${recordClass}:${scope}`);
      return entriesByKey.get(`${recordClass}:${scope}`) ?? {kind: "NOT_RECORDED", recordClass, scope};
    },
  };
  return {store, calls};
}

function stateEntry(people: readonly Officeholder[]) {
  const value: OfficialStateLegislatorReadModel = {formatVersion: 1, sourceId: "az-legislature", jurisdiction: "US-AZ", term: "57", generatedAt: "2026-10-24",
    roster: {scope: "US-AZ", generatedAt: "2026-10-24", officeholders: [...people], divisions: [], unmatched: []}};
  return provenEdgeEntry({recordClass: "STATE_LEGISLATOR", scope: "US-AZ", sourceId: "az-legislature", versionId: "test:profile-state", value});
}

test("profile identity reuses the held state-person composite and preserves all exact native/source aliases and verification", async () => {
  const {store, calls} = storeFor([stateEntry([person])]);
  for (const key of [person.id, "az-legislature:old-id"]) {
    const holder = await readHeldPersonIdentity(key, {store});
    assert.ok(holder);
    assert.deepEqual(holder.nativeIds, person.nativeIds);
    assert.deepEqual(holder.provenance, person.provenance);
    assert.deepEqual(holder.fieldSources?.name, person.fieldSources?.name);
    assert.deepEqual(holder.fieldSources?.officeTitle, person.provenance);
    assert.deepEqual(prlPersonKeys(holder.id, holder), {bioguideId: undefined, openstatesId: `ocd-person/${uuid}`, candidateId: "H4AZ01001"});
  }
  assert.deepEqual([...new Set(calls)].sort(), statePeopleSourcePointers("US-AZ").map(row => `${row.recordClass}:${row.scope}`).sort());
});

test("an official without a native PRL mapping remains empty and a same-name person cannot supply one", async () => {
  const noPrl = {...person, nativeIds: {reader: [person.id]}};
  const unrelated = {...person, id: "az-legislature:2346", personId: "az-legislature:2346", nativeIds: {"ocd-person": [`ocd-person/${uuid}`]}};
  const {store} = storeFor([stateEntry([noPrl, unrelated])]);
  const holder = await readHeldPersonIdentity(person.id, {store});
  assert.equal(holder?.id, person.id);
  assert.deepEqual(prlPersonKeys(holder!.id, holder), {bioguideId: undefined, openstatesId: undefined, candidateId: undefined});
  assert.equal(await readHeldPersonIdentity("az-legislature:unknown", {store}), null);
});

test("conflicting native archive IDs in a held composite cannot choose one PRL partition", async () => {
  const other = {...person, id: "az-legislature:2346", personId: "az-legislature:2346", nativeIds: {...person.nativeIds, "ocd-person": ["ocd-person/1a2f8d8e-094b-433c-9e91-7ebe64c75604"]}};
  const {store} = storeFor([stateEntry([person, other])]);
  const holder = await readHeldPersonIdentity("az-legislature:old-id", {store});
  assert.ok(holder);
  assert.equal(prlPersonKeys(holder.id, holder).openstatesId, undefined);
});

test("federal profile identity uses only the selected held delegation and carries positive native archive IDs", async () => {
  const member = {...person, id: "congress:O000174", personId: "congress:O000174", level: "FEDERAL" as const, name: "Held Senator", officeTitle: "U.S. Senator", state: "GA", chamber: "senate",
    nativeIds: {reader: ["congress:O000174", "congress:O000173"], bioguide: ["O000174"], fec: ["S8GA00180"]}};
  const value: FederalDirectoryReadModel = {formatVersion: 1, sourceSha: "a".repeat(40), roster: {scope: "US-GA", generatedAt: "2026-10-24", officeholders: [member], divisions: [], unmatched: []},
    directory: {source: {project: "Congress directory", repoUrl: "https://github.com/unitedstates/congress-legislators", sha: "a".repeat(40), licence: "CC0", licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/", sourceOrg: "Congress directory", collectedAt: "2026-10-24"},
      byMember: {O000174: {committees: [], districtOffices: []}}, committees: {}, counts: {}}};
  const {store, calls} = storeFor([provenEdgeEntry({recordClass: "FEDERAL_DIRECTORY", scope: federalDirectoryScope("GA"), sourceId: "congress-directory-project", versionId: "test:profile-federal", value})]);
  await withReaderSelection({states: ["GA"], keys: new Set([member.id])}, async () => {
    for (const key of [member.id, "congress:O000173"]) {
      const holder = await readHeldPersonIdentity(key, {store});
      assert.equal(holder?.id, member.id);
      assert.deepEqual(holder?.nativeIds, member.nativeIds);
      assert.deepEqual(prlPersonKeys(holder!.id, holder), {bioguideId: "O000174", openstatesId: undefined, candidateId: "S8GA00180"});
    }
  });
  assert.deepEqual([...new Set(calls)], [`FEDERAL_DIRECTORY:${federalDirectoryScope("GA")}`]);
});

test("the profile's default server read batches only people authorities and shares aliases within the request", async () => {
  const entry = stateEntry([{...person, nativeIds: {reader: [person.id, "az-legislature:old-id"]}}]);
  const selected: unknown[] = [];
  installReaderDatabaseQuery(async statements => statements.map(statement => {
    selected.push(statement.params[0]);
    assert.deepEqual(statement.params[0], statePeopleSourcePointers("US-AZ").map(row => `${row.recordClass}:${row.scope}`));
    return [{row_kind: "promotion", key: entry.projection.key, record_class: entry.projection.recordClass, scope: entry.projection.scope,
      source_id: entry.projection.sourceId, current_version_id: entry.projection.versionId, last_known_good_version_id: entry.projection.versionId,
      promoted_at: entry.projection.promotedAt, validation_receipt: entry.projection.receipt, payload: entry.projection.payload,
      normalized_hash: entry.attested.payloadSha256, retrieved_at: entry.attested.retrievedAt, published: true}];
  }));
  try {
    await withReaderSelection({states: ["AZ"], keys: new Set([person.id])}, async () => {
      const [primary, alias] = await Promise.all([readHeldPersonIdentity(person.id), readHeldPersonIdentity("az-legislature:old-id")]);
      assert.deepEqual(alias, primary);
      assert.deepEqual(await readPrlForSubject(person.id), {statements: [], summaries: [], gaps: []});
    });
    assert.equal(selected.length, 2, "each alias reads only its own person's records, without registry or national packages, and the profile shares them");
  } finally { installReaderDatabaseQuery(undefined); }
});
