import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  applyEarnedPortability,
  earnedPortability,
  emptyKnowledge,
  findReopenings,
  learnRoute,
  recordRouteOutcome,
  type MethodKnowledge,
  type MethodRoute,
  type PriorConclusion,
} from "../lib/method/knowledge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";
import { methodFixture } from "./method-store-fixture.ts";
import { planDescentStart } from "../lib/workstate/frontier.ts";
import { DESCENT_STATES, loadWorkstreamFor } from "../lib/workstate/load.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ================================================================ FINDING 3 */

test("FINDING 3 — the EXECUTION path resumes canonical work with the seed initializer unavailable", () => {
  // `planDescentStart` is what `scripts/descent.mts` calls. Passing 0 seeds is
  // exactly what the command sees when the seed list is empty or removed.
  //
  // The old proof exercised `resumeFrom` and concluded the descent resumes
  // without seeds. It proved the HELPER; the command still threw on an empty
  // seed list, so recovering 1,614 persisted edges depended on the initializer.
  for (const state of DESCENT_STATES) {
    const w = loadWorkstreamFor(ROOT, state);
    if (!w) continue;

    const plan = planDescentStart(ROOT, state, 0);
    assert.equal(plan.mode, "RESUME", `${state}: must resume from canonical state with no seeds`);
    assert.ok(plan.outstanding > 0, `${state}: outstanding work is recovered`);
    assert.ok(plan.firstEdge, `${state}: the first canonical edge is identified without a crawl`);

    // The first edge and the cursor AGREE with canonical state — the plan is
    // reading the store, not reconstructing an answer.
    const canonicalFirst = w.edges.find((e) => e.id === plan.firstEdge?.id);
    assert.ok(canonicalFirst, `${state}: the first edge exists in the persisted workstream`);
    assert.equal(plan.cursor, w.cursor, `${state}: the plan's cursor is the persisted cursor`);

    // Root recheck is SEPARATE work, and its unavailability is stated rather
    // than folded into recovery.
    assert.equal(plan.rootRecheckAvailable, false);
    assert.match(plan.reason, /top-of-tier recheck is SKIPPED|Tier roots/);
  }
});

