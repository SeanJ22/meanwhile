import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN, STAGING_RENDER_ORIGIN, hostOf } from "@/lib/ops/origins.ts";
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_KEY_VAR, SESSION_LIFETIME_SECONDS, signSession } from "@/lib/control-plane/admin-auth.ts";
import { createFileRepositories } from "@/lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { APPEND_ONLY_LOGS, BOOTSTRAP_DDL, BOOTSTRAP_VERSION, DECLARED_TABLES } from "@/lib/control-plane/repository/pg-schema.ts";
import { AppendOnlyViolation, type ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";
import type { SoftwareReleaseReviewRecord } from "@/lib/control-plane/software-release-review.ts";

import { REQUIRED_SECTIONS, REVIEW_PAGE_URL, REVIEW_READY_STATUS } from "@/app/(admin)/admin/release-review/contract.ts";
import { parseManifest, safeStagingUrl } from "@/app/(admin)/admin/release-review/manifest.ts";
import { readManifest, readProductionIdentity, refreshManifest } from "@/app/(admin)/admin/release-review/manifest-source.ts";
import { buildReviewModel, type ManifestReading } from "@/app/(admin)/admin/release-review/review-model.ts";
import { noteObservation, recordReview, type WriteDeps } from "@/app/(admin)/admin/release-review/write.ts";
import { GET, POST } from "@/app/api/admin/release-review/route.ts";

/**
 * **ADMIN PASS B — the software release review, proven by fixture.**
 * (2026-09-06.)
 *
 * At observation the live manifest answered HTTP 401 behind staging's password
 * gate, so every tolerated state is forced here by fixture against the
 * contract its source on `test` emits (lib/review/release-manifest.ts):
 *
 *   B2  the manifest as observed — full fixture, VISUAL_WORK_IN_PROGRESS, an
 *       unknown status, missing sections, missing URLs, unknown fields, a body
 *       that is not JSON, HTTP 401 — each a labeled state, never a throw
 *   B3  the five required sections reconcile against what the manifest
 *       exposes; unexposed ones are NOT_YET_REVIEWABLE; extras do not gate
 *   B4  decisions persist keyed by the exact SHA with actor and server time;
 *       a new SHA starts with zero decisions; a write against the old SHA is
 *       STALE_SHA; history is append-only
 *   B5  APPROVE on Raised State is refused without a variant on that SHA
 *   B6  OWNER_APPROVED_FOR_PRODUCTION: every failing condition by name, the
 *       passing path, the composed-from row ids, one explicit write, and no
 *       side effect beyond the append
 *   B7  the one additive table is declared in the bootstrap schema at v8 and
 *       every provider bundle carries it; write routes refuse the public host,
 *       a missing session and a foreign origin
 */

const SHA_X = "a".repeat(40);
const SHA_Y = "b".repeat(40);
const DEPLOY_X = "1".repeat(24);
const SESSION_KEY = "test-session-key-that-is-long-enough-to-sign-with";
const ADMIN_HOST = hostOf(ADMIN_ORIGIN);
const PUBLIC_HOST = hostOf(PUBLIC_SITE_ORIGIN);

/** The manifest exactly as `softwareReleaseManifest` on `test` shapes it, with overrides. */
function manifestFixture(overrides: Record<string, unknown> = {}, sha = SHA_X): Record<string, unknown> {
  const url = (params: Record<string, string>) => {
    const u = new URL("/", STAGING_RENDER_ORIGIN);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };
  return {
    contractVersion: 1,
    kind: "SOFTWARE_VISUAL_REVIEW",
    sha,
    build: { sha, branch: "test", context: "branch-deploy", deployId: DEPLOY_X, builtAt: "2026-09-06T00:00:00.000Z" },
    reportedAt: "2026-09-06T08:27:39.000Z",
    stagingBoundary: "STABLE",
    milestone: "STAGING_BOUNDARY_STABLE",
    prompt3Status: "VISUAL_WORK_IN_PROGRESS",
    reviewState: "VISUAL_WORK_IN_PROGRESS",
    boundaryReason: null,
    isolation: { application: "staging", controlPlane: "staging", productionWritesAllowed: false },
    reviewSections: [
      { id: "map-movement", name: "Map movement", url: url({ zip: "85701", review: "map" }) },
      { id: "pearl", name: "Pearl interactive pills", url: url({ zip: "85701", review: "pearl" }) },
      { id: "lumen", name: "Lumen popup family + theme parity", url: url({ zip: "85701", review: "lumen" }) },
      { id: "raised-state", name: "Raised state", url: url({ zip: "85701", review: "raised-state" }) },
      { id: "theme", name: "Theme behavior", url: url({ zip: "85701", review: "theme" }) },
    ],
    raisedState: {
      status: "AWAITING_OWNER_CHOICE",
      candidates: [
        { id: "A_SOFT_LIFT", label: "A — Soft Lift", url: url({ zip: "85701", raisedState: "A_SOFT_LIFT" }) },
        { id: "B_MATERIAL_LIFT", label: "B — Material Lift", url: url({ zip: "85701", raisedState: "B_MATERIAL_LIFT" }) },
        { id: "C_DEEP_LIFT", label: "C — Deep Lift", url: url({ zip: "85701", raisedState: "C_DEEP_LIFT" }) },
      ],
    },
    ownership: { prompt3: ["test", "/api/release-manifest"], prompt4: ["Fleet"] },
    prompt4MayBeginInSeparateSession: true,
    ...overrides,
  };
}

function observed(raw: Record<string, unknown>, observedAt = "2026-09-06T09:00:00.000Z"): ManifestReading {
  const manifest = parseManifest(raw);
  assert.ok(manifest, "fixture must parse");
  return { kind: "OBSERVED", manifest, observedAt, httpStatus: 200 };
}
const unavailable = (reason = "HTTP 401 — staging is password-protected at its edge, so no manifest was read"): ManifestReading => ({
  kind: "UNAVAILABLE",
  observedAt: "2026-09-06T09:00:00.000Z",
  reason,
  httpStatus: 401,
});

/** A clock that ticks one second per call, so every row id is distinct and ordered. */
function ticking(start = Date.parse("2026-09-06T09:00:00.000Z")): () => string {
  let t = start;
  return () => new Date((t += 1000)).toISOString();
}

function deps(reviews: WriteDeps["reviews"], live: () => ManifestReading, now = ticking()): WriteDeps {
  return { reviews, readLiveManifest: async () => live(), now, actor: "session:adm_test" };
}

/* ================================================================== B2 */

test("B2: the full manifest parses to the observed contract, and VISUAL_WORK_IN_PROGRESS is tolerated as not-yet-ready", () => {
  const m = parseManifest(manifestFixture());
  assert.ok(m);
  assert.equal(m.sha, SHA_X);
  assert.equal(m.deployId, DEPLOY_X);
  assert.equal(m.prompt3Status, "VISUAL_WORK_IN_PROGRESS");
  assert.equal(m.reviewReady, false);
  assert.equal(m.readinessKeyedOn, "prompt3Status");
  assert.equal(m.sections?.length, 5);
  assert.equal(m.raisedState?.candidates?.length, 3);
  assert.deepEqual(m.unknownFields, []);
  assert.equal(m.stagingBoundary, "STABLE");
});

test("B2: an unknown status, missing sections, missing URLs and unknown fields are labeled states, never throws", () => {
  const unknownStatus = parseManifest(manifestFixture({ prompt3Status: "SOMETHING_PROMPT_3_INVENTED", reviewState: undefined }));
  assert.equal(unknownStatus?.prompt3Status, "SOMETHING_PROMPT_3_INVENTED");
  assert.equal(unknownStatus?.reviewReady, false);

  const noSections = parseManifest(manifestFixture({ reviewSections: undefined }));
  assert.equal(noSections?.sections, null, "a missing section list reads as null, not as an empty list");
  const model = buildReviewModel({ reading: observed(manifestFixture({ reviewSections: undefined })), production: null, rows: [], store: { ok: true } });
  assert.deepEqual(
    model.sections.map((s) => s.availability),
    REQUIRED_SECTIONS.map(() => "NOT_YET_REVIEWABLE"),
    "every required section is NOT_YET_REVIEWABLE when the manifest exposes none",
  );

  const noUrls = parseManifest(manifestFixture({ reviewSections: [{ id: "pearl", name: "Pearl" }] }));
  assert.equal(noUrls?.sections?.[0].url, null);
  const noUrlModel = buildReviewModel({ reading: observed(manifestFixture({ reviewSections: [{ id: "pearl", name: "Pearl" }] })), production: null, rows: [], store: { ok: true } });
  const pearl = noUrlModel.sections.find((s) => s.id === "pearl")!;
  assert.equal(pearl.link, REVIEW_PAGE_URL, "no manifest link means the review page itself, never a fabricated deep link");
  assert.equal(pearl.linkIsDeep, false);

  const extra = parseManifest(manifestFixture({ somethingNew: { nested: [1, 2, 3] }, anotherField: "x" }));
  assert.deepEqual(
    extra?.unknownFields.map((f) => f.key),
    ["somethingNew", "anotherField"],
    "unknown top-level fields are kept as raw labeled key/values",
  );

  assert.equal(parseManifest("not an object"), null);
  assert.equal(parseManifest([1, 2]), null);
  assert.equal(parseManifest(manifestFixture({ sha: "unknown", build: undefined }))?.sha, null, "a non-SHA is never treated as an identity");
});

test("B2: only staging-origin https URLs are ever rendered as links", () => {
  assert.equal(safeStagingUrl(`${STAGING_RENDER_ORIGIN}/review?x=1`), `${STAGING_RENDER_ORIGIN}/review?x=1`);
  assert.equal(safeStagingUrl("https://evil.example/review"), null);
  assert.equal(safeStagingUrl("javascript:alert(1)"), null);
  assert.equal(safeStagingUrl(42), null);
});

test("B2: MANIFEST_UNAVAILABLE disables every write and names the last observed SHA and time", async () => {
  const repos = createMemoryRepositories();
  const now = ticking();
  await noteObservation(repos.softwareReleaseReviews, observed(manifestFixture()), now());
  const rows = await repos.softwareReleaseReviews.readAll();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, "MANIFEST_OBSERVED");
  const model = buildReviewModel({ reading: unavailable(), production: null, rows, store: { ok: true } });
  assert.equal(model.writesEnabled, false);
  assert.match(model.writesDisabledBecause ?? "", /MANIFEST_UNAVAILABLE/);
  assert.equal(model.lastObserved?.sha, SHA_X);
  assert.equal(model.lastObserved?.at, rows[0].createdAt);
  assert.equal(model.composite.recordable, false);
  for (const section of model.sections) assert.equal(section.availability, "MANIFEST_UNAVAILABLE");
  // A write while unavailable is refused, and nothing is appended.
  const outcome = await recordReview(deps(repos.softwareReleaseReviews, () => unavailable(), now), { action: "DECIDE", stagingSha: SHA_X, section: "pearl", decision: "APPROVE", feedback: null, choice: null });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? "" : outcome.code, "MANIFEST_UNAVAILABLE");
  assert.equal((await repos.softwareReleaseReviews.readAll()).length, 1);
  // An observation is noted once per (SHA, status), not on every render.
  await noteObservation(repos.softwareReleaseReviews, observed(manifestFixture()), now());
  assert.equal((await repos.softwareReleaseReviews.readAll()).length, 1);
});

