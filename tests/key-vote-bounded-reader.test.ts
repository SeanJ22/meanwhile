import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { FEDERAL_KEY_VOTE_SCOPE, FEDERAL_VOTES_SOURCE_ID } from "../lib/votes/data-plane.ts";
import { federalKeyVoteSelectionV1Snapshot } from "../lib/votes/key-vote-selection-v1.ts";
import { readFederalKeyVoteSelection, readLegacyFederalKeyVoteMember } from "../lib/votes/key-votes-projection.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";

test("a legacy key-vote publication sends the reviewed metadata and one member's positions with original proof and dates",async()=>{
  const pg=new PGlite(),snapshot=federalKeyVoteSelectionV1Snapshot("2026-10-18T12:00:00Z"),member="congress:A000001";
  const refs=snapshot.entries.flatMap(entry=>[...entry.house.map(ref=>`${entry.id}|house|${ref.congress}-${ref.session}:${ref.rollNumber}`),...entry.senate.map(ref=>`${entry.id}|senate|${ref.congress}-${ref.session}:${ref.rollNumber}`)]);
  const positions=Object.fromEntries(refs.map(key=>[key,{[member]:"YES",...Object.fromEntries(Array.from({length:1000},(_,n)=>[`congress:B${String(n).padStart(6,"0")}`,"NO"]))}]));
  const value={formatVersion:1,selectionVersion:"v1",snapshot,positions:{formatVersion:1,fetchedAt:"2026-10-18T11:59:00Z",positions}},encoded=partitionCivicPayload(value);
  const transferred:unknown[]=[];
  const query:ReadOnlyQuery=async statements=>{
    const results=[];
    for(const statement of statements) {const rows=(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows;transferred.push(rows);results.push(rows);}
    return results;
  };
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    for(const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    await insertPublishedSliceFixture(pg, {id: "v1", sourceId: FEDERAL_VOTES_SOURCE_ID, recordClass: "FEDERAL_KEY_VOTE", scope: FEDERAL_KEY_VOTE_SCOPE,
      readModel: value, storedReadModel: encoded.value, at: "2026-10-18T12:01:00Z"});
    const selection=await readFederalKeyVoteSelection(query);
    assert.equal(selection?.versionId,"v1");assert.equal(selection?.publication.input.readModelSha256,canonicalCivicDataHash(value));
    assert.equal(selection?.value.positions.fetchedAt,value.positions.fetchedAt);
    assert.ok(Object.values(selection!.value.positions.positions).every(map=>Object.keys(map).length===0));
    const own=await readLegacyFederalKeyVoteMember(member,query);
    assert.equal(own?.positions.fetchedAt,value.positions.fetchedAt);
    assert.equal(Object.keys(own!.positions.positions).length,refs.length);
    assert.ok(Object.values(own!.positions.positions).every(map=>map[member]==="YES"&&Object.keys(map).length===1));
    assert.ok(!JSON.stringify(transferred).includes('"NO"'),"no other member's positions or retired maps cross the database connection");
  } finally {await pg.close();}
});