test("FINDING 3 — seeds still initialize a jurisdiction with no canonical state, and nothing refuses silently", () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-plan-"));
  try {
    // No canonical state, no seeds -> REFUSED, with the reason named.
    const refused = planDescentStart(dir, "zz", 0);
    assert.equal(refused.mode, "REFUSED");
    assert.match(refused.reason, /RULING 93/);

    // No canonical state, seeds present -> INITIALIZE. Seeds keep their job.
    const init = planDescentStart(dir, "zz", 5);
    assert.equal(init.mode, "INITIALIZE");
    assert.match(init.reason, /tier roots/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================================================ FINDING 4 */

function route(id: string, over: Partial<MethodRoute> = {}): Omit<MethodRoute, "learnedAtVersion"> {
  return {
    id,
    title: id,
    tier: "A1",
    fields: ["roster"],
    applicability: unknownApplicability("test"),
    outcomes: [],
    subBranches: [],
    origin: "test",
    learnedOn: "2026-08-26",
    ...over,
  };
}

test("FINDING 4 — one success records the outcome and does NOT become NATIONWIDE", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  k = recordRouteOutcome(k, "r1", {
    jurisdiction: "nh",
    walkedOn: "2026-08-26",
    rows: 12,
    outcome: "YIELDED",
  }).knowledge;

  assert.equal(k.routes[0].outcomes.length, 1, "the outcome is recorded");
  const earned = earnedPortability(k.routes[0]);
  assert.equal(earned.portability, "UNKNOWN", "one success proves reach nowhere else");
  assert.match(earned.because, /one success does not prove it fails elsewhere/);

  // And it keeps inheriting — narrowing on one success would stop it being
  // offered in the next state, which is the opposite of inherit-everything.
  const { knowledge } = applyEarnedPortability(k);
  assert.equal(knowledge.routes[0].applicability.portability, "UNKNOWN");
});

test("FINDING 4 — breadth earns a transition, deterministically", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  for (const j of ["nh", "nj"]) {
    k = recordRouteOutcome(k, "r1", { jurisdiction: j, walkedOn: "2026-08-26", rows: 5, outcome: "YIELDED" }).knowledge;
  }
  assert.equal(earnedPortability(k.routes[0]).portability, "STATE_FAMILY");

  k = recordRouteOutcome(k, "r1", { jurisdiction: "az", walkedOn: "2026-08-26", rows: 5, outcome: "YIELDED" }).knowledge;
  const three = applyEarnedPortability(k);
  assert.equal(three.knowledge.routes[0].applicability.portability, "NATIONWIDE");
  assert.deepEqual(three.knowledge.routes[0].applicability.states, ["az", "nh", "nj"]);
  assert.equal(three.moved.length, 1);
  assert.match(three.moved[0].because, /YIELDED in 3 distinct jurisdictions/);
});

test("FINDING 4 — a FAILED or BLOCKED attempt never narrows jurisdictional applicability", () => {
  // RULING 182 applied to method knowledge: a timeout, a TLS refusal, a CAPTCHA
  // and a missing adapter are facts about the ATTEMPT.
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  k = recordRouteOutcome(k, "r1", { jurisdiction: "nh", walkedOn: "2026-08-26", rows: 3, outcome: "YIELDED" }).knowledge;
  for (const o of ["FAILED", "BLOCKED"] as const) {
    k = recordRouteOutcome(k, "r1", {
      jurisdiction: "az",
      walkedOn: "2026-08-26",
      rows: 0,
      outcome: o,
      note: "TLS fingerprint refused before any bytes arrived",
    }).knowledge;
  }
  assert.equal(k.routes[0].outcomes.length, 3, "every attempt is recorded");
  assert.equal(
    earnedPortability(k.routes[0]).portability,
    "UNKNOWN",
    "a transport failure must not narrow the route away from Arizona",
  );

  // Narrowing requires a DECLARED jurisdictional failure — a sentence somebody
  // wrote on purpose.
  const narrowed = earnedPortability(k.routes[0], [
    { jurisdiction: "az", why: "Arizona counties have no equivalent office to walk" },
  ]);
  assert.equal(narrowed.portability, "STATE_SPECIFIC");
  assert.match(narrowed.because, /declared jurisdictionally inapplicable/);
});

test("FINDING 4 — a ZERO outcome is recorded as knowledge", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  const res = recordRouteOutcome(k, "r1", {
    jurisdiction: "nh",
    walkedOn: "2026-08-26",
    rows: 0,
    outcome: "ZERO",
  });
  k = res.knowledge;
  assert.equal(res.recorded, true, "a zero-yield walk is knowledge, not a non-event (RULING 88)");
  assert.equal(k.routes[0].outcomes[0].outcome, "ZERO");
  assert.equal(earnedPortability(k.routes[0]).portability, "UNKNOWN");
});

test("FINDING 4 — recording is idempotent across sessions", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  const outcome = { jurisdiction: "nh", walkedOn: "2026-08-26", rows: 4, outcome: "YIELDED" as const };
  k = recordRouteOutcome(k, "r1", outcome).knowledge;
  const again = recordRouteOutcome(k, "r1", outcome);
  assert.equal(again.recorded, false, "the same observation must not deepen the evidence");
  assert.match(again.reason, /already recorded/);
  assert.equal(again.knowledge.routes[0].outcomes.length, 1);

  // Three re-reads of ONE state must never earn NATIONWIDE.
  let spam = k;
  for (let i = 0; i < 5; i += 1) spam = recordRouteOutcome(spam, "r1", outcome).knowledge;
  assert.equal(earnedPortability(spam.routes[0]).portability, "UNKNOWN");
});

test("FINDING 4 — a newly learned route still reopens a prior conclusion", () => {
  let k = learnRoute(emptyKnowledge(), route("r1"), "2026-08-26").knowledge;
  const conclusions: PriorConclusion[] = [
    {
      id: "absence-1",
      kind: "ABSENCE",
      field: "roster",
      jurisdiction: { state: "nh" },
      earnedAtVersion: k.version,
      earnedOn: "2026-08-20",
    },
  ];
  assert.equal(findReopenings(k, conclusions).length, 0);
  k = learnRoute(k, route("r2"), "2026-08-27").knowledge;
  assert.equal(findReopenings(k, conclusions).length, 1, "the compounding rule still holds after the hotfix");
});

