import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { joinLdaHonoree } from "../lib/sources/congress/lda-honoree.ts";
import { normalizeFederalCaptureWithRoster } from "../lib/sources/congress/normalize.ts";
import { federalCandidate, holdFederalCapture, readFederalSourceProjection } from "../lib/sources/congress/publication.ts";
import { refreshFederalSource } from "../lib/sources/congress/refresh.ts";
import { federalAskEvidence, readFederalMember } from "../lib/sources/congress/reader.ts";
import { ldaHonoreeCaptures, seedSrcCgRoster, SRC_CG_NOW } from "./helpers/src-cg-roster.ts";
import { readFileSync } from "node:fs";
import { readRawCaptureText } from "../lib/civic-data/raw-capture-vault.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { readLdaRosterVersion } from "../lib/sources/congress/lda-roster.ts";
import type { FederalDirectoryCapture } from "../lib/officials/federal-directory-data-plane.ts";

const vault = new MemoryEvidenceStore();

test("real Senate LD-203 honoree strings resolve to one federal roster person, including titles, nicknames and middle initials", async () => {
  const store = new MemoryRoutineDataStore(), roster = await seedSrcCgRoster(store, vault);
  const facts = ldaHonoreeCaptures().flatMap(capture => normalizeFederalCaptureWithRoster({ ...capture, context: { honoreeRosterVersionId: roster.versionId } }, roster));
  for (const [name, bioguide, state] of [
    ["Sen. John Cornyn (R-TX)", "C001056", "TX"], ["Rep. French Hill", "H001072", "AR"],
    ["Sen. Charles E. Schumer", "S000148", "NY"], ["Sen. Charles E. Grassley", "G000386", "IA"], ["Sen. Bernie Sanders", "S000033", "VT"],
  ]) {
    const row = facts.find(row => row.honoreeName === name);
    assert.ok(row, `The real fixture must contain ${name}`); assert.equal(row.bioguideId, bioguide); assert.equal(row.state, state);
    assert.equal(row.honoreeJoin?.status, "JOINED"); assert.ok(row.official && row.publishedAt && row.sourceUrl);
  }
  assert.ok(facts.some(row => row.honoreeJoin?.status === "UNJOINED"));
  assert.equal(facts.length, 464, "Every item in each unchanged real filing survives.");
  assert.ok(!JSON.stringify(facts).includes('"contributor_name"'));
});

test("the federal directory candidate holds roster references, and the LDA roster reads its aliases back from the vault", async () => {
  const store = new MemoryRoutineDataStore(), own = new MemoryEvidenceStore(), roster = await seedSrcCgRoster(store, own);
  const promoted = await store.readCandidate(roster.versionId);
  const [held] = (promoted!.candidate.normalizedPayload as { acquisitions: FederalDirectoryCapture[] }).acquisitions;
  const body = readFileSync(new URL("./fixtures/src-cg/federal-roster.yaml", import.meta.url), "utf8");
  assert.equal("body" in held, false); assert.equal(held.raw.byteLength, Buffer.byteLength(body));
  assert.equal(await readRawCaptureText(own, held.raw), body);
  assert.ok(roster.members.find(row => row.bioguideId === "S000033")!.names.includes("Bernie Sanders"));
});

test("a directory version promoted before the vault still yields its roster, without published aliases", async () => {
  const store = new MemoryRoutineDataStore(), own = new MemoryEvidenceStore(), roster = await seedSrcCgRoster(store, own);
  const promoted = (await store.readCandidate(roster.versionId))!.candidate;
  const body = readFileSync(new URL("./fixtures/src-cg/federal-roster.yaml", import.meta.url), "utf8");
  const legacyPayload = { ...(promoted.normalizedPayload as object), acquisitions: (promoted.normalizedPayload as { acquisitions: FederalDirectoryCapture[] }).acquisitions
    .map(({ raw: _raw, ...row }) => ({ ...row, body })) };
  const legacy = { ...promoted, id: `${promoted.id}-legacy`, normalizedPayload: legacyPayload, normalization: { ...promoted.normalization, normalizedPayloadHash: normalizedHash(legacyPayload) } };
  const legacyStore = new MemoryRoutineDataStore();
  assert.ok((await processRegisteredManualCandidate(legacyStore, "congress-bulk-roster", legacy, SRC_CG_NOW)).promoted);
  const read = await readLdaRosterVersion(legacyStore, own, legacy.id);
  assert.equal(read?.members.length, roster.members.length);
  assert.ok(!read!.members.find(row => row.bioguideId === "S000033")!.names.includes("Bernie Sanders"));
});

