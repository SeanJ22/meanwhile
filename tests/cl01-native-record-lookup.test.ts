import {canonicalStatementKeys} from "./helpers/ready-authorities.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { GET as bills } from "../app/api/bills/route.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import { readHeldPersonIdentity } from "../lib/officials/person-read.ts";
import { statePeopleSourcePointers } from "../lib/officials/people-identity.ts";
import { toSeatHolder } from "../lib/officials/lookup.ts";
import type { Officeholder } from "../lib/officials/types.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { billPartScope, billScope, LEGISCAN_BULK_SCOPE, type BillPart, type BillSession, type Dataset } from "../lib/sources/legiscan/bills.ts";
import { readBillsForState } from "../lib/sources/legiscan/reader.ts";
import { readNativeMemberVotes, type NativeMemberVoteReaders } from "../lib/state-rollcalls/reader-votes.ts";
import { provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

const personId = "ocd-person/04f7bd8e-094b-433c-9e91-7ebe64c75604";
const person: Officeholder = {
  id: "az-legislature:2381", personId: "az-legislature:2381", name: "Synthetic held official", level: "STATE",
  officeTitle: "State Senator", state: "AZ", chamber: "upper", nativeIds: { reader: ["az-legislature:2381", "az-legislature:old-id"], "ocd-person": [personId] },
  termStart: "2025-01-13", termEnd: "2027-01-11", birthDate: null, partyLabel: null, websiteUrl: null, contactFormUrl: null,
  phone: null, email: null, campaignUrl: null, photo: null,
  provenance: { sourceUrl: "https://example.gov/people/2381", sourceOrg: "Synthetic legislature", collectedAt: "2026-10-24", verifiedAt: null },
};
const state = provenEdgeEntry({ recordClass: "STATE_LEGISLATOR", scope: "US-AZ", sourceId: "az-legislature", versionId: "test:cl01-native-record-person",
  value: { formatVersion: 1, sourceId: "az-legislature", jurisdiction: "US-AZ", term: "57", generatedAt: "2026-10-24",
    roster: { scope: "US-AZ", generatedAt: "2026-10-24", officeholders: [person], divisions: [], unmatched: [] } } });

function storeFor(entries: readonly ReturnType<typeof provenEdgeEntry>[]): CivicDataReadStore {
  const byKey = new Map(entries.map(entry => [entry.projection.key, entry]));
  return {
    async readPromotion() { throw Error("Published entries only"); },
    async readCandidate() { throw Error("Published entries only"); },
    async readPromotedEntry(recordClass, scope) { return byKey.get(`${recordClass}:${scope}`) ?? { kind: "NOT_RECORDED", recordClass, scope }; },
  };
}

test("native bill requests keep the full-holder answer and legacy alias without reading a state package", async () => {
  const dataset = { state_id: 3, session_id: 2235, session_name: "Synthetic session", dataset_hash: "a".repeat(32), dataset_date: "2026-09-06" };
  const rawHash = "b".repeat(64), scope = billPartScope(dataset, 0, rawHash);
  const part: BillPart = { kind: "PART", parserVersion: "legiscan-bulk/4", sourceRawHash: rawHash, dataset, state: "AZ", capturedAt: "2026-10-24",
    counts: { rows: 1, joined: 1, unjoined: 0, sponsorsJoined: 1, sponsorsUnjoined: 0 },
    sponsors: [{ peopleId: 10704, name: "Filed sponsor", committee: false, nativeIds: { "ocd-person": [personId] }, officeholderId: `plural:az:${personId.slice(11)}`, joinReason: null }],
    bills: [{ id: "legiscan:bill:1", billId: 1, state: "AZ", sessionId: 2235, sessionName: "Synthetic session", ocdId: "ocd-division/country:us/state:az", fips: "04",
      number: "SB1", title: "Synthetic bill", description: "Synthetic source record", status: 1, statusLabel: "Introduced", statusDate: "2026-01-01",
      sourceUrl: "https://legiscan.com/AZ/bill/SB1/2026", governmentUrl: "https://example.gov/bills/SB1", governmentSourceOfficial: true, sponsorRefs: [0], texts: [] }] };
  const heldPart = provenEdgeEntry({ recordClass: "STATE_BILL", scope, sourceId: "legiscan-bills", versionId: "test:cl01-native-record-part", value: part });
  const session: BillSession = { kind: "SESSION", parserVersion: "legiscan-bulk/4", dataset, state: "AZ", capturedAt: part.capturedAt,
    parts: [{ scope, versionId: heldPart.projection.versionId, rawHash, rows: 1 }], counts: part.counts };
  const entries = [state, heldPart,
    provenEdgeEntry({ recordClass: "STATE_BILL", scope: billScope(2235), sourceId: "legiscan-bills", versionId: "test:cl01-native-record-session", value: session }),
    provenEdgeEntry({ recordClass: "STATE_BILL", scope: LEGISCAN_BULK_SCOPE, sourceId: "legiscan-bills", versionId: "test:cl01-native-record-index", value: { kind: "INDEX", parserVersion: "legiscan-bulk/4", capturedAt: part.capturedAt, datasets: [dataset] } }),
  ];
  const expected = await readBillsForState("AZ", { store: storeFor(entries), person: toSeatHolder(person) });
  assert.equal(expected.bills.length, 1);
  const peopleKeys = statePeopleSourcePointers("US-AZ").map(pointer => `${pointer.recordClass}:${pointer.scope}`);
  const allowed = new Set([...peopleKeys, ...entries.map(entry => entry.projection.key)]);
  const selected: string[][] = [];
  installReaderDatabaseQuery(async statements => statements.map(statement => {
    const keys = canonicalStatementKeys(statement.params[0]);
    assert.ok(Array.isArray(keys), "no geography/state-package query is allowed");
    assert.ok(keys.every(key => typeof key === "string" && allowed.has(key)), "only people and bill authorities are read");
    selected.push(keys);
    return entries.filter(entry => keys.includes(entry.projection.key)).map(entry => {
      const row={ row_kind: "promotion", key: entry.projection.key,
        record_class: entry.projection.recordClass, scope: entry.projection.scope, source_id: entry.projection.sourceId,
        current_version_id: entry.projection.versionId, last_known_good_version_id: entry.projection.versionId,
        promoted_at: entry.projection.promotedAt, validation_receipt: entry.projection.receipt, payload: entry.projection.payload,
        normalized_hash: entry.attested.payloadSha256, retrieved_at: entry.attested.retrievedAt, published: true };
      if(statement.text.includes("AS source_nonempty")){
        const index=entry.projection.payload as {datasets:Dataset[]};
        return {...row,source_nonempty:index.datasets.length>0,payload:{...index,datasets:statement.params[2]?[]:index.datasets.filter(dataset=>dataset.state_id===statement.params[1])}};
      }
      if(statement.text.includes("AS full_rows") || statement.text.includes("AS bills")){
        assert.equal(entry.projection.key,heldPart.projection.key);
        const {bills,sponsors,...header}=part;
        const dictionary=sponsors.map((value,index)=>({index,value}));
        if(statement.text.includes("AS full_rows"))return {...row,payload:header,full_rows:bills.length,sponsors:dictionary};
        assert.deepEqual(JSON.parse(String(statement.params[1])),[{scope,version:heldPart.projection.versionId,indices:[0]}]);
        return {...row,payload:header,bills,sponsors:dictionary};
      }
      return row;
    });
  }));
  try {
    for (const member of [person.id, "az-legislature:old-id"]) {
      const response = await bills(new Request(`https://meanwhile.test/api/bills?state=AZ&member=${member}`));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected);
    }
    const unresolved = await bills(new Request("https://meanwhile.test/api/bills?state=AZ&member=az-legislature:unknown"));
    assert.deepEqual(await unresolved.json(), { bills: [], complete: false, checkedAt: expected.checkedAt });
    assert.ok(selected.some(keys => keys.length === peopleKeys.length && peopleKeys.every(key => keys.includes(key))));
  } finally { installReaderDatabaseQuery(undefined); }
});

