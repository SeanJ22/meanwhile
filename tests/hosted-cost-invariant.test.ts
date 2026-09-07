/**
 * **THE MACHINE-ENFORCED COST INVARIANT.** (FCP-5, FCP-9D.)
 *
 * FCP-5 asks for a contract test proving three numbers, and FCP-9D asks for
 * proof that a bot's own bookkeeping cannot recursively buy shipping-grade CI.
 * Both are here, and both are computed from the SHIPPED tables rather than
 * written down:
 *
 * ```
 *   quiet freshness day          0 hosted freshness runs
 *   N source retries             0 additional hosted runs
 *   N source changes, one window <= 1 shipping-triggered hosted path
 *   a bot observation            cheap, and it terminates
 * ```
 *
 * ## Why the numbers are derived and not asserted
 *
 * A test that says `assert.equal(hostedRuns, 0)` against a constant `0` proves
 * that somebody typed a zero. These read the grant table in
 * `resource-policy.ts` and the classifier in `lib/ops/deploy-paths.ts`, so the
 * numbers cannot drift away from the policy that produces them — and widening
 * a grant, or adding a `data/**` prefix to the ops-only set, fails here.
 *
 * ## The recursion proof is a fixed-point argument, run as code
 *
 * The 2026-09-07 chain was: merge -> CI -> deploy -> observer commit -> CI.
 * The question FCP-9D asks is whether that chain can continue. It is answered
 * by simulating it: take the exact paths the observer is granted to write, ask
 * the canonical classifier what they cost and whether they can deploy, and
 * show the chain reaches a state that produces no further commit. One step,
 * cheap, terminated.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  OPS_ONLY_ARTIFACTS,
  classifyCommitCost,
  classifyDeploy,
} from "../lib/ops/deploy-paths.ts";
import { PUSHER_PROFILES, profileFor } from "../lib/ops/push-allowlist.ts";
import {
  RESOURCE_GRANTS,
  SCARCE_RESOURCES,
  classesWithHostedMinutes,
  hostedRunsFor,
  maySpend,
} from "../lib/control-plane/freshness/resource-policy.ts";
import { planWindow, windowFanOut } from "../lib/control-plane/freshness/coalesce.ts";
import { judgeCertification } from "../lib/control-plane/freshness/certification.ts";
import type { CandidateHolding } from "../lib/control-plane/freshness/acquisition.ts";
import { selectExecutors } from "../lib/control-plane/freshness/certification.ts";

const ROOT = join(import.meta.dirname, "..");

function holding(recordClass: string): CandidateHolding {
  return {
    recordClass,
    sourceId: recordClass,
    contentHash: `hash-${recordClass}`,
    governedPaths: [`data/${recordClass}.json`],
    rows: 7,
    acquiredAt: "2026-09-07T04:00:00.000Z",
    evidenceRef: `.window/candidates/${recordClass}`,
  };
}

function certified(recordClass: string) {
  const h = holding(recordClass);
  return judgeCertification({
    holding: h,
    readings: selectExecutors(h).selected.map((e) => ({
      executorId: e.id,
      result: "PASS" as const,
      detail: "passed",
    })),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE THREE NUMBERS FCP-5 REQUIRES
 * ═════════════════════════════════════════════════════════════════════════ */

test("cost invariant · a quiet freshness day costs ZERO hosted runs", () => {
  const plan = planWindow([]);
  const fanOut = windowFanOut(plan);
  assert.equal(fanOut.hostedFreshnessRuns, 0);
  assert.equal(fanOut.commits, 0);
  assert.equal(fanOut.builds, 0);
  assert.equal(fanOut.deploys, 0);
});

test("cost invariant · N source retries cost ZERO additional hosted runs, for every N", () => {
  for (const n of [1, 2, 5, 50, 500]) {
    const retries = Array.from({ length: n }, () => ({ executionClass: "LOCAL_RETRY" }));
    assert.equal(
      hostedRunsFor(retries),
      0,
      `${n} local retries must not buy a hosted run — FCP-5 forbids hosted retries by name`,
    );
  }
});

