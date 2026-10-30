import assert from "node:assert/strict";
import { test } from "node:test";
import { nationalCongress, nationalPresident } from "../lib/reader/national.ts";
import { refreshNationalShelf } from "../lib/reader/shelf.ts";
import { Pool } from "@neondatabase/serverless";
import { PGlite } from "@electric-sql/pglite";
import { unwrapVersionedStatement } from "./helpers/versioned-neon-fixture.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import { readerOfficeholders } from "../lib/ask/server-sources.ts";
import { composeReaderOfficials, readerOfficialsQuestion } from "../lib/ask/reader-officials.ts";

test("separately loaded server module contexts share resource containers", async () => {
  const firstUrl = new URL("../lib/reader/memory.ts?context=page", import.meta.url).href;
  const secondUrl = new URL("../lib/reader/memory.ts?context=api", import.meta.url).href;
  const first = await import(firstUrl) as typeof import("../lib/reader/memory.ts");
  const second = await import(secondUrl) as typeof import("../lib/reader/memory.ts");
  let loads = 0;
  const key = "test:separate-server-contexts";
  const a = first.serverReaderValue(key, () => { loads++; return { localFile: Promise.resolve("immutable build data") }; });
  const b = second.serverReaderValue(key, () => { loads++; return { localFile: Promise.resolve("incorrect duplicate") }; });
  assert.equal(a, b);
  assert.equal(await a.localFile, "immutable build data");
  assert.equal(loads, 1);
});

