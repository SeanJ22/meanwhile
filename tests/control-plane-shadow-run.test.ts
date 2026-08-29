/**
 * THE SHADOW-RUN ACCEPTANCE TEST — the ten properties a proving run must have,
 * asserted against the run itself rather than against a description of it.
 *
 * This executes `runPimaShadow`, the SAME function `pnpm shadow:run` calls.
 * RULING 103: a script whose behaviour can diverge from the test that certifies
 * it is a script nothing certifies. There is one implementation here and two
 * callers.
 *
 * It runs against DURABLE stores over a temp root, not the in-memory doubles.
 * The properties under test are about survival and attribution, and a double
 * that keeps everything in one process cannot witness either — `assertDurable`
 * exists precisely so a durability claim cannot be made against a `Map`.
 *
 * Every instant is supplied. Nothing here sleeps, and nothing reads a clock.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { OMITTED_ROUTE, runPimaShadow } from "../lib/control-plane/shadow/pima-run.ts";
import { PIMA_UNION_DENOMINATOR } from "../lib/control-plane/fixtures/pima-meetings.ts";
import { loadMethodStore } from "../lib/workstate/load.ts";
import type { ShadowRunResult } from "../lib/control-plane/shadow/pima-run.ts";

const ROOT = join(import.meta.dirname, "..");

const READER_SURFACES = [
  "data/meetings-snapshot.json",
  "data/method/knowledge.json",
  "data/ops/production-integrity.json",
];

/**
 * Run once and share the result.
 *
 * The run is deterministic — same fixtures, same clock, same method store — so
 * running it per test would prove the same thing eight times and spend eight
 * temp directories doing it. What each test asserts is a different property OF
 * THE ONE RUN, which is also how a reader will read the record.
 */
let RESULT: ShadowRunResult;
let ROOT_DIR: string;

test("the shadow run executes end to end against DURABLE stores", async () => {
  const knowledge = loadMethodStore(ROOT);
  assert.ok(knowledge, "no method store — the floor cannot be computed from a projection");

  ROOT_DIR = mkdtempSync(join(tmpdir(), "wtp-shadow-"));
  const repos = await createFileRepositories(join(ROOT_DIR, "state"));
  const evidence = new DurableEvidenceStore(join(ROOT_DIR, "evidence"));

  // The properties under test are about durability. A run against the in-memory
  // doubles would assert them about a Map.
  assert.equal(repos.durable, true, "the repositories must be durable for this test to mean anything");
  assert.equal(
    (evidence as unknown as { durable: boolean }).durable,
    true,
    "the evidence store must be durable for this test to mean anything",
  );

  RESULT = await runPimaShadow({
    repos,
    evidence,
    knowledge,
    fixtureDir: join(ROOT, "tests", "fixtures"),
    readerSurfaces: READER_SURFACES,
    readerSurfacePaths: READER_SURFACES.map((s) => join(ROOT, s)),
    stateRoot: join(ROOT_DIR, "state"),
    runId: "shadow-pima-acceptance",
  });

  assert.ok(RESULT.record, "the run produced no record");
});

/* ── 1. WorkItem durable ─────────────────────────────────────────────────── */

test("1. the WorkItem is durable — a FRESH repository instance over the same root sees it", async () => {
  const fresh = await createFileRepositories(join(ROOT_DIR, "state"));
  const item = await fresh.workItems.mustRead(RESULT.record.workItemId);
  assert.equal(item.value.subject, RESULT.record.subject);
  assert.ok(item.revision >= 1, "a persisted aggregate carries a revision");
  // Nothing in the original process is load-bearing: this instance was
  // constructed after the run finished and reads only what reached disk.
  assert.equal(item.value.routeTaskIds.length, RESULT.record.floor.routes.length);
});

/* ── 2. the floor is COMPUTED from the method projection, never typed ─────── */

test("2. the inherited floor is computed from the canonical method projection", () => {
  const { floor, record } = RESULT;
  assert.equal(floor.methodVersion, 55, "the floor pins the method version it was computed against");

  const fromProjection = record.floor.routes.filter((r) => r.origins.includes("METHOD_PROJECTION"));
  const fromAdapter = record.floor.routes.filter((r) => r.origins.includes("ADAPTER_DECLARED"));
  assert.ok(fromProjection.length > 0, "no route came from the method store — the floor was typed");
  assert.equal(fromAdapter.length, 8, "the adapter declares eight first-party surfaces");

  // The union, not either half. A floor built from only one of the two
  // authorities is how fourteen Pima sittings became three.
  assert.equal(record.floor.routes.length, fromProjection.length + fromAdapter.length);

  // The denominator that stops a floor of 28 reading as a store of 28.
  assert.ok(
    record.floor.legacyUnclassifiedCount > 0,
    "the unclassified population is reported beside the floor",
  );
});

/* ── 3. one RouteTask per applicable route ───────────────────────────────── */

