/**
 * The Marginalia route's held answers are POINTER leads (a URL and what the index called it), and an empty answer is
 * a named no-hit, never a failure.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FailedNormalization, NORMALIZERS, normalizeMarginaliaSearch, stageOne } from "../lib/control-plane/scheduler/promotion-tail.ts";
import type { RouteDescriptor } from "../lib/control-plane/scheduler/registry.ts";
import { marginaliaLeads } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import { TANG_WILLIAMS, fixture, subject } from "./helpers/campaign-sites.ts";

const ROUTE: RouteDescriptor = {
  routeId: "candidate-marginalia-index",
  label: "Lily Tang Williams — Marginalia keyword index, DISCOVERY ONLY",
  executorClass: "DETERMINISTIC",
  executorReason: "a documented public endpoint",
  open: { kind: "HTTP_GET", url: "https://api.marginalia.nu/public/search/x", headers: {} },
  citation: "source registry",
};

function stage(root: string, body: string) {
  return stageOne({ root, obligationId: `freshness:candidate-enrichment:${TANG_WILLIAMS}#candidate-marginalia-index`, providerId: "candidate-enrichment",
    recordClass: "candidate-enrichment", subjectId: TANG_WILLIAMS, route: ROUTE, disposition: "INGESTED", artifactIds: ["ar-held"], body,
    nextDueAt: "2026-09-26T00:00:00.000Z", detail: "held", stagedOn: "2026-09-25" });
}

test("a held Marginalia answer normalizes to POINTER rows — URL, title, format, rank — and never the index's licensed text", () => {
  assert.equal(NORMALIZERS["candidate-marginalia-index"], normalizeMarginaliaSearch);
  const n = normalizeMarginaliaSearch(fixture("marginalia-tang-williams-lily.json"));
  const held = JSON.parse(fixture("marginalia-tang-williams-lily.json")) as { results: { url: string }[] };
  assert.equal(n.rows.length, held.results.length);
  assert.equal(n.pointerOnly, true);
  assert.deepEqual(Object.keys(n.rows[0]!).sort(), ["format", "kind", "rank", "title", "url"]);
  assert.ok(n.rows.every((row) => row.kind === "POINTER"));
  assert.ok(n.rows.some((row) => row.url === "https://www.lilytangwilliams.com/congress/endorsements/"));
});

test("the tail stages pointers for the verifier, where it used to stage NORMALIZER MISSING", (t) => {
  const root = mkdtempSync(join(tmpdir(), "wtp-marginalia-tail-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = stage(root, fixture("marginalia-tang-williams-lily.json"));
  assert.equal(entry.state, "STAGED_PROMOTION_READY");
  assert.ok(!entry.unresolved.some((u) => u.includes("NORMALIZER MISSING")));
  assert.match(entry.readerSentence, /pointer lead\(s\) staged for the campaign-site verifier/);
  const snapshot = JSON.parse(readFileSync(join(root, entry.snapshotPath!), "utf8")) as { rows: unknown[]; promotedToReaderTruth: boolean };
  assert.equal(snapshot.promotedToReaderTruth, false);
  assert.ok(snapshot.rows.length > 0);
});

test("an empty answer is a NAMED NO-HIT, not a failed normalization and never a statement about the candidate", (t) => {
  const root = mkdtempSync(join(tmpdir(), "wtp-marginalia-nohit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  /* The documented control: an impossible term answers a licence and an empty results array. */
  const empty = JSON.stringify({ license: "CC-BY-NC-SA 4.0", page: 1, pages: 0, query: "zzqxv impossible term", results: [] });
  const n = normalizeMarginaliaSearch(empty);
  assert.equal(n.rows.length, 0);
  assert.match(n.noHit ?? "", /^NO_HIT:/);
  const entry = stage(root, empty);
  assert.equal(entry.state, "STAGED_GAP");
  assert.ok(entry.unresolved.some((u) => u.startsWith("NO_HIT:")));
  assert.ok(!entry.unresolved.some((u) => u.includes("NORMALIZATION FAILED") || u.includes("NORMALIZER MISSING")));
  assert.equal(entry.snapshotPath, null);
  assert.throws(() => normalizeMarginaliaSearch(JSON.stringify({ results: [] })), FailedNormalization, "an answer without its licence is not the documented answer");
});

test("a pointer is a lead only when its host or its index title names the candidate; every other hit is refused with a type", () => {
  const lily = marginaliaLeads({ subjectId: TANG_WILLIAMS, artifactId: "ar", attemptId: "at", retrievedAt: "2026-09-24T12:00:00.000Z", body: fixture("marginalia-tang-williams-lily.json") }, subject(TANG_WILLIAMS));
  assert.ok(lily.leads.length >= 1 && lily.leads.every((l) => new URL(l.url).hostname.endsWith("lilytangwilliams.com")));
  assert.ok(lily.refused.every((r) => r.refusal.code.length > 0));
  assert.equal(lily.noHit, false);
  const althoff = marginaliaLeads({ subjectId: "nj:x", artifactId: "ar2", attemptId: "at2", retrievedAt: "2026-09-25T01:35:59.350Z", body: fixture("marginalia-althoff-marilyn.json") },
    { ...subject(TANG_WILLIAMS), candidacyId: "nj:x", givenName: "Marilyn", familyName: "ALTHOFF", officeTitle: "Member of the Borough Council", ocdId: "ocd-division/country:us/state:nj/place:mendham", stateCode: "NJ" });
  assert.equal(althoff.leads.length, 0);
  assert.deepEqual(althoff.refused.map((r) => r.refusal.code).sort(), ["AGGREGATOR", "NOT_A_PAGE"]);
});