test("chamber and state conflicts, ambiguous names, missing honorees and inferred nicknames never publish a member link", async () => {
  const roster = await seedSrcCgRoster(new MemoryRoutineDataStore(), vault);
  const cornyn = roster.members.find(row => row.bioguideId === "C001056")!;
  const ambiguous = { ...roster, members: [...roster.members, { ...cornyn, bioguideId: "X000001", state: "NY" }] };
  assert.equal(joinLdaHonoree("Sen. John Cornyn", ambiguous).join.status, "UNJOINED");
  assert.equal(joinLdaHonoree("Sen. John Cornyn (R-TX)", ambiguous).bioguideId, "C001056");
  for (const name of ["Rep. John Cornyn (R-TX)", "Sen. John Cornyn (R-NY)", "Sen. Charles F. Schumer", "Sen. Husted", "NRSC", "None", "", "Sen. Bernie Sanders, Sen. John Cornyn"]) {
    const result = joinLdaHonoree(name, roster); assert.equal(result.join.status, "UNJOINED", name); assert.equal(result.bioguideId, undefined);
  }
  const noNickname = { ...roster, members: roster.members.map(member => ({ ...member, names: member.names.filter(name => name !== "Bernie Sanders") })) };
  assert.equal(joinLdaHonoree("Sen. Bernie Sanders", noNickname).join.status, "UNJOINED", "A diminutive requires the roster's published nickname.");
  assert.equal(joinLdaHonoree('Sen. Bernard "Bernie" Sanders', roster).bioguideId, "S000033");
  const sameComposite = { ...roster, members: [...roster.members, { ...cornyn, bioguideId: "X000002" }] };
  assert.equal(joinLdaHonoree("Sen. John Cornyn (R-TX)", sameComposite).join.status, "UNJOINED");
});

test("an invented Bioguide join cannot reproduce saved LDA and promoted roster evidence", async () => {
  const store = new MemoryRoutineDataStore(), roster = await seedSrcCgRoster(store, vault);
  const capture = { ...ldaHonoreeCaptures()[0], context: { honoreeRosterVersionId: roster.versionId } };
  const records = normalizeFederalCaptureWithRoster(capture, roster);
  const candidate = federalCandidate({ source: "senate-lda", partition: "filing:tamper", now: SRC_CG_NOW, captures: [await holdFederalCapture(vault, capture)],
    rosters: new Map([[roster.versionId, roster]]), projection: { formatVersion: 1, source: "senate-lda", records: records.map(row => ({ ...row, bioguideId: "S000033" })) } });
  assert.equal(candidate.normalization.succeeded, false); assert.match(candidate.normalization.failureDetail!, /do not reproduce/);
});

