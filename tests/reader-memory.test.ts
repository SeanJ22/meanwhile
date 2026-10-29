import assert from "node:assert/strict";
import { test } from "node:test";
import { nationalPresidentPointers, readNationalPresident, readNationalShelf } from "../lib/reader/national.ts";
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

test("saved President pages stay current and independent of a blocked Congress read, including a changed page under the same pointer", async () => {
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
  const key=`STATE_LEGISLATOR:${scope}`;
  await pg.exec('CREATE TABLE place_page(place_id text PRIMARY KEY,context jsonb)');
  const save=async()=>{
    const row={key,record_class:'STATE_LEGISLATOR',scope,source_id:'statewide-executive-sources',current_version_id:'president-version',last_known_good_version_id:'president-version',
      promoted_at:at,retrieved_at:at,validation_receipt:receipt,payload,normalized_hash:canonicalCivicDataHash(payload),published:true};
    await pg.query("INSERT INTO place_page VALUES('ocd-division/country:us',$1) ON CONFLICT(place_id) DO UPDATE SET context=excluded.context",
      [JSON.stringify({authorityFormat:1,authorityKeys:nationalPresidentPointers().map(row=>`${row.recordClass}:${row.scope}`),authorities:{[key]:row}})]);
  };
  await save();
  const calls: string[][] = [];
  let releaseCongress: (() => void) | undefined, congressComplete = false, unavailable = false;
  const blocked = new Promise<void>(resolve => { releaseCongress = resolve; });
  Pool.prototype.connect = (async () => ({ release() {}, query: async (text: string, params: unknown[]) => {
    const native = unwrapVersionedStatement(text, params);
    const keys = (JSON.parse(String(native.params[0])) as {key:string}[]).map(row=>row.key);
    calls.push(keys);
    const congress = keys.some(key => key.startsWith("FEDERAL_DIRECTORY:"));
    if (congress) { await blocked; congressComplete = true; return {rows:[]}; }
    else if (unavailable) throw new Error("national version read unavailable");
    assert.doesNotMatch(text,/civic_data_(?:promotions|candidates|candidate_events|payload_parts)/);
    return { rows: (await pg.query<Record<string, unknown>>(text, params)).rows };
  } })) as unknown as typeof Pool.prototype.connect;
  let national: Promise<unknown> | undefined;
  const presidentReads = () => calls.filter(keys => keys.every(key => !key.startsWith("FEDERAL_DIRECTORY:"))).length;
  try {
    national = readNationalShelf().catch(error => error);
    const [first, second, officials] = await Promise.all([readNationalPresident(), readNationalPresident(),
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
    assert.equal(presidentReads(), 4, "the national composition, two independent readers, and Ask each confirm stored versions");
    assert.ok(calls.find(keys => keys.some(key => key.startsWith("FEDERAL_DIRECTORY:")))?.every(key => key.startsWith("FEDERAL_DIRECTORY:")), "the Congress query carries no President source dependency");
    holder.name = "Newly Published President";
    await save();
    assert.equal((await readNationalPresident())?.officeholders[0].name, holder.name, "the next read sees changes without waiting for a TTL or a new pointer id");
    assert.equal(presidentReads(), 5);
    await pg.query("UPDATE place_page SET context=jsonb_set(context,ARRAY['authorities',$1,'payload','roster','officeholders','0','name'],'\"Unverified mutation\"')",[key]);
    await assert.rejects(readNationalPresident(), /READER_PUBLISHED_PAYLOAD_HASH_MISMATCH/, "changed payload bytes with an unchanged proof cannot reuse the earlier verified body");
    await save();
    unavailable = true;
    await assert.rejects(readNationalPresident(), /national version read unavailable/, "a failed version read cannot serve the previous national body");
    assert.equal(presidentReads(), 7);
  } finally {
    releaseCongress!();
    await national;
    Pool.prototype.connect = priorConnect;
    if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
    await pg.close();
  }
});
