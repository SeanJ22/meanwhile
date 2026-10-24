import assert from "node:assert/strict";
import test from "node:test";
import { factDb } from "./helpers/fact-db.ts";
import { identitySourceTables, identityEventTables, readerIdentityMigration } from "./helpers/reader-identity-db.ts";
import { resolveId, syncReaderIds } from "../lib/core/resolve.ts";
import { ALIAS_STATES, readAliasCounts, type AliasCount } from "../lib/core/aliases.ts";
import { SHARED_WORK_DDL } from "../lib/control-plane/repository/migrations/RB-A1.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { NextRequest } from "next/server";
import { GET as aliasesGET } from "../app/api/admin/v6/data/aliases/route.ts";
import { adminSessionCookie, ADMIN_HOST, withAdminSessionKey } from "./admin-session.ts";

async function database() {
  const db = await factDb();
  await identitySourceTables(db.pg);
  await identityEventTables(db.pg);
  return db;
}

test("both shared schemas preserve held rows, distinguish ZIP from ZCTA, and allow two boundary years", async () => {
  const db = await database();
  try {
    await db.pg.exec(`INSERT INTO entity(id,kind,name) VALUES('place','place','Place'),('body','body','Body');
      INSERT INTO entity_place(entity_id,place_id) VALUES('body','place')`);
    await db.pg.exec(readerIdentityMigration());
    assert.deepEqual(await db.query("SELECT boundary_year FROM entity_place"), [{ boundary_year: 0 }]);
    await db.pg.exec(`INSERT INTO entity_place(entity_id,place_id,boundary_year) VALUES('body','place',2020),('body','place',2030);
      INSERT INTO zip_place VALUES('00123','place',0.6,2020);
      INSERT INTO zcta_place VALUES('00123','place',0.9,2020)`);
    assert.equal((await db.query("SELECT share FROM zip_place"))[0]!.share, 0.6);
    assert.equal((await db.query("SELECT share FROM zcta_place"))[0]!.share, 0.9);
    for (const statement of SHARED_WORK_DDL) await db.pg.exec(statement);
    for (const statement of SHARED_WORK_DDL) await db.pg.exec(statement);
    await db.pg.exec("INSERT INTO work_row(id,kind,state) VALUES('read','read','AZ'),('audit','audit','NH')");
    const [index] = await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='work_row_ready'");
    assert.match(String(index!.indexdef), /lease_until IS NULL/);
    await assert.rejects(db.pg.exec("INSERT INTO work_row(id,kind,state) VALUES('bad','approve','AZ')"), /check constraint/);
  } finally { await db.pg.close(); }
});