test("the scoped native identity emits the identical vote record without a full holder", async () => {
  const identity = await readHeldPersonIdentity(person.id, { store: storeFor([state]) });
  assert.ok(identity);
  const readers: NativeMemberVoteReaders = { holder: async () => toSeatHolder(person), nh: async () => null, official: async () => null,
    legiscan: async () => [], plural: async (_state, id) => {
      assert.equal(id, personId);
      return [{ id: "synthetic:vote:1", billId: "synthetic:bill:1", billNumber: "SB1", billTitle: "Synthetic roll call", session: "2026", organizationId: "synthetic:senate", chamber: "upper",
        date: "2026-09-01", motion: "Third reading", result: "pass", counts: [], positions: [], unresolvedPositions: 0,
        sourceUrls: ["https://example.gov/roll/1"], sourceApiUrl: "https://example.gov/api/roll/1", retrievedAt: "2026-10-24", position: "yes" }];
    } };
  const expected = await readNativeMemberVotes(person.id, readers);
  assert.equal(expected?.status, "HELD");
  const scoped = await readNativeMemberVotes(person.id, { ...readers, holder: async () => ({
    id: identity.id, personId: identity.personId, nativeIds: identity.nativeIds,
    provenance: identity.provenance, fieldSources: identity.fieldSources,
  }) });
  assert.deepEqual(scoped, expected);
});
