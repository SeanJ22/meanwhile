/** DP-13: the live-audit pass samples published facts by area, re-reads their pages, and answers green or red per fact ID. */
import assert from "node:assert/strict";
import test from "node:test";

import {
  areasForPass,
  auditableFields,
  auditLiveFact,
  curatedReaderCatalog,
  dateOnPage,
  greenFromRefresh,
  LIVE_AUDIT_DEFAULT_POLICY,
  pickFromArea,
  runLiveAuditPass,
  type LiveAuditResult,
  type LiveFact,
  type PageRead,
} from "../lib/control-plane/workers/live-audit.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const URL = "https://clerk.example.gov/rules";

const rule = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: "comment-access", bodyId: `body-${id}`, ocdId: null, commentPeriod: "YES",
  commentPeriodDetail: "Residents may speak for three minutes.", signup: "Sign up at the clerk's desk.",
  sourceUrl: URL, collectedAt: NOW, verifiedAt: NOW, ...over,
});
const page = (text: string, over: Partial<PageRead> = {}): PageRead =>
  ({ url: URL, text, retrievedAt: NOW, contentHash: "h-now", artifactId: "ar-1", ...over });
const fact = (record: ReturnType<typeof rule>, over: Partial<LiveFact> = {}): LiveFact =>
  ({ id: `comment-access:${record.id}`, family: "comment-access", area: record.bodyId, sourceUrl: URL, record, verifiedAt: NOW, ...over });

test("only what the page should show is audited: no ids, timestamps, links back or category labels", () => {
  const fields = auditableFields(rule("a"), URL).map((f) => f.field).sort();
  assert.deepEqual(fields, ["commentPeriodDetail", "signup"], "commentPeriod is a YES/NO label");
  const routing = auditableFields({ id: "r", kind: "CONTACT", topicId: "roads", zip: "12345", contact: { topicId: "roads", service: "Report a pothole", phone: "555-0100", sourceUrl: URL, collectedAt: NOW } }, URL);
  assert.deepEqual(routing.map((f) => f.field).sort(), ["contact.phone", "contact.service", "zip"]);
  const sourced = auditableFields({ id: "x", signup: "Here", other: "Elsewhere", fieldSources: { signup: { sourceUrl: URL }, other: { sourceUrl: "https://other.example.gov/" } } }, URL);
  assert.deepEqual(sourced.map((f) => f.field), ["signup"], "a field verified on another page is not judged against this one");
});

test("a fact whose values are still on the page is green, and the result names the fact and the page", () => {
  const r = auditLiveFact(fact(rule("a")), page("<p>Residents may speak for three minutes.</p><p>Sign up at the clerk's desk.</p>"), NOW);
  assert.equal(r.verdict, "GREEN");
  assert.equal(r.factId, "comment-access:a");
  assert.equal(r.reread?.url, URL);
  assert.equal(r.basis, "REREAD");
});

test("a value that left the page makes the fact red and says which", () => {
  const r = auditLiveFact(fact(rule("a")), page("<p>Residents may speak for five minutes.</p><p>Sign up at the clerk's desk.</p>"), NOW);
  assert.equal(r.verdict, "RED");
  assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.field), ["commentPeriodDetail"]);
  assert.match(r.reason, /commentPeriodDetail/);
});

test("an empty page, or a fact with nothing to look for, is inconclusive, never red", () => {
  assert.equal(auditLiveFact(fact(rule("a")), page("   "), NOW).verdict, "INCONCLUSIVE");
  const bare = { id: "b", kind: "comment-access", bodyId: "b", sourceUrl: URL, verifiedAt: NOW } as unknown as ReturnType<typeof rule>;
  assert.equal(auditLiveFact(fact(bare), page("anything"), NOW).verdict, "INCONCLUSIVE");
});

test("dates match the forms a government page uses, on word boundaries", () => {
  const d = { y: 2026, m: 10, d: 5 };
  for (const text of ["meets monday, october 5, 2026 at 6 pm", "oct. 5, 2026", "5 october 2026", "10/5/2026", "10/05/26", "2026-10-05", "october 5th, 2026"]) {
    assert.equal(dateOnPage(d, text), true, text);
  }
  assert.equal(dateOnPage(d, "october 15, 2026"), false);
  assert.equal(dateOnPage(d, "110/5/20267"), false, "no match inside a longer number");
  assert.equal(dateOnPage(d, "october 5, 2025"), false, "the year counts");
  const meeting = { id: "m1", bodyId: "council", sourceUrl: URL, verifiedAt: NOW, startsAt: "2026-10-05T18:00:00-07:00", title: "Regular Meeting" };
  const f = { id: "meetings:m1", family: "meetings", area: "council", sourceUrl: URL, record: meeting, verifiedAt: NOW };
  assert.equal(auditLiveFact(f, page("Regular Meeting — October 5, 2026"), NOW).verdict, "GREEN");
  const moved = auditLiveFact(f, page("Regular Meeting — October 12, 2026"), NOW);
  assert.equal(moved.verdict, "RED");
  assert.equal(moved.checks.find((c) => !c.ok)?.kind, "DATE_ON_PAGE");
});