test("B2: the server-side source turns HTTP 401, a non-JSON body and a network error into MANIFEST_UNAVAILABLE, and caches a reading for seconds", async () => {
  refreshManifest();
  let calls = 0;
  const fetch401 = (async () => {
    calls += 1;
    return new Response("<!DOCTYPE html><title>Password Protection</title>", { status: 401, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
  let t = 0;
  const first = await readManifest({ fetchImpl: fetch401, env: {} as NodeJS.ProcessEnv, nowMs: () => t });
  assert.equal(first.kind, "UNAVAILABLE");
  assert.match(first.kind === "UNAVAILABLE" ? first.reason : "", /401.*password/i);
  t = 5_000;
  await readManifest({ fetchImpl: fetch401, env: {} as NodeJS.ProcessEnv, nowMs: () => t });
  assert.equal(calls, 1, "a reading inside the cache horizon is reused");
  await readManifest({ fetchImpl: fetch401, env: {} as NodeJS.ProcessEnv, nowMs: () => t, force: true });
  assert.equal(calls, 2, "a write's forced read bypasses the memo");
  refreshManifest();

  const fetchGarbage = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
  const garbage = await readManifest({ fetchImpl: fetchGarbage, env: {} as NodeJS.ProcessEnv, nowMs: () => 100_000, force: true });
  assert.equal(garbage.kind, "UNAVAILABLE");
  refreshManifest();

  const fetchDown = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const down = await readManifest({ fetchImpl: fetchDown, env: {} as NodeJS.ProcessEnv, nowMs: () => 200_000, force: true });
  assert.equal(down.kind, "UNAVAILABLE");
  refreshManifest();

  const fetchGood = (async () => Response.json(manifestFixture())) as unknown as typeof fetch;
  const good = await readManifest({ fetchImpl: fetchGood, env: {} as NodeJS.ProcessEnv, nowMs: () => 300_000, force: true });
  assert.equal(good.kind, "OBSERVED");
  assert.equal(good.kind === "OBSERVED" ? good.manifest.sha : null, SHA_X);
  refreshManifest();

  const fetchBuild = (async () => Response.json({ commit: "c".repeat(40), commitShort: "ccccccc", branch: "main", context: "production", deployId: "6a9ce414776d0d0b83e29201" })) as unknown as typeof fetch;
  const production = await readProductionIdentity({ fetchImpl: fetchBuild, nowMs: () => 400_000, force: true });
  assert.equal(production.sha, "c".repeat(40));
  assert.equal(production.deployId, "6a9ce414776d0d0b83e29201");
  assert.match(production.source, /\/api\/build/);
  refreshManifest();
});

/* ================================================================== B3 */

test("B3: the five required sections reconcile by id or name; an unexposed one is NOT_YET_REVIEWABLE; an extra does not gate", () => {
  const raw = manifestFixture({
    reviewSections: [
      { id: "map", name: "Map Movement", url: `${STAGING_RENDER_ORIGIN}/?review=map` },
      { id: "pearl", name: "Pearl interactive pills" },
      { id: "lumen", name: "Lumen popup family + theme parity" },
      { id: "raised-state", name: "Raised state" },
      { id: "onboarding", name: "Onboarding tour" },
    ],
  });
  const model = buildReviewModel({ reading: observed(raw), production: null, rows: [], store: { ok: true } });
  const byId = Object.fromEntries(model.sections.map((s) => [s.id, s]));
  assert.equal(byId["map-movement"].availability, "REVIEWABLE", "matched by name when the id differs");
  assert.equal(byId["map-movement"].linkIsDeep, true);
  assert.equal(byId.pearl.availability, "REVIEWABLE");
  assert.equal(byId.lumen.availability, "REVIEWABLE");
  assert.equal(byId["raised-state"].availability, "REVIEWABLE");
  assert.equal(byId.theme.availability, "NOT_YET_REVIEWABLE", "Theme is required but the manifest has not exposed it");
  assert.deepEqual(
    model.extras.map((s) => [s.id, s.required]),
    [["onboarding", false]],
    "a manifest-only section renders as an optional, non-gating extra",
  );
  assert.equal(model.sections.length, 5, "exactly the five required sections, regardless of the manifest");
  const theme = model.composite.conditions.find((c) => c.name.startsWith("Theme approved"));
  assert.equal(theme?.ok, false);
  assert.match(theme?.detail ?? "", /NOT_YET_REVIEWABLE/);
  assert.ok(!model.composite.conditions.some((c) => /Onboarding/.test(c.name)), "the extra never becomes a gating condition");
});

/* ================================================================== B4 */

test("B4: decisions persist keyed by the exact SHA with actor and server time; a new SHA has zero decisions; a write against the old SHA is STALE_SHA", async () => {
  const repos = createMemoryRepositories();
  let live = observed(manifestFixture());
  const now = ticking();
  const d = deps(repos.softwareReleaseReviews, () => live, now);

  const approved = await recordReview(d, { action: "DECIDE", stagingSha: SHA_X, section: "map-movement", decision: "APPROVE", feedback: "  looks right  ", choice: null });
  assert.equal(approved.ok, true);
  const feedback = await recordReview(d, { action: "FEEDBACK", stagingSha: SHA_X, section: "pearl", decision: null, feedback: "pill contrast", choice: null });
  assert.equal(feedback.ok, true);
  const rows = await repos.softwareReleaseReviews.read(SHA_X);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].stagingSha, SHA_X);
  assert.equal(rows[0].deployId, DEPLOY_X);
  assert.equal(rows[0].section, "map-movement");
  assert.equal(rows[0].decision, "APPROVE");
  assert.equal(rows[0].feedback, "looks right");
  assert.equal(rows[0].actor, "session:adm_test");
  assert.equal(rows[0].createdAt, "2026-09-06T09:00:01.000Z", "the server clock, not the browser's");
  assert.equal(rows[0].manifest.prompt3Status, "VISUAL_WORK_IN_PROGRESS", "decisions are recorded while Prompt 3 is still working; they bind to the SHA");
  assert.equal(rows[1].decision, "FEEDBACK_ONLY");

  const onX = buildReviewModel({ reading: live, production: null, rows: await repos.softwareReleaseReviews.readAll(), store: { ok: true } });
  assert.equal(onX.sections.find((s) => s.id === "map-movement")?.current.decision, "APPROVE");

  // Staging moves to Y.
  live = observed(manifestFixture({}, SHA_Y), "2026-09-06T10:00:00.000Z");
  const onY = buildReviewModel({ reading: live, production: null, rows: await repos.softwareReleaseReviews.readAll(), store: { ok: true } });
  assert.equal(onY.liveSha, SHA_Y);
  for (const section of onY.sections) assert.equal(section.current.decision, null, `${section.id} must start with no decision on the new SHA`);
  assert.equal(onY.history.length, 1, "the old SHA's rows are history");
  assert.equal(onY.history[0].sha, SHA_X);
  assert.equal(onY.history[0].rows.length, 2);

  const stale = await recordReview(d, { action: "DECIDE", stagingSha: SHA_X, section: "pearl", decision: "APPROVE", feedback: null, choice: null });
  assert.equal(stale.ok, false);
  assert.equal(stale.ok ? "" : stale.code, "STALE_SHA");
  assert.match(stale.ok ? "" : stale.detail, /staging moved to bbbbbbbb/);
  assert.equal((await repos.softwareReleaseReviews.readAll()).length, 2, "nothing was re-targeted or recorded");

  // Supersession is by later row, and the earlier row stays.
  live = observed(manifestFixture());
  const changed = await recordReview(d, { action: "DECIDE", stagingSha: SHA_X, section: "map-movement", decision: "NEEDS_CHANGES", feedback: "one more pass", choice: null });
  assert.equal(changed.ok, true);
  const again = buildReviewModel({ reading: live, production: null, rows: await repos.softwareReleaseReviews.readAll(), store: { ok: true } });
  const map = again.sections.find((s) => s.id === "map-movement")!;
  assert.equal(map.current.decision, "NEEDS_CHANGES");
  assert.equal(map.history.length, 2, "history keeps the superseded APPROVE");
  assert.deepEqual(map.history.map((r) => r.decision), ["NEEDS_CHANGES", "APPROVE"]);
});

test("B4: the log is append-only — the same row id with a different record is refused", async () => {
  const repos = createMemoryRepositories();
  const now = ticking();
  const d = deps(repos.softwareReleaseReviews, () => observed(manifestFixture()), now);
  const first = await recordReview(d, { action: "DECIDE", stagingSha: SHA_X, section: "lumen", decision: "DISCARD", feedback: null, choice: null });
  assert.equal(first.ok, true);
  const [row] = await repos.softwareReleaseReviews.read(SHA_X);
  await assert.rejects(
    repos.softwareReleaseReviews.append(SHA_X, row.id, { ...row, decision: "APPROVE" } as SoftwareReleaseReviewRecord, row.createdAt),
    (error: unknown) => error instanceof AppendOnlyViolation,
    "rewriting a row is an AppendOnlyViolation",
  );
});

/* ================================================================== B5 */

test("B5: APPROVE on Raised State is refused until a variant is chosen on that SHA; the choice touches nothing else", async () => {
  const repos = createMemoryRepositories();
  const now = ticking();
  const d = deps(repos.softwareReleaseReviews, () => observed(manifestFixture()), now);
  const refused = await recordReview(d, { action: "DECIDE", stagingSha: SHA_X, section: "raised-state", decision: "APPROVE", feedback: null, choice: null });
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? "" : refused.code, "RAISED_STATE_CHOICE_REQUIRED");
  assert.match(refused.ok ? "" : refused.detail, /A_SOFT_LIFT \/ B_MATERIAL_LIFT \/ C_DEEP_LIFT/);
  assert.equal((await repos.softwareReleaseReviews.readAll()).length, 0);

  const bad = await recordReview(d, { action: "RAISED_STATE_CHOICE", stagingSha: SHA_X, section: null, decision: null, feedback: null, choice: "D_MOON_LIFT" });
  assert.equal(bad.ok ? "" : bad.code, "BAD_REQUEST");

  const chosen = await recordReview(d, { action: "RAISED_STATE_CHOICE", stagingSha: SHA_X, section: null, decision: null, feedback: null, choice: "B_MATERIAL_LIFT" });
  assert.equal(chosen.ok, true);
  const model = buildReviewModel({ reading: observed(manifestFixture()), production: null, rows: await repos.softwareReleaseReviews.readAll(), store: { ok: true } });
  assert.equal(model.raisedState.status, "CHOSEN");
  assert.equal(model.raisedState.choice, "B_MATERIAL_LIFT");

  const approved = await recordReview(d, { action: "DECIDE", stagingSha: SHA_X, section: "raised-state", decision: "APPROVE", feedback: null, choice: null });
  assert.equal(approved.ok, true);

  // A choice on X says nothing about Y.
  const onY = buildReviewModel({ reading: observed(manifestFixture({}, SHA_Y)), production: null, rows: await repos.softwareReleaseReviews.readAll(), store: { ok: true } });
  assert.equal(onY.raisedState.status, "AWAITING_OWNER_CHOICE");
});

/* ================================================================== B6 */

async function approveAll(d: WriteDeps, sha: string): Promise<void> {
  const chosen = await recordReview(d, { action: "RAISED_STATE_CHOICE", stagingSha: sha, section: null, decision: null, feedback: null, choice: "A_SOFT_LIFT" });
  assert.equal(chosen.ok, true);
  for (const section of REQUIRED_SECTIONS) {
    const out = await recordReview(d, { action: "DECIDE", stagingSha: sha, section: section.id, decision: "APPROVE", feedback: null, choice: null });
    assert.equal(out.ok, true, `${section.id}: ${out.ok ? "" : out.detail}`);
  }
}

test("B6: OWNER_APPROVED_FOR_PRODUCTION names every failing condition and is refused until all pass", async () => {
  const repos = createMemoryRepositories();
  const now = ticking();
  const live = observed(manifestFixture());
  const d = deps(repos.softwareReleaseReviews, () => live, now);

  // Nothing approved, no variant, status not ready: every one of those is named.
  const empty = await recordReview(d, { action: "RECORD_OWNER_APPROVAL", stagingSha: SHA_X, section: null, decision: null, feedback: null, choice: null });
  assert.equal(empty.ok, false);
  assert.equal(empty.ok ? "" : empty.code, "NOT_RECORDABLE");
  for (const name of ["Map Movement approved", "Pearl approved", "Lumen approved", "Theme approved", "Raised State A/B/C approved", "Raised State variant chosen", `manifest status is ${REVIEW_READY_STATUS}`]) {
    assert.match(empty.ok ? "" : empty.detail, new RegExp(name.replace(/[/]/g, "\\/")), `names the failing condition: ${name}`);
  }
  assert.equal((await repos.softwareReleaseReviews.readAll()).length, 0);

  // Four of five approved and the variant chosen — still refused, naming only Theme and the status.
  await approveAll(d, SHA_X);
  const demoted = await recordReview(d, { action: "DECIDE", stagingSha: SHA_X, section: "theme", decision: "NEEDS_CHANGES", feedback: null, choice: null });
  assert.equal(demoted.ok, true);
  const partial = await recordReview(d, { action: "RECORD_OWNER_APPROVAL", stagingSha: SHA_X, section: null, decision: null, feedback: null, choice: null });
  assert.equal(partial.ok ? "" : partial.code, "NOT_RECORDABLE");
  assert.match(partial.ok ? "" : partial.detail, /Theme approved/);
  assert.doesNotMatch(partial.ok ? "" : partial.detail, /Pearl approved/);

  // All five approved and the variant chosen, but Prompt 3 still says VISUAL_WORK_IN_PROGRESS.
  const reApproved = await recordReview(d, { action: "DECIDE", stagingSha: SHA_X, section: "theme", decision: "APPROVE", feedback: null, choice: null });
  assert.equal(reApproved.ok, true);
  const notReady = await recordReview(d, { action: "RECORD_OWNER_APPROVAL", stagingSha: SHA_X, section: null, decision: null, feedback: null, choice: null });
  assert.equal(notReady.ok ? "" : notReady.code, "NOT_RECORDABLE");
  assert.match(notReady.ok ? "" : notReady.detail, /manifest status is READY_FOR_REVIEW \(prompt3Status = VISUAL_WORK_IN_PROGRESS\)/);
  const modelNotReady = buildReviewModel({ reading: live, production: null, rows: await repos.softwareReleaseReviews.readAll(), store: { ok: true } });
  assert.equal(modelNotReady.composite.recordable, false);
  assert.deepEqual(
    modelNotReady.composite.conditions.filter((c) => !c.ok).map((c) => c.name),
    [`manifest status is ${REVIEW_READY_STATUS}`],
    "exactly one condition fails and it is named",
  );
  assert.equal((await repos.softwareReleaseReviews.readAll()).filter((r) => r.decision === "OWNER_APPROVED_FOR_PRODUCTION").length, 0, "never auto-recorded on the last approval");
});

test("B6: the passing path records once, on an explicit request, composed from the five approvals and the variant row, and appends nothing else", async () => {
  const repos = createMemoryRepositories();
  const now = ticking();
  const live = observed(manifestFixture({ prompt3Status: REVIEW_READY_STATUS, reviewState: REVIEW_READY_STATUS }));
  const d = deps(repos.softwareReleaseReviews, () => live, now);
  await approveAll(d, SHA_X);
  const before = await repos.softwareReleaseReviews.readAll();
  assert.equal(before.length, 6, "five approvals and one variant choice");
  assert.equal(before.filter((r) => r.decision === "OWNER_APPROVED_FOR_PRODUCTION").length, 0, "the last approval did not record the composite");

  const model = buildReviewModel({ reading: live, production: null, rows: before, store: { ok: true } });
  assert.equal(model.composite.recordable, true);
  assert.deepEqual(model.composite.conditions.filter((c) => !c.ok), []);
  assert.equal(model.composite.composedFrom.length, 6);

  const recorded = await recordReview(d, { action: "RECORD_OWNER_APPROVAL", stagingSha: SHA_X, section: null, decision: null, feedback: "ship it", choice: null });
  assert.equal(recorded.ok, true);
  const after = await repos.softwareReleaseReviews.readAll();
  assert.equal(after.length, 7, "exactly one row was appended by the composite");
  const composite = after[after.length - 1];
  assert.equal(composite.decision, "OWNER_APPROVED_FOR_PRODUCTION");
  assert.equal(composite.stagingSha, SHA_X);
  assert.equal(composite.deployId, DEPLOY_X);
  assert.equal(composite.raisedStateChoice, "A_SOFT_LIFT");
  assert.equal(composite.section, null);
  assert.deepEqual(
    composite.composedFrom,
    model.composite.composedFrom,
    "the record stores the row ids it was composed from",
  );
  const approvalIds = before.filter((r) => r.decision === "APPROVE").map((r) => r.id);
  for (const id of approvalIds) assert.ok(composite.composedFrom?.includes(id), `composed from ${id}`);
  assert.equal(composite.composedFrom?.filter((id) => approvalIds.includes(id)).length, 5, "the five section-approval row ids");

  const twice = await recordReview(d, { action: "RECORD_OWNER_APPROVAL", stagingSha: SHA_X, section: null, decision: null, feedback: null, choice: null });
  assert.equal(twice.ok ? "" : twice.code, "ALREADY_RECORDED");
  assert.equal((await repos.softwareReleaseReviews.readAll()).length, 7);

  // The record is the end of the line: every other repository is untouched.
  for (const [name, repo] of Object.entries(repos)) {
    if (name === "softwareReleaseReviews" || typeof repo !== "object" || repo === null || !("readAll" in repo)) continue;
    assert.deepEqual(await (repo as { readAll(): Promise<readonly unknown[]> }).readAll(), [], `${name} was written by the release review`);
  }
});

/* ================================================================== B7 */

test("B7: the one additive table is declared at schema v8 and every provider bundle carries the log", async () => {
  assert.equal(BOOTSTRAP_VERSION, 8);
  assert.ok((APPEND_ONLY_LOGS as readonly string[]).includes("software_release_reviews"));
  assert.ok(DECLARED_TABLES.includes("cp_log_software_release_reviews"));
  const ddl = BOOTSTRAP_DDL.filter((s) => s.includes("cp_log_software_release_reviews"));
  assert.equal(ddl.length, 2, "one CREATE TABLE IF NOT EXISTS and one unique order index, additive");
  assert.match(ddl[0], /CREATE TABLE IF NOT EXISTS cp_log_software_release_reviews/);
  assert.doesNotMatch(BOOTSTRAP_DDL.join("\n"), /ALTER TABLE|DROP TABLE/, "no existing table is edited");

  const record: SoftwareReleaseReviewRecord = {
    formatVersion: 1,
    id: `${SHA_X}:APPROVE:pearl:2026-09-06T09:00:01.000Z`,
    stagingSha: SHA_X,
    deployId: DEPLOY_X,
    section: "pearl",
    decision: "APPROVE",
    raisedStateChoice: null,
    feedback: null,
    actor: "session:adm_test",
    composedFrom: null,
    createdAt: "2026-09-06T09:00:01.000Z",
    manifest: { prompt3Status: "VISUAL_WORK_IN_PROGRESS", reviewState: "VISUAL_WORK_IN_PROGRESS", stagingBoundary: "STABLE", reportedAt: null },
  };
  const providers: readonly [string, ControlPlaneRepositories][] = [
    ["memory", createMemoryRepositories()],
    ["file", await createFileRepositories(mkdtempSync(join(tmpdir(), "wtp-release-review-")))],
  ];
  for (const [name, repos] of providers) {
    const appended = await repos.softwareReleaseReviews.append(SHA_X, record.id, record, record.createdAt);
    assert.equal(appended.appended, true, `${name}: first append`);
    assert.deepEqual(await repos.softwareReleaseReviews.read(SHA_X), [record], `${name}: read by SHA`);
    assert.deepEqual(await repos.softwareReleaseReviews.keys(), [SHA_X], `${name}: keys`);
    assert.equal((await repos.softwareReleaseReviews.readAll()).length, 1, `${name}: readAll`);
    const retry = await repos.softwareReleaseReviews.append(SHA_X, record.id, record, record.createdAt);
    assert.equal(retry.appended, false, `${name}: a byte-identical retry is a no-op success`);
  }
});

function request(host: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): NextRequest {
  return new NextRequest(`https://${host}${path}`, { method: init.method ?? "GET", headers: { host, ...(init.headers ?? {}) }, body: init.body });
}

async function sessionCookie(): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const value = await signSession({ sid: "adm_test-session", iat, exp: iat + SESSION_LIFETIME_SECONDS }, SESSION_KEY);
  return `${ADMIN_SESSION_COOKIE}=${value}`;
}

