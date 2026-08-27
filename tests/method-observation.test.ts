import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { ManifestBranch, ManifestWalk } from "../lib/hunt/branch-manifest.ts";
import { MANIFEST_VERSION } from "../lib/hunt/branch-manifest.ts";
import {
  applyEarnedPortability,
  earnedPortability,
  findReopenings,
  learnRoute,
  type MethodKnowledge,
  type PriorConclusion,
} from "../lib/method/knowledge.ts";
import { classifyBranch, observeManifestWalk } from "../lib/method/observe.ts";
import { unknownApplicability } from "../lib/method/portability.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * THE INHERITED-ROUTE INTEGRATION PROOF.
 *
 * The method store shipped with a writer and `scripts/descent.mts` called it —
 * but only for routes it MINTED, ids shaped `descent-tier-<tier>`. The 61
 * routes the project already knew still had `outcomes: []`, so walking
 * `host-inversion` on every person in New Hampshire taught `host-inversion`
 * nothing. A synthetic id receiving the observation is the same defect as no
 * observation at all.
 *
 * **These tests use a REAL inherited route id, loaded from the committed store,
 * through the real observation seam.** Not a fixture route, not a direct call
 * to `recordRouteOutcome` with a hand-typed id — those would prove the storage
 * function, which was never the thing in doubt.
 *
 * The committed store is never written: every case runs against a copy.
 */

/** A real inherited route id, read from the committed store rather than typed. */
function realInheritedRoute(k: MethodKnowledge): string {
  const r = k.routes.find(
    (x) => x.origin.includes("branch-manifest") && x.outcomes.length === 0,
  );
  assert.ok(r, "the committed store must hold inherited routes with no outcomes yet");
  return r.id;
}

function scratchStore(): { dir: string; path: string; knowledge: MethodKnowledge } {
  const dir = mkdtempSync(join(tmpdir(), "wtp-observe-"));
  cpSync(join(ROOT, "data", "method"), join(dir, "data", "method"), { recursive: true });
  const path = join(dir, "data", "method", "knowledge.json");
  return { dir, path, knowledge: JSON.parse(readFileSync(path, "utf8")) as MethodKnowledge };
}

function walk(branches: ManifestBranch[], on = "2026-08-26"): ManifestWalk {
  return {
    field: "verifiedPage",
    branches,
    checkedAt: on,
    manifestVersion: MANIFEST_VERSION,
  };
}

function branch(route: string, over: Partial<ManifestBranch> = {}): ManifestBranch {
  return {
    route,
    branch: `walked ${route}`,
    attemptedAt: "2026-08-26",
    result: "nothing came back",
    found: false,
    ...over,
  };
}

/* ============================================================== A — YIELDED */