test("cost invariant · N source changes in one window cost AT MOST ONE shipping path", () => {
  const classes = ["meetings", "fec", "state-votes", "nj-filing"];
  for (let n = 0; n <= classes.length; n += 1) {
    const plan = planWindow(classes.slice(0, n).map(certified));
    const fanOut = windowFanOut(plan);
    assert.ok(fanOut.commits <= 1, `${n} changed sources produced ${fanOut.commits} commits`);
    assert.ok(fanOut.builds <= 1, `${n} changed sources produced ${fanOut.builds} builds`);
    assert.ok(fanOut.deploys <= 1, `${n} changed sources produced ${fanOut.deploys} deploys`);
    assert.equal(fanOut.commits, n === 0 ? 0 : 1, "zero on a quiet day, exactly one otherwise");
    assert.equal(plan.regeneration.passes, n === 0 ? 0 : 1, "dependents regenerate once, not per source");
  }
});

test("cost invariant · exactly ONE execution class may spend hosted minutes, and it is not freshness", () => {
  const classes = classesWithHostedMinutes();
  assert.deepEqual([...classes], ["SHIPPING_CERTIFICATION"]);
  for (const grant of RESOURCE_GRANTS) {
    if (grant.executionClass === "SHIPPING_CERTIFICATION") continue;
    assert.equal(
      grant.allowed.includes("hosted-actions-minutes"),
      false,
      `${grant.executionClass} must not be able to spend hosted minutes: GitHub Actions is CI, ` +
        "not the runtime control loop (FCP-5)",
    );
  }
});

