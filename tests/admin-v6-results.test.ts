import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { STAGE_NAMES, type ReaderResult, type StageMark } from "../app/(admin)/_mw/admin-v6/model.ts";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_KEY_VAR, SESSION_LIFETIME_SECONDS, signSession } from "../lib/control-plane/admin-auth.ts";
import { adminV6ReadCapabilities } from "../lib/control-plane/admin-view/v6-capabilities.ts";
import { parseV6PlaceKey, validateV6Query } from "../lib/control-plane/admin-view/v6-hunts-read.ts";
import {
  ADMIN_V6_RESULTS_CONTRACT, PIPELINE_APPROVED_SQL, PIPELINE_HEAD_SQL, PIPELINE_PENDING_SQL, RESULT_STAGE_NAMES, ZIP_WITNESS_SQL,
  owedResults, pipelineResults, readPipeline, readZipWitnesses, recordClassTitle, stateOfSubjectPrefix, zipBallotUrl,
  type AdminV6Result, type ApprovedGroupRow, type OwedResultRow, type PipelineGroupRow, type PipelineRead, type ResultMark,
} from "../lib/control-plane/admin-view/v6-results-read.ts";
import { v6ResultsGet } from "../lib/control-plane/admin-view/v6-results-route.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const NOW = "2026-10-01T22:00:00.000Z";
const pending = (recordClass: string, stage: PipelineGroupRow["stage"], prefix: string, n: number): PipelineGroupRow => ({ recordClass, stage, prefix, n });
const approved = (prefix: string, witness: ApprovedGroupRow["witness"], n: number, over: Partial<ApprovedGroupRow> = {}): ApprovedGroupRow =>
  ({ recordClass: "candidate-enrichment", prefix, witness, n, approvedAt: "2026-09-28T11:44:40.084Z", checkedAt: witness === "NONE" ? null : "2026-10-01T21:50:44.205Z", url: null, ...over });
const read = (p: PipelineGroupRow[], a: ApprovedGroupRow[]): PipelineRead => ({ state: "READ", publishedAt: "2026-10-01T21:50:44.205Z", revision: "671", pending: p, approved: a });
const byTitle = (rs: readonly AdminV6Result[], title: string) => rs.find((r) => r.title === title)!;

/* --------------------------------------------------------------- contract */

test("the six stage names are the ones the screen shows", () => {
  assert.deepEqual([...RESULT_STAGE_NAMES], [...STAGE_NAMES]);
  assert.equal(ADMIN_V6_RESULTS_CONTRACT, "admin-v6/results@1");
});

test("every mark a result carries is a mark the screen has words for", () => {
  const all: readonly ResultMark[] = ["done", "not-yet", "wrong", "partial", "reported", "waiting", "unreported"];
  const fits: readonly StageMark[] = all; // a mark the screen type does not know would not compile
  assert.equal(fits.length, 7);
  const sample: ReaderResult = { ...pipelineResults(read([pending("agendas", "VERIFIED", "ocd-division/country", 3)], []), "us", { kind: "country" })[0] };
  assert.equal(sample.kind, null);
});

test("the results section is announced with the snapshot revision and worker clock, independently of the whole snapshot", () => {
  const on = adminV6ReadCapabilities({ configRevision: null, snapshotRevision: 7, researchRevision: null, workerAgeBucket: 3 });
  assert.deepEqual(on.sections.results, { contract: "admin-v6/results@1", href: "/api/admin/v6/results", revision: "results:7:3" });
  assert.notEqual(adminV6ReadCapabilities({ configRevision: null, snapshotRevision: 8, researchRevision: null, workerAgeBucket: 3 }).sections.results.revision, on.sections.results.revision);
  assert.notEqual(adminV6ReadCapabilities({ configRevision: null, snapshotRevision: 7, researchRevision: null, workerAgeBucket: 4 }).sections.results.revision, on.sections.results.revision);
  assert.equal(adminV6ReadCapabilities({ configRevision: 3, snapshotRevision: null, researchRevision: 9 }).sections.results.contract, "admin-v6/results@1", "the retained publication reader reports its own availability");
});

/* -------------------------------------------------------------------- SQL */