test("an unchanged routine refresh is a green flag with no new fetch; a changed or stale one is not", () => {
  const f = fact(rule("a"), { verifiedContentHash: "h-then" });
  const fresh = { sourceUrl: URL, retrievedAt: "2026-10-05T06:00:00.000Z", contentHash: "h-then" };
  const green = greenFromRefresh(f, fresh, NOW, LIVE_AUDIT_DEFAULT_POLICY);
  assert.equal(green?.verdict, "GREEN");
  assert.equal(green?.basis, "UNCHANGED_ROUTINE_REFRESH");
  assert.equal(greenFromRefresh(f, { ...fresh, contentHash: "h-new" }, NOW, LIVE_AUDIT_DEFAULT_POLICY), null, "the page changed: re-read it");
  assert.equal(greenFromRefresh(f, { ...fresh, retrievedAt: "2026-10-01T00:00:00.000Z" }, NOW, LIVE_AUDIT_DEFAULT_POLICY), null, "too old to stand in");
  assert.equal(greenFromRefresh(fact(rule("a")), fresh, NOW, LIVE_AUDIT_DEFAULT_POLICY), null, "no hash at verification, nothing to compare");
});

test("sampling: recently audited facts are passed over, never-audited come first, and the pick is stable for a pass", () => {
  const pool = ["a", "b", "c", "d"].map((id) => fact(rule(id)));
  const last: Record<string, string> = { "comment-access:a": "2026-10-04T00:00:00.000Z", "comment-access:b": "2026-08-01T00:00:00.000Z" };
  const pick = (passId: string) => pickFromArea(pool, { passId, now: NOW, policy: { ...LIVE_AUDIT_DEFAULT_POLICY, perAreaPerPass: 3 }, lastAuditedAt: (id) => last[id] });
  const picked = pick("p1").map((f) => f.id);
  assert.ok(!picked.includes("comment-access:a"), "audited yesterday: passed over");
  assert.ok(picked.indexOf("comment-access:b") === 2, "audited long ago comes after the never-audited");
  assert.deepEqual(pick("p1").map((f) => f.id), picked, "same pass, same pick");
  assert.equal(areasForPass(["x", "y", "z"], "p1", { ...LIVE_AUDIT_DEFAULT_POLICY, areasPerPass: 2 }).length, 2);
});

test("a pass samples each area, prefers refreshes, fetches the rest within its allowance, and records every answer", async () => {
  const records = [rule("a"), rule("b"), rule("c", { sourceUrl: "https://other.example.gov/x" }), rule("d", { bodyId: "body-a" })];
  const catalog = curatedReaderCatalog("comment-access", records);
  assert.deepEqual([...(await catalog.areas())].sort(), ["body-a", "body-b", "body-c"]);
  const recorded: LiveAuditResult[] = [];
  const fetched: string[] = [];
  const summary = await runLiveAuditPass({
    catalog, now: NOW, passId: "pass-1", lastAuditedAt: () => null,
    policy: { ...LIVE_AUDIT_DEFAULT_POLICY, maxFetchesPerPass: 1 },
    refreshFor: (f) => f.id === "comment-access:b" ? { sourceUrl: URL, retrievedAt: "2026-10-05T10:00:00.000Z", contentHash: "same" } : null,
    fetchPage: async (url) => { fetched.push(url); return page("Residents may speak for three minutes. Sign up at the clerk's desk.", { url }); },
    record: async (r) => { recorded.push(r); },
  });
  assert.equal(summary.areas, 3);
  assert.equal(summary.fromRefresh, 0, "b has no hash at verification, so its refresh cannot stand in");
  assert.equal(fetched.length, 1, "the fetch allowance holds");
  assert.equal(summary.deferred, 2);
  assert.equal(recorded.length, summary.sampled - summary.deferred);
  assert.ok(recorded.every((r) => r.factId.startsWith("comment-access:")));

  const withHash = curatedReaderCatalog("comment-access", [rule("a")]);
  const base = await withHash.factsInArea("body-a", 5);
  const hashed: typeof withHash = { areas: withHash.areas, factsInArea: async () => base.map((f) => ({ ...f, verifiedContentHash: "same" })) };
  const rec2: LiveAuditResult[] = [];
  const s2 = await runLiveAuditPass({ catalog: hashed, now: NOW, passId: "p2", lastAuditedAt: () => null,
    refreshFor: () => ({ sourceUrl: URL, retrievedAt: "2026-10-05T10:00:00.000Z", contentHash: "same" }),
    fetchPage: async () => { throw new Error("no fetch expected"); }, record: async (r) => { rec2.push(r); } });
  assert.deepEqual([s2.fromRefresh, s2.fetches, s2.green], [1, 0, 1]);
});

test("a page that cannot be read leaves the fact inconclusive and recorded as not read", async () => {
  const rec: LiveAuditResult[] = [];
  await runLiveAuditPass({ catalog: curatedReaderCatalog("comment-access", [rule("a")]), now: NOW, passId: "p", lastAuditedAt: () => null,
    fetchPage: async () => null, record: async (r) => { rec.push(r); } });
  assert.deepEqual(rec.map((r) => [r.verdict, r.basis]), [["INCONCLUSIVE", "NOT_READ"]]);
});