test("cost invariant · every scarce resource is refused by default until a class names it", () => {
  for (const resource of SCARCE_RESOURCES) {
    const granted = RESOURCE_GRANTS.filter((g) => g.allowed.includes(resource));
    assert.ok(
      granted.length >= 1,
      `${resource} is declared scarce and no class may spend it — an unspendable resource is a ` +
        "table entry nobody can use",
    );
    /* And a class that does not name it is refused, which is the direction. */
    const ungranted = RESOURCE_GRANTS.find((g) => !g.allowed.includes(resource));
    if (ungranted) {
      assert.equal(maySpend(ungranted.executionClass, resource).allowed, false);
    }
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * FCP-9D — A BOT'S BOOKKEEPING CANNOT RECURSIVELY BUY SHIPPING-GRADE CI
 * ═════════════════════════════════════════════════════════════════════════ */

/** Every path a scheduled pusher writes, taken from its OWN grant. */
function pathsWrittenBy(pusher: string): string[] {
  const profile = profileFor(pusher);
  assert.ok(profile, `${pusher} has no pusher profile`);
  return profile.allow.map((a) => a.path).filter((p) => !p.endsWith("/"));
}

test("FCP-9D · the observer's own commit takes the CHEAP path", () => {
  const observerPaths = OPS_ONLY_ARTIFACTS.filter((a) => a.writtenBy === "post-deploy-integrity").map(
    (a) => a.path,
  );
  assert.ok(observerPaths.length > 0, "the observer writes something, and it is listed exactly");
  const decision = classifyCommitCost(observerPaths);
  assert.equal(decision.cost, "CHEAP");
  assert.equal(decision.klass, "NON_SHIPPING");
  assert.deepEqual(decision.proofBearing, [], "nothing the observer writes earns the full proof");
  assert.ok(decision.proofs.length > 0, "the cheap path is a proof, not an absence");
});

test("FCP-9D · the chain terminates: the observer's commit cannot cause another observation", () => {
  /*
   * The fixed-point argument, run rather than asserted.
   *
   *   step 0  a code merge lands            SHIPPING -> deploy -> observation
   *   step 1  the observation commit lands  can it deploy? if not, no step 2.
   */
  const observerPaths = OPS_ONLY_ARTIFACTS.filter((a) => a.writtenBy === "post-deploy-integrity").map(
    (a) => a.path,
  );
  const deploy = classifyDeploy(observerPaths);
  assert.notEqual(
    deploy.verdict,
    "build",
    "if the observer's own commit could deploy, it would produce another observation, and the " +
      "chain would not terminate",
  );
  /* And the second hop is therefore never taken: there is nothing to observe. */
  assert.equal(classifyCommitCost(observerPaths).cost, "CHEAP");
});

test("FCP-9D · every scheduled pusher's own output is cheap, so no pusher can recurse", () => {
  for (const profile of PUSHER_PROFILES) {
    const exact = pathsWrittenBy(profile.id);
    const opsOnly = exact.filter((p) => OPS_ONLY_ARTIFACTS.some((a) => a.path === p));
    if (opsOnly.length === 0) continue;
    /*
     * Only the paths that ARE on the ops-only list are claimed cheap. A pusher
     * that writes a governed artifact alongside them takes the full proof, and
     * that is correct — the daily refresh's data is exactly that case.
     */
    const decision = classifyCommitCost(opsOnly);
    assert.equal(
      decision.cost,
      "CHEAP",
      `${profile.id}'s own ops-only output must not buy shipping-grade CI`,
    );
  }
});

test("FCP-9D · the ops-only set stays EXACT FILES — no directory-wide skip", () => {
  for (const artifact of OPS_ONLY_ARTIFACTS) {
    assert.equal(
      artifact.path.endsWith("/"),
      false,
      `${artifact.path} is a prefix; RULING 278 refuses a directory-wide skip because pnpm build ` +
        "reads committed data",
    );
    assert.equal(artifact.path.includes("*"), false, `${artifact.path} is a glob`);
    assert.ok(artifact.provenBy.length > 0, `${artifact.path} names no guard that reads it`);
    assert.ok(
      profileFor(artifact.writtenBy),
      `${artifact.path} names ${artifact.writtenBy}, which has no pusher profile`,
    );
  }
});

test("FCP-9D · a broad data/** or docs/** change is still FULL", () => {
  for (const changed of [
    ["data/meetings-snapshot.json"],
    ["docs/rulings.md"],
    ["data/ops/production-integrity.json", "lib/ops/deploy-paths.ts"],
    ["data/ops/production-integrity.json", "data/meetings-snapshot.json"],
  ]) {
    assert.equal(
      classifyCommitCost(changed).cost,
      "FULL",
      `${changed.join(", ")} must take the full proof — mixed and unknown are always FULL`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE BACKUP WAKEUP NO LONGER SPENDS ON A QUIET DAY
 * ═════════════════════════════════════════════════════════════════════════ */

test("the refresh workflow asks whether the authoritative clock ran before it spends", () => {
  const text = readFileSync(join(ROOT, ".github", "workflows", "refresh-daily.yml"), "utf8");
  assert.match(
    text,
    /scripts\/backup-wakeup\.mjs/,
    "the hosted backup must ask one cheap question before installing and sweeping every source; " +
      "a backup that does the full work every night is the quiet-day cost FCP-5 forbids",
  );
  /*
   * And the expensive steps must be conditional on that answer. Anchored on the
   * shipped text (RULING 147), so dropping the condition fails here.
   */
  assert.match(text, /steps\.wakeup\.outputs\.run_the_work == 'yes'/);
  assert.match(
    text,
    /corepack pnpm install --frozen-lockfile/,
    "the install step must still exist — this test would pass vacuously if it were renamed",
  );
});

test("no workflow keeps a second path-classification table", () => {
  for (const workflow of [
    "build-check.yml",
    "post-deploy-integrity.yml",
    "refresh-daily.yml",
  ]) {
    const text = readFileSync(join(ROOT, ".github", "workflows", workflow), "utf8");
    assert.equal(
      /^\s*paths-ignore:/m.test(text),
      false,
      `${workflow} has a paths-ignore filter — a second truth table in GitHub's own syntax`,
    );
    assert.equal(
      /^\s*paths:/m.test(text),
      false,
      `${workflow} has a paths filter — same defect, same reason (RULING 278)`,
    );
  }
});
