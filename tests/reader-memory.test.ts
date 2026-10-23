import assert from "node:assert/strict";
import { test } from "node:test";
import { readerMemory, readZipPlaces, stateForZip, readNationalPresident, readNationalShelf, readStateZipPlaces } from "../lib/reader/national.ts";
import { Pool } from "@neondatabase/serverless";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";

test("cold readers share one load and refresh keeps already verified information usable", async () => {
  let loads = 0, complete: ((value: string) => void) | undefined;
  const read = readerMemory(() => { loads++; return new Promise<string>(resolve => { complete = resolve; }); }, 0);
  const first = read(), second = read();
  await Promise.resolve();
  assert.equal(loads, 1);
  complete!("first verified version");
  assert.deepEqual(await Promise.all([first, second]), ["first verified version", "first verified version"]);
  assert.equal(await read(), "first verified version");
  await Promise.resolve();
  assert.equal(loads, 2);
  complete!("newly published version");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await read(), "newly published version");
  complete!("newly published version");
});

test("a failed refresh retains the last verified publication", async () => {
  let fail = false;
  const read = readerMemory(async () => { if (fail) throw new Error("store offline"); return "verified"; }, 0);
  assert.equal(await read(), "verified");
  fail = true;
  assert.equal(await read(), "verified");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await read(), "verified");
});

test("the national ZIP shelf is shared and identifies place and state without waiting on people", async () => {
  assert.equal(stateForZip("85701"), "AZ");
  assert.equal(stateForZip("not-a-zip"), null);
  const [first, second] = await Promise.all([readZipPlaces(), readZipPlaces()]);
  assert.equal(first, second);
  assert.ok(first.size > 30_000);
  assert.ok(first.get("85701")?.ids.includes("ocd-division/country:us/state:az/county:pima"));
  const mailOnly = first.get("85001");
  assert.ok(mailOnly?.ids.includes("ocd-division/country:us/state:az/county:maricopa"));
  assert.ok(!mailOnly?.ids.some(id => /\/(?:cd|sldu|sldl):/.test(id)));
  assert.equal(mailOnly?.samples, 0);
});

test("every state ZIP index exactly preserves the national shelf's touching ZIPs and postal uncertainty", async () => {
  const places = await readZipPlaces();
  assert.equal(places.size,41831);
  for (const state of REGISTRY_STATES) {
    const own = new RegExp(`/(?:state|territory|district):${state.toLowerCase()}(?:/|$)`);
    const expected = [...places].filter(([,entry]) => entry.ids.some(id => own.test(id)));
    const indexed = await readStateZipPlaces(state);
    assert.deepEqual([...indexed],expected,`${state}: exact ZIP ordering, IDs, partial divisions, and sample counts`);
  }
  assert.ok((await readStateZipPlaces("TN")).has("42223"),"a Kentucky postal ZIP where 7,307 Tennesseans live is in Tennessee's package");
  assert.ok((await readStateZipPlaces("KY")).has("42223"));
  assert.ok(!(await readStateZipPlaces("AL")).has("30165"),"51 of 30165's 41,943 residents live in Alabama: its Alabama places are named, not governing");
  assert.ok((await readStateZipPlaces("GA")).has("30165"));
  assert.equal((await readStateZipPlaces("US-AZ")).get("85001"),places.get("85001"),"mail-only aliases reuse their filtered town and county facts");
});

test("separately loaded server module contexts share the same shelf and pending read", async () => {
  const firstUrl = new URL("../lib/reader/memory.ts?context=page", import.meta.url).href;
  const secondUrl = new URL("../lib/reader/memory.ts?context=api", import.meta.url).href;
  const first = await import(firstUrl) as typeof import("../lib/reader/memory.ts");
  const second = await import(secondUrl) as typeof import("../lib/reader/memory.ts");
  let loads = 0;
  const key = "test:separate-server-contexts";
  const a = first.serverReaderValue(key, () => first.readerMemory(async () => { loads++; return { verified: true }; }));
  const b = second.serverReaderValue(key, () => second.readerMemory(async () => { loads++; return { verified: false }; }));
  assert.equal(a, b);
  const [page, api] = await Promise.all([a(), b()]);
  assert.equal(page, api); assert.equal(loads, 1); assert.equal(api.verified, true);
});

test("a cold President read shares its national source load without waiting for Congress", async () => {
  const priorUrl = process.env.DATABASE_URL, priorQuery = Pool.prototype.query;
  process.env.DATABASE_URL = "postgresql://fixture:fixture@national-reader.invalid/fixture";
  const at = "2026-10-18T00:00:00.000Z", scope = "US:people:statewide-executive-sources:v1";
  const holder = { id: "white-house:current-president", name: "An Official President", officeTitle: "President of the United States",
    level: "FEDERAL", provenance: { sourceUrl: "https://www.whitehouse.gov/administration/current-president/", sourceOrg: "The White House", collectedAt: at, verifiedAt: at } };
  const payload = { formatVersion: 1, sourceId: "statewide-executive-sources", jurisdiction: "US", generatedAt: at,
    roster: { scope: "us", generatedAt: at, officeholders: [holder], divisions: [{ officeholderId: holder.id, ocdId: "ocd-division/country:us", bodyId: null }], unmatched: [] } };
  const calls: string[][] = [];
  let releaseCongress: (() => void) | undefined, congressComplete = false;
  const blocked = new Promise<void>(resolve => { releaseCongress = resolve; });
  Pool.prototype.query = (async (_text: string, params: unknown[]) => {
    const keys = params[0] as string[];
    calls.push(keys);
    const congress = keys.some(key => key.startsWith("FEDERAL_DIRECTORY:"));
    if (congress) { await blocked; congressComplete = true; }
    const rows = congress ? [] : [{ row_kind: "promotion", key: `STATE_LEGISLATOR:${scope}`, record_class: "STATE_LEGISLATOR", scope, source_id: "statewide-executive-sources",
      current_version_id: "president-version", last_known_good_version_id: "president-version", promoted_at: at, retrieved_at: at,
      validation_receipt: { contractVersion: 2, decision: "GOOD", candidateId: "president-version", sourceId: "statewide-executive-sources", recordClass: "STATE_LEGISLATOR", scope,
        validatedAt: at, checks: VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: "FIXTURE", detail: "Published source fixture" })), excludedFacts: [] },
      normalized_hash: canonicalCivicDataHash(payload), payload, published: true }];
    return { rows };
  }) as unknown as typeof Pool.prototype.query;
  let national: Promise<unknown> | undefined;
  try {
    national = readNationalShelf().catch(error => error);
    const [first, second] = await Promise.all([readNationalPresident(), readNationalPresident()]);
    assert.equal(first, second);
    assert.equal(first?.officeholders[0].name, holder.name);
    assert.equal(congressComplete, false, "the President is usable while the national Congress read is still blocked");
    assert.equal(calls.filter(keys => keys.every(key => !key.startsWith("FEDERAL_DIRECTORY:"))).length, 1);
    assert.ok(calls.find(keys => keys.some(key => key.startsWith("FEDERAL_DIRECTORY:")))?.every(key => key.startsWith("FEDERAL_DIRECTORY:")), "the Congress query carries no President source dependency");
  } finally {
    releaseCongress!();
    await national;
    Pool.prototype.query = priorQuery;
    if (priorUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorUrl;
  }
});