test("all four event sources reuse exact identities and source crosswalks; future roll calls and provisions survive the next pass", async () => {
  const db = await database();
  try {
    await db.pg.exec(`INSERT INTO entity(id,kind,name,state) VALUES('person','person','Person','AZ'),('body','body','Body','AZ'),
      ('congress-api:A000001','person','Person from another source','AZ'),
      ('meeting:legistar:example:123','meeting','Meeting','AZ');
      INSERT INTO entity_external_id VALUES('person','campaign-person:AZ','candidate|Person'),('person','bioguide','A000001');
      INSERT INTO civic_data_promotions VALUES('funding','FEC_FUNDING','federal-supported',
        '{"candidates":[{"fecCandidateId":"S0AZ00001","name":"Person","state":"AZ","targetKeys":["candidate|Person","congress:A000001"]}]}');
      INSERT INTO reactions VALUES('candidate|Person','CANDIDATE'),('house:120-1:999','FEDERAL_VOTE'),('S0AZ00001','CONTRIBUTOR_REACTION');
      INSERT INTO speak_your_mind VALUES('body','BODY'),('legistar:example:123','MEETING'),('congress:A000001','OFFICIAL');
      INSERT INTO demand_signals VALUES('candidate|Person','CANDIDATE');
      INSERT INTO ask_interactions VALUES('["body","ballot-az-anywhere:measure#new-part"]')`);
    await db.pg.exec(readerIdentityMigration());
    assert.equal(await resolveId("candidate|Person", db.query), "person");
    assert.equal(await resolveId("S0AZ00001", db.query), "person");
    assert.equal(await resolveId("fec:S0AZ00001", db.query), "person");
    assert.equal(await resolveId("house:120-1:999", db.query), "house:120-1:999");
    assert.equal(await resolveId("legistar:example:123", db.query), "meeting:legistar:example:123");
    assert.equal(await resolveId("congress:A000001", db.query), "congress-api:A000001");
    assert.equal(await resolveId("ballot-az-anywhere:measure#new-part", db.query), "ballot-az-anywhere:measure#new-part");
    const before = await db.query("SELECT count(*)::int n FROM entity");
    await syncReaderIds(db.query);
    assert.deepEqual(await db.query("SELECT count(*)::int n FROM entity"), before);
    await db.pg.exec(`INSERT INTO reactions VALUES('senate:121-2:12','FEDERAL_VOTE'),('new-measure#oversight','MEASURE_PROVISION');
      INSERT INTO ask_interactions VALUES('["fec:S0AZ00001"]')`);
    await syncReaderIds(db.query);
    assert.equal(await resolveId("senate:121-2:12", db.query), "senate:121-2:12");
    assert.equal((await db.query("SELECT kind FROM entity WHERE id='new-measure#oversight'"))[0]!.kind, "measure_provision");
    assert.equal(await resolveId("unknown", db.query), null);
    const counts = await readAliasCounts(db.query);
    assert.equal(counts.length, ALIAS_STATES.length);
    assert.equal(counts.find(row => row.state === "AZ")!.n, 3);
    assert.equal(counts.find(row => row.state === "WY")!.n, 0);
    await db.pg.exec(`UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{candidates}',payload->'candidates'||
      '[{"fecCandidateId":"S8WY00999","name":"New filer","state":"WY","targetKeys":["congress:Z000999"]}]'::jsonb);
      INSERT INTO reactions VALUES('S8WY00999','FUNDING_TOTAL_REACTION')`);
    await syncReaderIds(db.query);
    assert.equal(await resolveId("S8WY00999", db.query), "congress-api:Z000999");
    assert.equal(await resolveId("congress:Z000999", db.query), "congress-api:Z000999");
    await db.pg.exec("DELETE FROM civic_data_promotions");
    await syncReaderIds(db.query);
    assert.equal(await resolveId("S0AZ00001", db.query), "person", "a source refresh cannot orphan its saved FEC alias");
    await db.pg.exec("INSERT INTO entity_external_id VALUES('body','other','candidate|Person')");
    await assert.rejects(resolveId("candidate|Person", db.query), /Ambiguous/);
  } finally { await db.pg.close(); }
});

test("Admin's alias route returns every state's count and keeps its sign-in requirement", async () => {
  const db = await database();
  try {
    await db.pg.exec(readerIdentityMigration());
    await db.pg.exec(`INSERT INTO entity(id,kind,name,state) VALUES('person','person','Person','AZ');
      INSERT INTO entity_external_id VALUES('person','fec','S0AZ00001')`);
    installFactReader(db.query);
    await withAdminSessionKey(async () => {
      const response = await aliasesGET(new NextRequest(`https://${ADMIN_HOST}/api/admin/v6/data/aliases`, {
        headers: { host: ADMIN_HOST, cookie: await adminSessionCookie() },
      }));
      assert.equal(response.status, 200);
      const { counts } = await response.json() as { counts: readonly AliasCount[] };
      assert.equal(counts.length, ALIAS_STATES.length);
      assert.equal(counts.find(row => row.state === "AZ").n, 1);
      assert.equal(counts.find(row => row.state === "WY").n, 0);
      assert.equal((await aliasesGET(new NextRequest(`https://${ADMIN_HOST}/api/admin/v6/data/aliases`, {
        headers: { host: ADMIN_HOST },
      }))).status, 401);
    });
  } finally { installFactReader(undefined); await db.pg.close(); }
});