test("3. exactly one RouteTask exists per route on the floor, and each is inherited", () => {
  const { record } = RESULT;
  assert.equal(record.routeTasks.length, record.floor.routes.length);
  const ids = new Set(record.routeTasks.map((t) => t.routeTaskId));
  assert.equal(ids.size, record.routeTasks.length, "two tasks share an id");
  for (const t of record.routeTasks) {
    assert.equal(t.inherited, true, `${t.routeId} is on the floor and must be marked inherited`);
  }
});

/* ── 4. bounded Attempts ─────────────────────────────────────────────────── */

test("4. Attempts are bounded — every one is closed, and only COMPLETED may conclude", () => {
  const { record } = RESULT;
  assert.ok(record.attempts.length > 0, "no attempt ran");
  for (const a of record.attempts) {
    assert.notEqual(a.outcome, null, `Attempt ${a.attemptId} never closed`);
    assert.equal(
      a.mayWriteDisposition,
      a.outcome === "COMPLETED",
      "only a COMPLETED Attempt may carry a route disposition",
    );
  }
});

/* ── 5. artifacts enter the evidence path ────────────────────────────────── */

test("5. artifacts entered the evidence path, durably, each attributed to its Attempt", () => {
  const { record } = RESULT;
  assert.ok(record.artifacts.length > 0, "no artifact was stored");
  const attemptIds = new Set(record.attempts.map((a) => a.attemptId));
  for (const f of record.artifacts) {
    assert.equal(f.durablyStored, true, `${f.artifactId} is not durably stored`);
    assert.equal(f.durabilityRefusal, null);
    assert.match(f.contentHash, /^sha256-[0-9a-f]{64}$/, "an artifact's identity is its hash");
    assert.ok(attemptIds.has(f.attemptId), `${f.artifactId} names an Attempt this run never ran`);
  }
});

/* ── 6. a crashed Attempt creates NO public-record disposition ───────────── */

test("6. SEEDED: the crashed Attempt left artifacts and NO disposition", () => {
  const { record } = RESULT;
  const dead = record.attempts.filter((a) => a.outcome !== "COMPLETED");
  assert.equal(dead.length, 1, "the run is built to kill exactly one Attempt");
  const crashed = dead[0];

  assert.equal(crashed.outcome, "LEASE_EXPIRED", "death is observed from OUTSIDE, from the lease");
  assert.ok(crashed.abortReason, "an unnamed failure is indistinguishable from an unexamined one");
  assert.equal(crashed.mayWriteDisposition, false);

  // The artifacts survive AND stay attributed to the Attempt that fetched them.
  assert.ok(crashed.artifactIds.length > 0, "the partial capture was discarded");
  for (const id of crashed.artifactIds) {
    const artifact = record.artifacts.find((f) => f.artifactId === id);
    assert.ok(artifact, `artifact ${id} is on the dead Attempt and absent from the record`);
    assert.equal(
      artifact.attemptId,
      crashed.attemptId,
      "the partial artifact was re-attributed to the Attempt that finished the route",
    );
  }

  // The route it died on IS disposed — by a LATER Attempt, never by the dead one.
  const task = record.routeTasks.find((t) => t.routeTaskId === crashed.routeTaskId);
  assert.ok(task);
  assert.notEqual(task.dispositionAttemptId, crashed.attemptId);
});

/* ── 7. completion is DERIVED by the control plane ───────────────────────── */

test("7. completion is derived by the control plane from durable state", () => {
  const { record } = RESULT;
  assert.equal(
    record.verdict.mayComplete,
    false,
    "20 speculative method routes are undisposed — closing would be the exact MTG-13 defect",
  );
  assert.ok(record.verdict.refusals.length > 0, "a refusal with no reasons is not a refusal");
  // Every refusal names a subject a later session can act on.
  for (const r of record.verdict.refusals) {
    assert.ok(r.subject.trim(), `refusal ${r.code} names no subject`);
    assert.ok(r.detail.trim(), `refusal ${r.code} carries no detail`);
  }
});

/* ── 8. an omitted known route refuses completion BY EXACT ROUTE ID ──────── */

test("8. SEEDED: omitting /EventDates refuses completion, naming the exact route", () => {
  const { omissionVerdict } = RESULT;
  assert.equal(omissionVerdict.mayComplete, false);

  const named = omissionVerdict.refusals.filter(
    (r) => r.code === "INHERITED_ROUTE_WITHOUT_DISPOSITION" && r.subject === OMITTED_ROUTE,
  );
  assert.equal(
    named.length,
    1,
    `no refusal names ${OMITTED_ROUTE}. This is the MTG-13 shape: every other route walked, ` +
      "the report internally consistent, and one known API never asked.",
  );
  assert.match(named[0].detail, /never walked cannot be reported as a route that found nothing/);
});