test("A — a REAL inherited route executed successfully records YIELDED against its OWN id", () => {
  const { dir, path, knowledge } = scratchStore();
  try {
    const routeId = realInheritedRoute(knowledge);
    const before = knowledge.routes.find((r) => r.id === routeId)!;
    assert.equal(before.outcomes.length, 0, "starts with no outcome for any jurisdiction");

    // The ACTUAL seam: a manifest walk, whose branches carry canonical route
    // ids, observed into the canonical store.
    const res = observeManifestWalk(
      knowledge,
      walk([branch(routeId, { found: true, result: "the body's own roster page" })]),
      "nh",
    );
    writeFileSync(path, JSON.stringify(res.knowledge, null, 2), "utf8");

    // Reload from disk — the observation must survive the round trip.
    const reloaded = JSON.parse(readFileSync(path, "utf8")) as MethodKnowledge;
    const after = reloaded.routes.find((r) => r.id === routeId)!;

    assert.equal(after.outcomes.length, 1, "the inherited route received the outcome");
    assert.equal(after.outcomes[0].outcome, "YIELDED");
    assert.equal(after.outcomes[0].jurisdiction, "nh");
    assert.equal(res.recorded[0].routeId, routeId, "recorded under the SAME canonical id");

    // And NO synthetic route absorbed it instead.
    assert.equal(
      reloaded.routes.length,
      knowledge.routes.length,
      "no replacement route was minted for an inherited route that already existed",
    );
    assert.ok(
      !reloaded.routes.some((r) => r.id !== routeId && r.outcomes.length > 0),
      "no other route received this observation",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================================================= B — ZERO */

test("B — the same seam records ZERO against the inherited id, and zero is knowledge", () => {
  const { dir, path, knowledge } = scratchStore();
  try {
    const routeId = realInheritedRoute(knowledge);
    const res = observeManifestWalk(
      knowledge,
      walk([branch(routeId, { found: false, result: "walked the directory, no such office listed" })]),
      "nh",
    );
    writeFileSync(path, JSON.stringify(res.knowledge, null, 2), "utf8");

    const after = (JSON.parse(readFileSync(path, "utf8")) as MethodKnowledge).routes.find(
      (r) => r.id === routeId,
    )!;
    assert.equal(after.outcomes.length, 1);
    assert.equal(after.outcomes[0].outcome, "ZERO", "a walked-and-empty route is ZERO, not FAILED");
    assert.match(after.outcomes[0].note ?? "", /knowledge/i);

    // ZERO does not narrow. The route keeps inheriting everywhere.
    assert.equal(earnedPortability(after).portability, "UNKNOWN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ====================================================== C — FAILED / BLOCKED */

test("C — a wall records BLOCKED and an error records FAILED, and neither narrows", () => {
  const { dir, path, knowledge } = scratchStore();
  try {
    const routeId = realInheritedRoute(knowledge);
    // A wall on the source's side. RULING 12: a WALL, not a JOB failure — and
    // RULING 182: never a measurement of the fact behind it.
    let res = observeManifestWalk(
      knowledge,
      walk([branch(routeId, { result: "HTTP 403 — Cloudflare challenge before any bytes" })]),
      "az",
    );
    assert.equal(res.recorded[0].outcome, "BLOCKED");

    // Our side broke.
    res = observeManifestWalk(
      res.knowledge,
      walk([branch(routeId, { result: "threw: no adapter for this publisher", attemptedAt: "2026-08-27" })], "2026-08-27"),
      "az",
    );
    assert.equal(res.recorded[0].outcome, "FAILED");

    writeFileSync(path, JSON.stringify(res.knowledge, null, 2), "utf8");
    const after = (JSON.parse(readFileSync(path, "utf8")) as MethodKnowledge).routes.find(
      (r) => r.id === routeId,
    )!;
    assert.equal(after.outcomes.length, 2, "both attempts are on the record");

    // Neither narrows the route away from Arizona. A wall and a broken adapter
    // are facts about the ATTEMPT.
    assert.equal(earnedPortability(after).portability, "UNKNOWN");
    assert.deepEqual(applyEarnedPortability({ ...knowledge, routes: [after] }).moved, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C2 — classification puts the wall before the emptiness", () => {
  // The order matters: a branch that hit a wall and returned nothing must not
  // read as "this route measured nothing here".
  assert.equal(classifyBranch(branch("x", { found: true })).outcome, "YIELDED");
  assert.equal(classifyBranch(branch("x", { result: "403 forbidden" })).outcome, "BLOCKED");
  assert.equal(classifyBranch(branch("x", { result: "captcha challenge" })).outcome, "BLOCKED");
  assert.equal(classifyBranch(branch("x", { result: "robots disallows" })).outcome, "BLOCKED");
  assert.equal(classifyBranch(branch("x", { result: "timed out" })).outcome, "BLOCKED");
  assert.equal(classifyBranch(branch("x", { result: "threw an exception" })).outcome, "FAILED");
  assert.equal(classifyBranch(branch("x", { result: "no rows on the page" })).outcome, "ZERO");
});

/* ================================================== D — identity preservation */

test("D — the executed route id and the recorded route id are the same, by construction", () => {
  const { dir, knowledge } = scratchStore();
  try {
    // Every inherited route in the store, one walk, all at once.
    const ids = knowledge.routes.filter((r) => r.origin.includes("branch-manifest")).map((r) => r.id);
    assert.ok(ids.length >= 61, `expected the inherited routes, saw ${ids.length}`);

    const res = observeManifestWalk(knowledge, walk(ids.map((id) => branch(id))), "nj");
    assert.equal(res.recorded.length, ids.length, "every executed route was recorded");

    const recordedIds = res.recorded.map((a) => a.routeId).sort();
    assert.deepEqual(recordedIds, [...ids].sort(), "executed id === recorded id, for every route");

    // And the store gained no routes at all.
    assert.equal(res.knowledge.routes.length, knowledge.routes.length);
    assert.deepEqual(res.unknownRoutes, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("D2 — a branch that names no route is reported, never attached to a plausible one", () => {
  const { dir, knowledge } = scratchStore();
  try {
    const routeId = realInheritedRoute(knowledge);
    const anonymous = { ...branch(routeId), route: undefined } as ManifestBranch;
    const res = observeManifestWalk(knowledge, walk([anonymous]), "nh");
    assert.equal(res.unattributed, 1);
    assert.equal(res.recorded.length, 0, "an unattributed attempt teaches no route anything");
    assert.ok(res.knowledge.routes.every((r) => r.outcomes.length === 0));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("D3 — a route the walk names but knowledge does not hold is reported, not invented", () => {
  const { dir, knowledge } = scratchStore();
  try {
    const res = observeManifestWalk(knowledge, walk([branch("a-method-nobody-recorded")]), "nh");
    assert.deepEqual(res.unknownRoutes, ["a-method-nobody-recorded"]);
    assert.equal(res.recorded.length, 0);
    assert.equal(res.knowledge.routes.length, knowledge.routes.length, "no route is invented");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ========================================================== E — idempotence */

test("E — replaying the same walk does not duplicate evidence or multiply jurisdictions", () => {
  const { dir, knowledge } = scratchStore();
  try {
    const routeId = realInheritedRoute(knowledge);
    const w = walk([branch(routeId, { found: true })]);

    const first = observeManifestWalk(knowledge, w, "nh");
    assert.equal(first.recorded.length, 1);

    const second = observeManifestWalk(first.knowledge, w, "nh");
    assert.equal(second.recorded.length, 0, "the same observation must not be written twice");
    assert.equal(second.duplicates.length, 1);

    const after = second.knowledge.routes.find((r) => r.id === routeId)!;
    assert.equal(after.outcomes.length, 1);

    // And replaying five times cannot make one state look like three.
    let k = second.knowledge;
    for (let i = 0; i < 5; i += 1) k = observeManifestWalk(k, w, "nh").knowledge;
    assert.equal(k.routes.find((r) => r.id === routeId)!.outcomes.length, 1);
    assert.equal(earnedPortability(k.routes.find((r) => r.id === routeId)!).portability, "UNKNOWN");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================================ F — earned portability sees it */

test("F — earned portability sees outcomes written through the REAL seam, not injected ones", () => {
  const { dir, path, knowledge } = scratchStore();
  try {
    const routeId = realInheritedRoute(knowledge);
    let k = knowledge;

    // Three jurisdictions, each through the observation seam. No outcome is
    // hand-inserted anywhere in this test.
    for (const [state, on] of [
      ["nh", "2026-08-26"],
      ["nj", "2026-08-27"],
      ["az", "2026-08-28"],
    ] as const) {
      k = observeManifestWalk(
        k,
        walk([branch(routeId, { found: true, attemptedAt: on, result: "roster found" })], on),
        state,
      ).knowledge;
    }

    const { knowledge: applied, moved } = applyEarnedPortability(k);
    writeFileSync(path, JSON.stringify(applied, null, 2), "utf8");

    const after = (JSON.parse(readFileSync(path, "utf8")) as MethodKnowledge).routes.find(
      (r) => r.id === routeId,
    )!;
    assert.equal(after.outcomes.length, 3);
    assert.equal(after.applicability.portability, "NATIONWIDE");
    assert.deepEqual(after.applicability.states, ["az", "nh", "nj"]);
    assert.ok(moved.some((m) => m.id === routeId && m.from === "UNKNOWN" && m.to === "NATIONWIDE"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F2 — one jurisdiction through the real seam stays UNKNOWN and keeps inheriting", () => {
  const { dir, knowledge } = scratchStore();
  try {
    const routeId = realInheritedRoute(knowledge);
    const res = observeManifestWalk(knowledge, walk([branch(routeId, { found: true })]), "nh");
    const after = res.knowledge.routes.find((r) => r.id === routeId)!;
    assert.equal(after.outcomes.length, 1);
    assert.equal(
      earnedPortability(after).portability,
      "UNKNOWN",
      "one success does not prove it fails elsewhere — it must keep being offered",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================================================ G — reopening */

test("G — mechanical reopening still works after the wiring", () => {
  let k = learnRoute(
    { version: 0, updatedOn: null, routes: [] },
    {
      id: "r1",
      title: "r1",
      tier: "A1",
      fields: ["roster"],
      applicability: unknownApplicability("t"),
      outcomes: [],
      subBranches: [],
      origin: "test",
      learnedOn: "2026-08-26",
    },
    "2026-08-26",
  ).knowledge;

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

  k = learnRoute(
    k,
    {
      id: "r2",
      title: "r2",
      tier: "A1",
      fields: ["roster"],
      applicability: unknownApplicability("t"),
      outcomes: [],
      subBranches: [],
      origin: "test",
      learnedOn: "2026-08-27",
    },
    "2026-08-27",
  ).knowledge;
  assert.equal(findReopenings(k, conclusions).length, 1);
});

/* =============================================== the operational path is wired */

test("the manifest walk — the real executor — observes into the canonical store", () => {
  // A source guard, kept SECONDARY to the behavioural proofs above. It catches
  // the wiring being removed, which the behavioural tests would not notice
  // because they call the library directly.
  const src = readFileSync(join(ROOT, "scripts", "manifest-walk.mts"), "utf8");
  assert.match(src, /observeManifestWalk\(/, "the executor must observe its own walk");
  assert.match(src, /applyEarnedPortability\(/, "and apply what the evidence earns");
  assert.match(src, /knowledge\.json/, "through the canonical method store");
  assert.match(src, /--observe/, "and only when asked, so a dry walk teaches nothing");
});
