import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { historicalVoteBillVersionsRead, pointerMoveChainRead } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { holdCivicVersion } from "../lib/civic-data/version-vault.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";

test("bill history searches only anchored candidates, distinguishes HR1 from HR10, and retains unreadable candidates for proof", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE civic_data_candidates(id text, candidate jsonb, normalized_hash text, read_model_fingerprint text); CREATE TABLE civic_data_promotions(current_version_id text, payload jsonb); CREATE TABLE civic_data_payload_parts(hash text, payload jsonb)");
    const readerFunctions = readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8")
      .split("--> statement-breakpoint").filter(sql=>/^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(sql));
    for(const statement of readerFunctions)await pg.exec(statement);
    for (const [id, readModel] of Object.entries({
      member: { votes: [{ legisNum: "H.R. 1" }] },
      window: { snapshot: { votes: [{ title: "On passage of H.R. 1" }] } },
      otherBill: { snapshot: { votes: [{ legisNum: "H.R. 10" }] } },
      directEmpty: { votes: [], snapshot: { votes: [{ legisNum: "H.R. 1" }] } },
      scalars: { votes: [null, 42, "H.R. 1", { legisNum: "H.R. 1" }] },
      encodedNonmatch: { votes: [{ legisNum: "H.R. 10", detail: { $civicPayloadPart: "encoded" } }] },
      encoded: { $civicPayloadPart: "encoded" },
      unrelated: { votes: [{ legisNum: "H.R. 1" }] },
    })) await pg.query("INSERT INTO civic_data_candidates(id,candidate) VALUES($1,$2)", [id, { readModel }]);
    await pg.query("INSERT INTO civic_data_candidates(id,candidate) VALUES($1,$2)",["encodedEnvelope",{$civicPayloadPart:"encoded"}]);
    await pg.query("INSERT INTO civic_data_promotions VALUES($1,$2)",["member",{votes:[{legisNum:"H.R. 10"}]}]);
    const vault=new MemoryEvidenceStore();
    const model={votes:[{title:"On passage of H.R. 1",text:"unrelated source text ".repeat(20_000)}]};
    const fingerprint=canonicalCivicDataHash(model,{durable:true}),ref=await holdCivicVersion(vault,model,fingerprint);
    await pg.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,$3)",["vaulted",{vault:{readModel:ref}},fingerprint]);
    const get=vault.get.bind(vault);let unrelatedRead=false;
    vault.get=async key=>{const object=await get(key);if(object&&new TextDecoder().decode(object.bytes).includes("unrelated source text"))unrelatedRead=true;return object;};
    const query=async(text:string,params:readonly unknown[]=[]) => (await pg.query<Record<string,unknown>>(text,[...params])).rows;
    const result = await historicalVoteBillVersionsRead(query,vault, ["member", "window", "otherBill", "directEmpty", "scalars", "encoded", "encodedNonmatch", "encodedEnvelope", "missing", "vaulted"], "hr1");
    assert.deepEqual(result.rows.map(row => row.id).sort(), ["encoded", "encodedNonmatch", "member", "missing", "scalars", "vaulted", "window"]);
    assert.equal(unrelatedRead,false,"the vault scan does not load unrelated source text");
    assert.throws(() => historicalVoteBillVersionsRead(query,vault, ["member"], "hr1) OR true"), /BILL_INVALID/);
  } finally { await pg.close(); }
});

test("Ask history reads its anchored chain in one query, retaining ambiguous links and terminating cycles", async () => {
  const pg = new PGlite();
  const key = "FEDERAL_ROLL_CALL:member:example";
  try {
    await pg.exec("CREATE TABLE civic_data_candidate_events(candidate_id text, sequence integer, state text, at timestamptz, detail text)");
    const move = (id: string, previous: string, sequence = 1) => pg.query(
      "INSERT INTO civic_data_candidate_events VALUES($1,$2,'PROMOTED','2026-10-18',$3)",
      [id, sequence, `Atomic pointer ${key} moved from ${previous} to ${id}.`]);
    await move("v3", "v2"); await move("v2", "v1"); await move("v1", "bootstrap/no-version");
    await move("unrelated", "bootstrap/no-version");
    await pg.exec("INSERT INTO civic_data_candidate_events VALUES('v3',2,'NORMALIZED','2026-10-18','Short message')");
    let queries = 0;
    const db = { execute: async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      queries++; const query = new PgDialect().sqlToQuery(statement);
      return pg.query(query.sql, query.params);
    } } as unknown as Parameters<typeof pointerMoveChainRead>[0];
    const read = () => pointerMoveChainRead(db, key, "v3");
    const first = await read();
    assert.equal(queries, 1);
    assert.deepEqual(first.rows.map(row => row.candidateId).sort(), ["v1", "v2", "v3"]);
    await move("v2", "other", 2);
    const ambiguous = await read();
    assert.equal(ambiguous.rows.filter(row => row.candidateId === "v2").length, 2);
    await pg.exec("DELETE FROM civic_data_candidate_events WHERE candidate_id='v2' AND sequence=2");
    await pg.query("UPDATE civic_data_candidate_events SET detail=$1 WHERE candidate_id='v1'",
      [`Atomic pointer ${key} moved from v3 to v1.`]);
    const cycle = await read();
    assert.deepEqual(cycle.rows.map(row => row.candidateId).sort(), ["v1", "v2", "v3"]);
  } finally { await pg.close(); }
});