async function withSessionKey<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env[ADMIN_SESSION_KEY_VAR];
  process.env[ADMIN_SESSION_KEY_VAR] = SESSION_KEY;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env[ADMIN_SESSION_KEY_VAR];
    else process.env[ADMIN_SESSION_KEY_VAR] = before;
  }
}

test("B7: the review page and route are 404 on the public host and refuse a missing session and a foreign origin", async () => {
  for (const path of ["/admin/release-review", "/api/admin/release-review"]) {
    const response = await middleware(request(PUBLIC_HOST, path));
    assert.equal(response.status, 404, `${path} on the public host`);
  }
  const redirected = await middleware(request(ADMIN_HOST, "/admin/release-review"));
  assert.equal(redirected.status, 307, "an unauthenticated page request redirects to the login");
  assert.match(redirected.headers.get("location") ?? "", /\/admin\/login/);

  await withSessionKey(async () => {
    const body = `action=DECIDE&stagingSha=${SHA_X}&section=pearl&decision=APPROVE`;
    const form = { "content-type": "application/x-www-form-urlencoded" };
    assert.equal((await POST(request(PUBLIC_HOST, "/api/admin/release-review", { method: "POST", headers: { ...form, origin: ADMIN_ORIGIN, cookie: await sessionCookie() }, body }))).status, 404);
    assert.equal((await POST(request(ADMIN_HOST, "/api/admin/release-review", { method: "POST", headers: { ...form, origin: PUBLIC_SITE_ORIGIN, cookie: await sessionCookie() }, body }))).status, 403, "a foreign origin is refused");
    assert.equal((await POST(request(ADMIN_HOST, "/api/admin/release-review", { method: "POST", headers: { ...form, origin: ADMIN_ORIGIN }, body }))).status, 401, "no session is refused inside the handler too");
    assert.equal((await GET(request(ADMIN_HOST, "/api/admin/release-review"))).status, 401, "the read route needs the session as well");
    assert.equal((await GET(request(PUBLIC_HOST, "/api/admin/release-review"))).status, 404);
    // A refresh needs no store and lands back on the page.
    const refreshed = await POST(request(ADMIN_HOST, "/api/admin/release-review", { method: "POST", headers: { ...form, origin: ADMIN_ORIGIN, cookie: await sessionCookie() }, body: "action=REFRESH" }));
    assert.equal(refreshed.status, 303);
    assert.match(refreshed.headers.get("location") ?? "", /\/admin\/release-review\?notice=REFRESHED/);
  });
});