test("8b. POSITIVE CONTROL: with /EventDates disposed, that refusal is gone", () => {
  const { record, omissionVerdict } = RESULT;
  // The full run DID dispose it, so the same code with the disposition present
  // raises no refusal naming it. Without this control the assertion above would
  // pass against an evaluator that refuses everything.
  const stillNamed = record.verdict.refusals.filter(
    (r) => r.code === "INHERITED_ROUTE_WITHOUT_DISPOSITION" && r.subject === OMITTED_ROUTE,
  );
  assert.equal(stillNamed.length, 0, `${OMITTED_ROUTE} was disposed and is still refused by name`);
  assert.ok(
    omissionVerdict.refusals.length > record.verdict.refusals.length,
    "withholding a route must produce strictly MORE refusals than disposing it",
  );

  const disposed = record.routeTasks.find((t) => t.routeId === OMITTED_ROUTE);
  assert.ok(disposed);
  assert.equal(
    disposed.disposition,
    "WALKED_NO_YIELD",
    "the route answered and published nothing — a fact about the ROUTE",
  );
  assert.equal(disposed.transport, "REACHABLE", "a zero is admissible only on a reachable transport");
});

/* ── 9. validator and auditor records attach ─────────────────────────────── */

test("9. a validation and an INDEPENDENT adversarial audit are attached", () => {
  const { record } = RESULT;
  const validations = record.checks.filter((c) => c.kind === "VALIDATION");
  const audits = record.checks.filter((c) => c.kind === "AUDIT");
  assert.ok(validations.length > 0 && validations.every((v) => v.passed));
  assert.ok(audits.length > 0 && audits.every((a) => a.passed));
  assert.ok(
    audits.some((a) => a.independent === true),
    "an audit that never left our own pipeline cannot discover that our pipeline was wrong",
  );
});

/* ── 10. no reader-facing truth moved ────────────────────────────────────── */

test("10. SHADOW: no reader-facing surface moved, and the verdict is DERIVED from digests", () => {
  const { record } = RESULT;
  assert.equal(record.mode, "SHADOW");
  assert.equal(record.readerImpact.unchanged, true, `moved: ${record.readerImpact.moved.join(", ")}`);
  assert.deepEqual(record.readerImpact.moved, []);
  assert.equal(record.readerImpact.surfaces.length, READER_SURFACES.length);
  // Derived, not typed: every surface was hashed on both sides.
  for (const s of READER_SURFACES) {
    assert.ok(record.readerImpact.before[s], `${s} was not hashed before the run`);
    assert.ok(record.readerImpact.after[s], `${s} was not hashed after the run`);
    assert.equal(record.readerImpact.before[s], record.readerImpact.after[s]);
  }
});

/* ── the answer is checked against an authority the run cannot move ──────── */

test("the run agrees with the acceptance established BEFORE the control plane existed", () => {
  const { record } = RESULT;
  assert.equal(record.independentAcceptance.expected, PIMA_UNION_DENOMINATOR);
  assert.equal(record.independentAcceptance.agrees, true);
  const grid = record.routeTasks.find((t) => t.routeId === "INSITE_CALENDAR_GRID");
  assert.equal(grid?.normalizedCount, PIMA_UNION_DENOMINATOR);
});

test("the Granicus wall stays a WALL — an OPEN disposition, never an emptiness", () => {
  const granicus = RESULT.record.routeTasks.find((t) => t.routeId === "GRANICUS_VIEW_PUBLISHER");
  assert.ok(granicus);
  assert.equal(granicus.disposition, "BLOCKED_CURRENTLY");
  assert.equal(granicus.permission, "DISALLOWED");
  assert.equal(granicus.outstanding, true, "a blocked route is not a settled fact");
  // The one conversion this product cannot survive.
  assert.notEqual(
    granicus.disposition,
    "WALKED_NO_YIELD",
    "'we are not allowed to look' became 'there is nothing there'",
  );
  assert.equal(
    RESULT.record.artifacts.filter((a) => a.methodRouteId === "GRANICUS_VIEW_PUBLISHER").length,
    0,
    "a disallowed host was fetched anyway to produce an artifact",
  );
});

test("no route the run disposed carries an artifact from another Attempt", () => {
  // The laundering guard, asserted over the whole run rather than in one unit.
  const { record } = RESULT;
  const byAttempt = new Map<string, Set<string>>();
  for (const f of record.artifacts) {
    if (!byAttempt.has(f.attemptId)) byAttempt.set(f.attemptId, new Set());
    byAttempt.get(f.attemptId)!.add(f.artifactId);
  }
  for (const t of record.routeTasks) {
    if (!t.dispositionAttemptId) continue;
    const attempt = record.attempts.find((a) => a.attemptId === t.dispositionAttemptId);
    assert.ok(attempt, `${t.routeId} names a disposing Attempt the record does not carry`);
    for (const id of attempt.artifactIds) {
      assert.ok(
        byAttempt.get(attempt.attemptId)?.has(id),
        `${t.routeId} cites artifact ${id} against an Attempt that never recorded it`,
      );
    }
  }
});

test("cleanup", () => {
  rmSync(ROOT_DIR, { recursive: true, force: true });
});