test("the President is held in memory: loaded once for every caller, independent of a blocked Congress load, read again only when its rows change, and kept when a check fails", async () => {
  const priorUrl = process.env.DATABASE_URL, priorConnect = Pool.prototype.connect;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@national-reader.invalid/fixture";
  const pg = new PGlite();
  const at = "2026-10-18T00:00:00.000Z", scope = "US:people:statewide-executive-sources:v1";
  const holder = { id: "white-house:current-president", name: "An Official President", officeTitle: "President of the United States",
    level: "FEDERAL", provenance: { sourceUrl: "https://www.whitehouse.gov/administration/current-president/", sourceOrg: "The White House", collectedAt: at, verifiedAt: at } };
  const vice = { ...holder, id: "white-house:current-vice-president", name: "An Official Vice President", officeTitle: "Vice President of the United States" };
  const payload = { formatVersion: 1, sourceId: "statewide-executive-sources", jurisdiction: "US", generatedAt: at,
    roster: { scope: "us", generatedAt: at, officeholders: [holder, vice],
      divisions: [holder, vice].map(person => ({ officeholderId: person.id, ocdId: "ocd-division/country:us", bodyId: null })), unmatched: [] } };
  const receipt = { contractVersion: 2, decision: "GOOD", candidateId: "president-version", sourceId: "statewide-executive-sources", recordClass: "STATE_LEGISLATOR", scope,
    validatedAt: at, checks: VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: "FIXTURE", detail: "Published source fixture" })), excludedFacts: [] };
  await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,source_id text,
    current_version_id text,last_known_good_version_id text,promoted_at timestamptz,validation_receipt jsonb,payload jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,state text,
    acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,retrieved_at timestamptz);
    CREATE TABLE civic_data_candidate_events(candidate_id text,sequence integer,detail text);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb);
    ALTER TABLE civic_data_candidates ADD COLUMN read_model_fingerprint text;
    ALTER TABLE civic_data_promotions ADD COLUMN payload_fingerprint text;`);
  await pg.query("INSERT INTO civic_data_promotions VALUES($1,'STATE_LEGISLATOR',$2,'statewide-executive-sources','president-version','president-version',$3,$4,$5)",
    [`STATE_LEGISLATOR:${scope}`, scope, at, receipt, payload]);
  await pg.query("INSERT INTO civic_data_candidates VALUES('president-version','STATE_LEGISLATOR',$1,'statewide-executive-sources','PROMOTED',true,'president-version','president-version',$2,$3)",
    [scope, canonicalCivicDataHash(payload), at]);
  const calls: string[][] = [];
  let releaseCongress: (() => void) | undefined, congressComplete = false, unavailable = false;
  const blocked = new Promise<void>(resolve => { releaseCongress = resolve; });
  Pool.prototype.connect = (async () => ({ release() {}, query: async (text: string, params: unknown[]) => {
    const native = unwrapVersionedStatement(text, params);
    const keys = native.params[0] as string[];
    calls.push(keys);
    const congress = keys.some(key => key.startsWith("FEDERAL_DIRECTORY:"));
    if (congress) { await blocked; congressComplete = true; }
    else if (unavailable) throw new Error("national version read unavailable");
    return { rows: (await pg.query<Record<string, unknown>>(text, params)).rows };
  } })) as unknown as typeof Pool.prototype.connect;
  let national: Promise<unknown> | undefined;
  const presidentReads = () => calls.filter(keys => keys.every(key => !key.startsWith("FEDERAL_DIRECTORY:"))).length;
  try {
    national = nationalCongress().catch((error: unknown) => error);
    const [first, second, officials] = await Promise.all([nationalPresident(), nationalPresident(),
      readerOfficeholders(["ocd-division/country:us/state:az"], [], ["us_president", "us_vice_president"])]);
    assert.deepEqual(first, second);
    assert.equal(first?.officeholders[0].name, holder.name);
    assert.equal(officials.loaderFailures, 0);
    for (const [office, person] of [["president", holder], ["vice president", vice]] as const) {
      const ask = readerOfficialsQuestion(`Who is the ${office} of the United States?`)!;
      const answer = composeReaderOfficials({ ask, held: officials.held, holdingFailed: false });
      assert.ok(answer?.answer.includes(person.name));
      assert.notEqual(answer?.missingAnswer, true);
      assert.deepEqual(answer?.named.map(row => row.seat.id), [person.id]);
    }
    assert.equal(congressComplete, false, "the President is usable while the national Congress read is still blocked");
    assert.equal(presidentReads(), 2, "one version read and one body read serve the two readers and Ask");
    assert.equal((await nationalPresident())?.officeholders[0].name, holder.name);
    assert.equal(presidentReads(), 2, "once held, a read asks the database nothing");
    assert.ok(calls.find(keys => keys.some(key => key.startsWith("FEDERAL_DIRECTORY:")))?.every(key => key.startsWith("FEDERAL_DIRECTORY:")), "the Congress query carries no President source dependency");
    holder.name = "Newly Published President";
    await pg.query("UPDATE civic_data_promotions SET payload=$1 WHERE key=$2", [payload, `STATE_LEGISLATOR:${scope}`]);
    await pg.query("UPDATE civic_data_candidates SET normalized_hash=$1 WHERE id='president-version'", [canonicalCivicDataHash(payload)]);
    await refreshNationalShelf();
    assert.equal((await nationalPresident())?.officeholders[0].name, holder.name, "a changed row under the same pointer is read at the next check, without a TTL or a new pointer id");
    assert.equal(presidentReads(), 4, "the check read the version, then the changed body");
    await refreshNationalShelf();
    assert.equal(presidentReads(), 5, "a check of an unchanged President is one small version read");
    await pg.query("UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{roster,officeholders,0,name}','\"Unverified mutation\"') WHERE key=$1", [`STATE_LEGISLATOR:${scope}`]);
    await assert.rejects(refreshNationalShelf(), /READER_PUBLISHED_PAYLOAD_HASH_MISMATCH/, "changed payload bytes with an unchanged proof are never held");
    assert.equal((await nationalPresident())?.officeholders[0].name, holder.name, "the last verified body stays");
    await pg.query("UPDATE civic_data_promotions SET payload=$1 WHERE key=$2", [payload, `STATE_LEGISLATOR:${scope}`]);
    unavailable = true;
    await assert.rejects(refreshNationalShelf(), /national version read unavailable/);
    assert.equal((await nationalPresident())?.officeholders[0].name, holder.name, "a failed check keeps serving what is held");
  } finally {
    releaseCongress!();
    await national;
    Pool.prototype.connect = priorConnect;
    if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
    await pg.close();
  }
});