test("FINDING 4 — the real store round-trips a recorded outcome", () => {
  // Load the frozen store, exercise the path, observe the earned result, and round-trip it through JSON. Nothing is written to disk.
  let k = methodFixture();
  const id = k.routes[0].id;
  assert.equal(k.routes[0].applicability.portability, "UNKNOWN");

  for (const j of ["nh", "nj", "az"]) {
    k = recordRouteOutcome(k, id, { jurisdiction: j, walkedOn: "2026-08-26", rows: 7, outcome: "YIELDED" }).knowledge;
  }
  const { knowledge } = applyEarnedPortability(k);

  const reloaded = JSON.parse(JSON.stringify(knowledge)) as MethodKnowledge;
  const r = reloaded.routes.find((x) => x.id === id);
  assert.equal(r?.outcomes.length, 3, "outcomes survive the round trip");
  assert.equal(r?.applicability.portability, "NATIONWIDE", "and the earned class is observable on reload");
});

/* ============================================== NO DESCENT MUTATION */

test("the descent only ever grows from the hotfix fingerprint — nothing is lost or rewritten", () => {
  /*
   * WHAT THIS GUARD IS FOR NOW, AND WHY IT CHANGED.
   *
   * It was written for the 2026-08-26 hotfix session, whose scope forbade
   * walking anything, and it asserted EQUALITY against a fingerprint taken
   * before the first fix: same edges, same candidates, same promoted count.
   *
   * That made it a guard with a one-session lifespan. The descent is supposed
   * to advance, and the next session that advanced it — the descent-resume
   * session, which promoted 667 bodies and recovered 69 stranded Arizona
   * addresses — was failed by a guard whose real complaint was that work had
   * been done.
   *
   * The durable invariant underneath it is MONOTONICITY, and that one is worth
   * keeping forever: canonical state may grow, and it may never shrink. An
   * edge count that falls means a frontier was rebuilt from seeds instead of
   * resumed (RULING 181); a candidate count that falls means leads were
   * deleted rather than classified (RULING 88); a promoted count that falls
   * means a body left the registry without anyone saying so.
   *
   * So equality becomes `>=`, the fingerprint stays exactly as it was, and the
   * guard now catches the thing that would actually be a defect.
   */
  const fp = join(ROOT, "docs", "governance", "hotfix-fingerprint.json");
  if (!existsSync(fp)) return;
  const before = JSON.parse(readFileSync(fp, "utf8")) as {
    states: Record<string, { edges: number; outstanding: number; edgeDigest: string; candidates: number; promoted: number; unmaterialized: number }>;
  };
  for (const [state, b] of Object.entries(before.states)) {
    const w = loadWorkstreamFor(ROOT, state);
    assert.ok(w, `${state} must still exist`);
    assert.ok(
      w.edges.length >= b.edges,
      `${state}: edge count FELL from ${b.edges} to ${w.edges.length} — a frontier was rebuilt, not resumed`,
    );
    assert.ok(
      w.candidates.length >= b.candidates,
      `${state}: candidate count FELL from ${b.candidates} to ${w.candidates.length} — leads were deleted rather than classified`,
    );
    assert.ok(
      w.candidates.filter((c) => c.state === "BODY_PROMOTED").length >= b.promoted,
      `${state}: promoted-body count FELL — a body left the registry without anyone saying so`,
    );
    /* The historical obligation is the one number that may NOT quietly move in
     * either direction. It is discharged by a recovery walk that reports what
     * it recovered, never by a run that stops mentioning it — which is exactly
     * what happened to the cursor clause on 2026-08-26 before `deriveCursor`
     * was made to derive it. */
    const owed = (w.unmaterialized ?? []).reduce((n, u) => n + (u.count ?? 0), 0);
    assert.equal(
      owed,
      b.unmaterialized,
      `${state}: the unmaterialized obligation moved from ${b.unmaterialized} to ${owed} without a recovery walk accounting for it`,
    );
  }
});

void execFileSync;