test("national LDA pages retain and report unresolved rows while joined facts reach the correct member cards and Ask", async t => {
  t.mock.method(console, "log", () => {});
  const store = new MemoryRoutineDataStore(); await seedSrcCgRoster(store, vault);
  const captures = ldaHonoreeCaptures(), filings = captures.flatMap(capture => JSON.parse(capture.body).results);
  const requests: URL[] = [];
  const result = await refreshFederalSource({ vault, source: "senate-lda", store, env: { LDA_API_KEY: "fixture" }, now: () => SRC_CG_NOW, sleep: async () => {},
    fetchImpl: (async input => {
      const url = new URL(String(input)); requests.push(url);
      const second = url.searchParams.get("page") === "2";
      return Response.json({ count: filings.length, results: second ? filings.slice(2) : filings.slice(0, 2),
        next: second ? null : "https://lda.gov/api/v1/contributions/?page_size=25&filing_year=2026&page=2" });
    }) as typeof fetch });
  assert.equal(result.ok, true); assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.get("page_size"), "25"); assert.ok(requests[0].searchParams.get("filing_dt_posted_after"));
  assert.equal(result.counts.loaded, 464); assert.equal(result.counts.loaded, result.counts.joined + result.counts.unjoined);
  assert.ok(result.counts.joined > 0 && result.counts.unjoined > 0);
  assert.equal(Object.values(result.counts.unjoinedReasons!).reduce((sum, n) => sum + n, 0), result.counts.unjoined);
  for (const state of ["TX", "AR", "NY", "IA", "VT"]) assert.ok(result.counts.byState[state].joined > 0, state);
  for (const filing of filings) {
    const held = await readFederalSourceProjection("senate-lda", `filing:${filing.filing_uuid}`, { store, now: SRC_CG_NOW });
    assert.equal(held.kind, "PROMOTED"); if (held.kind === "PROMOTED") assert.equal(held.value.records.length, filing.contribution_items.length);
  }
  const member = await readFederalMember("congress:C001056", { store, now: SRC_CG_NOW });
  assert.equal(member.contributions.length, 1); assert.equal(member.contributions[0].honoreeName, "Sen. John Cornyn (R-TX)");
  assert.ok(member.sources.some(source => source.provenance.sourceUrl?.includes("lda.gov/filings/")));
  assert.ok(member.sources.some(source => source.what.includes("Honoree identity")));
  const ask = await federalAskEvidence("congress:C001056", "What lobbying contributions were filed?", { store, now: SRC_CG_NOW });
  assert.ok(ask.records.some(row => row.kind === "FINANCE_TRANSACTION"));
  assert.ok(ask.records.some(row => row.text.includes("uniquely matches") && row.sourceUrl?.includes("legislators-current.yaml")));
  assert.deepEqual(ask.gaps, []);
  assert.equal((await readFederalMember("congress:X000001", { store, now: SRC_CG_NOW })).contributions.length, 0);
  // Save exact fixture totals for the READY report; these are not production counts.
  console.info("SRC_CG_2_FIXTURE_COUNTS=" + JSON.stringify(result.counts));
});

test("an amended filing can unjoin a previously matched honoree without leaving stale money on that member's card", async t => {
  t.mock.method(console, "log", () => {});
  const store = new MemoryRoutineDataStore(); await seedSrcCgRoster(store, vault);
  const original = JSON.parse(ldaHonoreeCaptures()[0].body).results[0];
  let filing = original;
  const options = { source: "senate-lda" as const, store, vault, env: { LDA_API_KEY: "fixture" }, now: () => SRC_CG_NOW, sleep: async () => {},
    fetchImpl: (async () => Response.json({ count: 1, results: [filing], next: null })) as typeof fetch };
  assert.equal((await refreshFederalSource(options)).ok, true);
  assert.equal((await readFederalMember("congress:C001056", { store, now: SRC_CG_NOW })).contributions.length, 1);
  // Controlled correction keeps the real filing identity, but changes its honoree to an unresolved list.
  filing = { ...original, contribution_items: original.contribution_items.map((item: object) => ({ ...item, honoree_name: "Sen. John Cornyn, Sen. Bernie Sanders" })) };
  const readPromotion = store.readPromotion.bind(store);
  let failMemberWrite = true;
  store.readPromotion = async (recordClass, scope) => {
    if (failMemberWrite && scope === "senate-lda:congress:C001056") { failMemberWrite = false; throw new Error("Controlled member partition outage"); }
    return readPromotion(recordClass, scope);
  };
  assert.equal((await refreshFederalSource(options)).ok, false);
  // The corrected filing already lost its Bioguide link; its saved cleanup targets must survive.
  const result = await refreshFederalSource(options); assert.equal(result.ok, true); assert.equal(result.counts.joined, 0); assert.equal(result.counts.unjoined, 1);
  assert.equal((await readFederalMember("congress:C001056", { store, now: SRC_CG_NOW })).contributions.length, 0);
  const held = await readFederalSourceProjection("senate-lda", `filing:${original.filing_uuid}`, { store, now: SRC_CG_NOW });
  assert.equal(held.kind, "PROMOTED"); if (held.kind === "PROMOTED") assert.equal(held.value.records[0].honoreeJoin?.status, "UNJOINED");
});