test("the pipeline reads retained publications and grouped pipeline stages, joining exact approval witnesses", () => {
  for (const sql of [PIPELINE_HEAD_SQL, PIPELINE_PENDING_SQL, PIPELINE_APPROVED_SQL, ZIP_WITNESS_SQL]) {
    assert.match(sql, /FROM cp_(?:owner_snapshots|log_promotion_pipeline)/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
  }
  assert.match(PIPELINE_PENDING_SQL, /GROUP BY/, "the items are counted inside the database, never shipped one by one");
  assert.match(PIPELINE_APPROVED_SQL, /e->>'approvalId'=p->'publicationOutcome'->>'workerResultId'/, "a witness counts only for the exact approval it observed");
  assert.match(PIPELINE_APPROVED_SQL, /interval '3 hours'/);
  assert.match(ZIP_WITNESS_SQL, /e->>'url' = \$1/, "a ZIP's check is the witness for that exact page");
});

function fakeSql(replies: readonly (readonly Record<string, unknown>[])[]) {
  const seen: { text: string; params: readonly unknown[] | undefined }[] = [];
  let at = 0;
  return { seen, sql: { query: async (text: string, params?: readonly unknown[]) => { seen.push({ text, params }); return replies[at++] ?? []; } } as never };
}

test("the pipeline read maps grouped rows, drops what it cannot trust, and says unread rather than zero", async () => {
  const head = { published_at: new Date("2026-10-01T21:50:44.205Z"), revision: 671, states_kind: "object" };
  const f = fakeSql([[head], [
    { record_class: "local-jurisdiction", stage: "SCOUTED", prefix: "az", n: 570 },
    { record_class: "agendas", stage: "NOT_A_STAGE", prefix: "x", n: 4 },
    { record_class: "agendas", stage: "VERIFIED", prefix: "x", n: 0 },
    { record_class: null, stage: "VERIFIED", prefix: "x", n: 3 },
  ], [
    { record_class: "candidate-enrichment", prefix: "az", witness: "CONFIRMED_FRESH", n: 5, approved_at: "2026-09-28T11:44:40.084Z", checked_at: new Date("2026-10-01T21:50:44.205Z"), url: `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635` },
    { record_class: "candidate-enrichment", prefix: "nh", witness: "SOMETHING_ELSE", n: 2, approved_at: null, checked_at: null, url: null },
  ]]);
  const got = await readPipeline(f.sql, NOW);
  assert.equal(got.state, "READ");
  if (got.state !== "READ") return;
  assert.equal(got.publishedAt, "2026-10-01T21:50:44.205Z");
  assert.equal(got.revision, "671");
  assert.deepEqual(got.pending, [{ recordClass: "local-jurisdiction", stage: "SCOUTED", prefix: "az", n: 570 }]);
  assert.deepEqual(got.approved.map((r) => [r.prefix, r.witness, r.n]), [["az", "CONFIRMED_FRESH", 5], ["nh", "NONE", 2]]);
  assert.deepEqual(f.seen[2].params, [NOW], "freshness is judged at the request time");

  assert.deepEqual(await readPipeline(fakeSql([[]]).sql, NOW), { state: "UNREAD", says: "No owner snapshot has been published." });
  const old = await readPipeline(fakeSql([[{ ...head, states_kind: null }]]).sql, NOW);
  assert.equal(old.state, "UNREAD", "a missing assignment publication remains unread");
});

test("a ZIP's witnesses are read for its own ballot page only, and a malformed ZIP reads nothing", async () => {
  const f = fakeSql([[
    { reader_key: "ballot-az-pima:governor:a", state: "CONFIRMED", checked_at: new Date("2026-10-01T21:50:44.205Z"), url: zipBallotUrl("85635") },
    { reader_key: "ballot-az-pima:governor:b", state: "BOGUS", checked_at: new Date("2026-10-01T21:50:44.205Z"), url: zipBallotUrl("85635") },
  ]]);
  const rows = await readZipWitnesses(f.sql, "85635");
  assert.deepEqual(f.seen[0].params, [`${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`]);
  assert.deepEqual(rows.map((r) => r.readerKey), ["ballot-az-pima:governor:a"]);
  const none = fakeSql([[]]);
  assert.deepEqual(await readZipWitnesses(none.sql, "8563'; DROP"), []);
  assert.equal(none.seen.length, 0);
});

/* ------------------------------------------------------ country and state */

test("each stage comes from what the pipeline recorded, and a stage nothing records is not reported", () => {
  const rs = pipelineResults(read([
    pending("local-jurisdiction", "SCOUTED", "az", 570),
    pending("candidate-enrichment", "SCOUTED", "az", 371),
    pending("candidate-enrichment", "VERIFIED", "az", 15),
    pending("agendas", "VERIFIED", "ocd-division/country", 15),
  ], [approved("az", "CONFIRMED_FRESH", 4), approved("az", "NOT_OBSERVED", 6)]), "us", { kind: "country" });
  const local = byTitle(rs, "Local jurisdiction");
  assert.deepEqual(local.stages, ["done", "unreported", "unreported", "not-yet", "not-yet", "waiting"], "nothing past SCOUTED: the saved copy and the extraction are not recorded, the later stages have not happened");
  assert.equal(local.trail[0].what, "570 items");
  assert.equal(local.trail[1].what, "—");
  const cand = byTitle(rs, "Candidate enrichment");
  assert.equal(cand.trail[0].what, "396 items");
  assert.deepEqual(cand.stages, ["done", "partial", "partial", "partial", "partial", "partial"]);
  assert.equal(cand.trail[1].what, "25 of 396 with a saved copy", "only items that reached VERIFIED are known to have one");
  assert.equal(cand.trail[3].what, "25 of 396");
  assert.equal(cand.trail[4].what, "10 of 396");
  assert.equal(cand.trail[5].what, "4 of 10 seen on the page · 6 not found there");
  assert.equal(cand.readerSees, "10 of 396 published · 4 of 10 checked on the page");
  const agendas = byTitle(rs, "Agendas");
  assert.deepEqual(agendas.stages, ["done", "done", "done", "done", "not-yet", "waiting"]);
  assert.equal(agendas.readerSees, "0 of 15 published", "no check line when nothing is published");
  for (const r of rs) {
    assert.equal(r.stages.length, 6);
    assert.deepEqual(r.trail.map((t) => t.name), [...STAGE_NAMES]);
    assert.deepEqual(r.trail.map((t) => t.mark), r.stages);
    assert.deepEqual(r.applies, ["us"]);
    assert.equal(r.kind, null, "nothing records new, reused or updated");
  }
});

test("the last stage is done, partly done, wrong, or only reported, from the witnesses for exactly those approvals", () => {
  const stage6 = (a: ApprovedGroupRow[]) => pipelineResults(read([], a), "us", { kind: "country" })[0].stages[5];
  assert.equal(stage6([approved("az", "CONFIRMED_FRESH", 3)]), "done");
  assert.equal(stage6([approved("az", "CONFIRMED_FRESH", 2), approved("az", "NONE", 1)]), "partial");
  assert.equal(stage6([approved("az", "NOT_OBSERVED", 3)]), "wrong");
  assert.equal(stage6([approved("az", "CONFIRMED_STALE", 3)]), "reported", "a check older than three hours is not a current check");
  assert.equal(stage6([approved("az", "NONE", 3)]), "reported", "published, never checked");
  assert.equal(pipelineResults(read([], [approved("az", "NOT_OBSERVED", 3)]), "us", { kind: "country" })[0].problem, true);
  assert.equal(pipelineResults(read([], [approved("az", "CONFIRMED_FRESH", 3)]), "us", { kind: "country" })[0].problem, false);
});

test("a public page link appears only for a page on the public site", () => {
  const link = (url: string | null) => pipelineResults(read([], [approved("az", "CONFIRMED_FRESH", 1, { url })]), "us", { kind: "country" })[0].trail[5].publicLink;
  assert.deepEqual(link(`${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`), { url: `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`, label: "The public page", seenAt: "2026-10-01T21:50:44.205Z" });
  assert.equal(link("https://example.com/ballot"), undefined);
  assert.equal(link(null), undefined);
});

test("a state reads only its own items, the country reads all of them, and an item tied to no state shows only in the country", () => {
  const world = read([
    pending("candidate-enrichment", "SCOUTED", "az", 371), pending("candidate-enrichment", "SCOUTED", "nj", 455),
    pending("campaign-finance", "SCOUTED", "ballot-az-pima", 4), pending("agendas", "VERIFIED", "ocd-division/country", 15),
    pending("local-jurisdiction", "SCOUTED", "azz", 9),
  ], [approved("az", "NONE", 10), approved("nj", "CONFIRMED_FRESH", 7)]);
  const az = pipelineResults(world, "st:az", { kind: "state", state: "az" });
  assert.deepEqual(az.map((r) => r.title).sort(), ["Campaign finance", "Candidate enrichment"]);
  assert.equal(byTitle(az, "Candidate enrichment").trail[0].what, "381 items");
  assert.deepEqual(byTitle(az, "Candidate enrichment").applies, ["st:az"]);
  assert.equal(byTitle(az, "Campaign finance").trail[0].what, "4 items", "a ballot key names its state");
  assert.equal(byTitle(pipelineResults(world, "st:nj", { kind: "state", state: "nj" }), "Candidate enrichment").trail[0].what, "462 items");
  const us = pipelineResults(world, "us", { kind: "country" });
  assert.equal(byTitle(us, "Candidate enrichment").trail[0].what, "843 items");
  assert.ok(byTitle(us, "Agendas") && byTitle(us, "Local jurisdiction"));
  assert.deepEqual(pipelineResults(world, "st:wy", { kind: "state", state: "wy" }), [], "a state with no items lists none");
  assert.equal(us[0].title, "Candidate enrichment", "what readers already have comes first, whatever else got further upstream");
});

test("subject prefixes and record classes read as a state and as plain words", () => {
  assert.equal(stateOfSubjectPrefix("az"), "az");
  assert.equal(stateOfSubjectPrefix("DC"), "dc");
  assert.equal(stateOfSubjectPrefix("ballot-nj-bergen"), "nj");
  for (const p of ["ocd-division/country", "curated", "wtp-body/country", "", "zz", "ballot-zz-x"]) assert.equal(stateOfSubjectPrefix(p), null, p);
  assert.equal(recordClassTitle("candidate-enrichment"), "Candidate enrichment");
  assert.equal(recordClassTitle("CANDIDATE_FILINGS"), "Candidate filings");
});

/* ------------------------------------------------------------ ZIP, county */

function owedRow(checklistId: string, state: OwedResultRow["state"], subject: string, held: OwedResultRow["held"] = []): OwedResultRow {
  return { id: `${subject}|${checklistId}`, checklistId, state, requirement: "x", subject: { id: subject, kind: "seat", label: subject }, held };
}
const heldAt = (state: string, checkedAt = "2026-10-01T10:00:00.000Z", value: unknown = { v: 1 }) => ({ sourceUrl: "https://example.gov/page", checkedAt, state, value });

test("a place's owed rows become one result per group, with each stage from what the row records", () => {
  const rows: OwedResultRow[] = [
    owedRow("OFF-04", "published", "a", [heldAt("published")]),
    owedRow("OFF-04", "published", "b", [heldAt("published", "2026-10-01T11:00:00.000Z")]),
    owedRow("OFF-04", "held", "c", [heldAt("held")]),
    owedRow("OFF-04", "stale", "d", [heldAt("published", "2026-08-01T00:00:00.000Z")]),
    owedRow("OFF-04", "missing", "e"),
    owedRow("GEO-01", "missing", "f"),
    owedRow("DOC-01", "unpublished", "g", [heldAt("unpublished")]),
    owedRow("GATE-01", "missing", "h"),
  ];
  const rs = owedResults({ placeKey: "geo:az.county.04019", rows, zip: null, witnesses: null });
  assert.deepEqual(rs.map((r) => r.title), ["Geography", "Officeholders", "Agendas and documents"], "place groups only, in the checklist's order; a setup group is not a reader result");
  const off = byTitle(rs, "Officeholders");
  assert.deepEqual(off.stages, ["partial", "unreported", "partial", "partial", "partial", "reported"]);
  assert.equal(off.readerSees, "2 of 5 published · 1 captured, not published · 1 due for refresh · 1 not captured");
  assert.equal(off.trail[0].what, "4 of 5");
  assert.equal(off.trail[0].when, "2026-10-01T11:00:00.000Z");
  assert.equal(off.trail[1].mark, "unreported", "the owed list records no saved copy");
  assert.equal(off.trail[3].what, "2 of 5");
  assert.equal(off.trail[4].when, "2026-10-01T11:00:00.000Z");
  assert.deepEqual(off.applies, ["geo:az.county.04019"]);
  const geo = byTitle(rs, "Geography");
  assert.deepEqual(geo.stages, ["not-yet", "unreported", "waiting", "waiting", "waiting", "waiting"], "nothing held: nothing after Found has happened");
  const docs = byTitle(rs, "Agendas and documents");
  assert.deepEqual(docs.stages, ["done", "unreported", "done", "unreported", "unreported", "unreported"], "a row the government does not publish is left out of publishing and checking");
  assert.equal(docs.readerSees, "0 of 1 published · 1 not published by the government");
  for (const r of rs) { assert.equal(r.stages.length, 6); assert.deepEqual(r.trail.map((t) => t.mark), r.stages); assert.equal(r.kind, null); }
});

test("a ZIP's ballot groups are checked on the public page from that ZIP's witnesses, and unread witnesses are not guessed", () => {
  const rows = [owedRow("ELE-01", "published", "x", [heldAt("published")]), owedRow("ELE-02", "published", "y", [heldAt("published")]), owedRow("OFF-04", "published", "z", [heldAt("published")])];
  const w = (readerKey: string, state: "CONFIRMED" | "NOT_OBSERVED") => ({ readerKey, state, checkedAt: "2026-10-01T21:00:00.000Z", url: zipBallotUrl("85635") });
  const stage = (witnesses: Parameters<typeof owedResults>[0]["witnesses"], title = "Elections") =>
    byTitle(owedResults({ placeKey: "geo:az.zcta.85635", rows, zip: "85635", witnesses }), title);
  assert.equal(stage([w("a", "CONFIRMED"), w("b", "CONFIRMED")]).stages[5], "done");
  assert.equal(stage([w("a", "CONFIRMED"), w("b", "NOT_OBSERVED")]).stages[5], "partial");
  assert.equal(stage([w("a", "NOT_OBSERVED")]).stages[5], "wrong");
  assert.equal(stage([w("a", "NOT_OBSERVED")]).problem, true);
  assert.equal(stage([w("a", "CONFIRMED")]).trail[5].publicLink?.url, zipBallotUrl("85635"));
  assert.equal(stage([w("a", "CONFIRMED"), w("b", "NOT_OBSERVED")]).trail[5].what, "1 of 2 seen on the page · 1 not found there");
  assert.equal(stage([]).stages[5], "reported", "published, with no check recorded for this ZIP");
  assert.equal(stage(null).stages[5], "unreported", "witnesses that could not be read are not guessed");
  assert.equal(stage([w("a", "CONFIRMED")], "Officeholders").stages[5], "reported", "only the ballot groups are checked on the ballot page");
});

/* ------------------------------------------------------------------ route */

const KEY = "route-test-session-key-that-is-long-enough";
async function call(query: string, headers: Record<string, string> = {}, session = true) {
  const saved = [process.env[ADMIN_SESSION_KEY_VAR], process.env.WTP_CONTROL_PLANE_DATABASE_URL];
  process.env[ADMIN_SESSION_KEY_VAR] = KEY;
  delete process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  try {
    const iat = Math.floor(Date.now() / 1000);
    const cookie = await signSession({ sid: "adm_test", iat, exp: iat + SESSION_LIFETIME_SECONDS }, KEY);
    const request = new NextRequest(`https://${new URL(ADMIN_ORIGIN).host}/api/admin/v6/results${query}`, {
      headers: { "x-forwarded-host": new URL(ADMIN_ORIGIN).host, ...(session ? { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` } : {}), ...headers } });
    const response = await v6ResultsGet(request);
    return { status: response.status, body: response.status === 404 ? null : await response.json() as Record<string, unknown> };
  } finally {
    if (saved[0] === undefined) delete process.env[ADMIN_SESSION_KEY_VAR]; else process.env[ADMIN_SESSION_KEY_VAR] = saved[0];
    if (saved[1] !== undefined) process.env.WTP_CONTROL_PLANE_DATABASE_URL = saved[1];
  }
}

test("a malformed or repeated scope is refused before anything is read", async () => {
  for (const q of ["", "?scope=", "?scope=%20", "?scope=us&scope=st:az", "?scope=st:AZ", "?scope=st:azz", "?scope=us&extra=1", "?scope=geo:az.zcta.85635;DROP", `?scope=${"x".repeat(80)}`, "?scope=us&period=never", "?scope=../../etc"]) {
    const got = await call(q);
    assert.equal(got.status, 400, q);
    assert.ok(typeof got.body?.code === "string", q);
  }
  assert.equal(validateV6Query(new URLSearchParams("scope=us")).ok, true);
});

test("the route is for the signed-in owner only", async () => {
  assert.equal((await call("?scope=us", {}, false)).status, 401);
  assert.equal((await call("?scope=us", { "x-forwarded-host": "example.com" })).status, 404);
});

test("a country or state read with no database says it is unread (503), never an empty list", async () => {
  for (const scope of ["us", "st:az"]) {
    const got = await call(`?scope=${scope}`);
    assert.equal(got.status, 503, scope);
    assert.equal(got.body?.state, "UNREAD");
    assert.equal("data" in (got.body ?? {}), false);
  }
});

test("a geography with no results read answers with no data, not an empty list", async () => {
  for (const scope of ["geo:az.cbsa.38060", "geo:az.zcta.8563", "body:abc"]) {
    const got = await call(`?scope=${encodeURIComponent(scope)}`);
    assert.equal(got.status, 200, scope);
    assert.equal(got.body?.contract, ADMIN_V6_RESULTS_CONTRACT);
    assert.equal(got.body?.scope, scope);
    assert.equal(got.body?.data, null, scope);
    assert.ok(typeof got.body?.revision === "string" && typeof got.body?.asOf === "string");
  }
  assert.equal(parseV6PlaceKey("geo:az.zcta.85635")?.kind, "geo");
});