test("an unavailable roster retains all LDA rows and reports the join gap as a successful source check", async t => {
  t.mock.method(console, "log", () => {});
  const store = new MemoryRoutineDataStore(), filing = JSON.parse(ldaHonoreeCaptures()[0].body).results[0];
  const doors: boolean[] = [];
  const result = await refreshFederalSource({ vault, source: "senate-lda", store, now: () => SRC_CG_NOW, sleep: async () => {},
    fetchImpl: (async () => Response.json({ count: 1, results: [filing], next: null })) as typeof fetch, doorOutcome: async ok => { doors.push(ok); } });
  assert.equal(result.ok, true); assert.equal(result.counts.loaded, 1); assert.equal(result.counts.unjoinedReasons?.ROSTER_UNAVAILABLE, 1);
  assert.deepEqual(doors, [true]);
});

test("a newly available roster reopens the retained unjoined history, and an unchanged LDA pass succeeds", async t => {
  t.mock.method(console, "log", () => {});
  const store = new MemoryRoutineDataStore(), filing = JSON.parse(ldaHonoreeCaptures()[0].body).results[0], urls: URL[] = [];
  let unchanged = false;
  const options = { source: "senate-lda" as const, store, vault, now: () => SRC_CG_NOW, sleep: async () => {},
    fetchImpl: (async input => { urls.push(new URL(String(input))); return Response.json({ count: unchanged ? 0 : 1, results: unchanged ? [] : [filing], next: null }); }) as typeof fetch };
  assert.equal((await refreshFederalSource(options)).counts.unjoined, 1);
  await seedSrcCgRoster(store, vault);
  const joined = await refreshFederalSource(options); assert.equal(joined.ok, true); assert.equal(joined.counts.joined, 1); assert.equal(joined.counts.unjoined, 0);
  assert.equal(urls[1].searchParams.get("filing_dt_posted_after"), "2008-01-01T00:00:00Z", "The roster change reopens historical filings, not just new postings.");
  unchanged = true;
  const checked = await refreshFederalSource(options); assert.equal(checked.ok, true); assert.deepEqual(checked.counts, joined.counts);
  assert.equal(urls[2].searchParams.get("filing_dt_posted_after"), "2026-10-13T04:19:59.000Z");
});

test("an interrupted LDA backfill resumes its next page and keeps the original posting watermark", async t => {
  t.mock.method(console, "log", () => {});
  const store = new MemoryRoutineDataStore(); await seedSrcCgRoster(store, vault);
  const filings = ldaHonoreeCaptures().slice(0, 2).flatMap(capture => JSON.parse(capture.body).results);
  let outage = true;
  const fetchImpl = (async input => {
    const second = new URL(String(input)).searchParams.get("page") === "2";
    if (outage && second) throw new Error("Controlled LDA page-two outage");
    return Response.json({ count: 2, results: [filings[second ? 1 : 0]], next: second ? null : "https://lda.gov/api/v1/contributions/?page_size=25&filing_year=2026&page=2" });
  }) as typeof fetch;
  const options = { source: "senate-lda" as const, store, vault, fetchImpl, sleep: async () => {} };
  assert.equal((await refreshFederalSource({ ...options, now: () => SRC_CG_NOW })).ok, false);
  outage = false;
  const result = await refreshFederalSource({ ...options, now: () => "2026-10-13T04:21:00.000Z" });
  assert.equal(result.ok, true); assert.equal(result.counts.loaded, 2); assert.equal(result.counts.joined, 2);
  const national = await readFederalSourceProjection("senate-lda", "national", { store, now: SRC_CG_NOW });
  assert.equal(national.kind, "PROMOTED"); if (national.kind === "PROMOTED") {
    const cursor = JSON.parse(national.value.cursor!.slice(5)); assert.equal(cursor.after, "2026-10-13T04:19:59.000Z");
  }
});
