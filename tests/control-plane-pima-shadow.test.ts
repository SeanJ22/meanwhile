import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadMethodStore } from "../lib/workstate/load.ts";
import { FIRST_PARTY_ROUTES } from "../lib/sources/legistar-insite/horizon.ts";
import {
  PIMA_ADAPTER_ROUTES,
  PIMA_BODY_ID,
  PIMA_GRANICUS_PERMISSION,
  PIMA_JURISDICTION,
  PIMA_MEASURED_FUTURE_COUNTS,
  PIMA_UNION_DENOMINATOR,
  pimaFutureMeetingsWorkItem,
} from "../lib/control-plane/fixtures/pima-meetings.ts";
import { computeRouteFloor, describeFloor, materializeFloor } from "../lib/control-plane/preflight.ts";
import { evaluateCompletion, type CompletionSnapshot } from "../lib/control-plane/completion.ts";
import { beginAttempt, claim, endAttempt } from "../lib/control-plane/attempt.ts";
import { disposeRoute, type RouteTask } from "../lib/control-plane/route-task.ts";

/**
 * THE PIMA SHADOW ATTACHMENT.
 *
 * A real obligation, a real method store read off disk, and the real eight
 * first-party routes the adapter declares — wired to the control plane's
 * completion contract and asked the only question that matters:
 *
 *     can a worker close this obligation while an inherited route has no
 *     disposition?
 *
 * These tests read the COMMITTED method store rather than a fixture. That is
 * deliberate: a preflight proven against a synthetic store proves the test
 * author's idea of the store, and the defect being guarded against is a floor
 * that silently stops matching reality.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T0 = "2026-08-28T00:00:00.000Z";
const T1 = "2026-08-28T00:10:00.000Z";
const TTL = 10 * 60 * 1000;

function floorFor() {
  const knowledge = loadMethodStore(ROOT);
  // A missing store is a FAILED read, never an empty one. Without this the
  // floor would be computed from nothing and every assertion below would pass
  // against a vacuum — the exact shape of a guard that reports clean without
  // having looked (RULING 159).
  if (knowledge === null) {
    throw new Error(
      `The committed method store could not be read from ${ROOT}. This suite proves the ` +
        "inherited floor is computed from real project knowledge; with no store there is nothing " +
        "to prove and a pass would be vacuous.",
    );
  }
  return {
    knowledge,
    floor: computeRouteFloor({
      knowledge,
      jurisdiction: PIMA_JURISDICTION,
      // Narrowing to meetings-bearing fields would be wrong here: the adapter
      // routes are the concrete floor and the method store is additive.
      fields: [],
      adapterRoutes: PIMA_ADAPTER_ROUTES,
    }),
  };
}

/** Walk one route to a completed disposition. */
function walk(
  task: RouteTask,
  disposition: Parameters<typeof disposeRoute>[2]["disposition"],
  opts: { artifacts?: string[]; transport?: "REACHABLE" | "CHALLENGED"; permission?: "ALLOWED" | "DISALLOWED"; rows?: number } = {},
): RouteTask {
  /*
   * THE ARTIFACTS ARE RECORDED ON THE ATTEMPT BEFORE THEY ARE CITED.
   *
   * This helper used to end the Attempt with no artifacts and then hand
   * `disposeRoute` a disposition citing `art-<routeId>` anyway — evidence the
   * Attempt presenting it had never recorded. `disposeRoute` now refuses that
   * by name, and it is right to: it is how Attempt A launders Attempt B's
   * artifact into a public-record conclusion. Hoisting the ids and closing the
   * Attempt with them models the real sequence a worker follows — preserve the
   * bytes, then conclude from them — so the fixture stops depending on a hole.
   */
  const artifactIds = opts.artifacts ?? ["art-" + task.routeId];
  const lease = claim(task.id, `w-${task.routeId}`, T0, TTL, null);
  const attempt = endAttempt(
    beginAttempt({
      routeTaskId: task.id,
      workItemId: task.workItemId,
      worker: { role: "ACQUIRER", provider: "test", version: "v1", instance: `w-${task.routeId}` },
      lease,
      now: T0,
      methodVersion: 55,
      policyVersion: "p1",
    }),
    "COMPLETED",
    T1,
    { artifactIds },
  );
  return disposeRoute(task, attempt, {
    disposition,
    attemptId: attempt.id,
    at: T1,
    artifactIds,
    observation: {
      rawCount: opts.rows ?? 0,
      normalizedCount: opts.rows ?? 0,
      routeOnlyCount: null,
      earliest: null,
      latest: null,
    },
    permission: opts.permission ?? "ALLOWED",
    transport: opts.transport ?? "REACHABLE",
    note: "shadow-mode walk",
  });
}

function snapshotFor(item: Parameters<typeof evaluateCompletion>[0]["item"], tasks: RouteTask[], denominatorComplete: boolean | null): CompletionSnapshot {
  return {
    item,
    routeTasks: tasks,
    validations: [
      { workItemId: item.id, passed: true, at: T1, by: "validator", checked: ["identity", "dates"], detail: "ok" },
    ],
    audits: [
      {
        id: "af-pima",
        workItemId: item.id,
        mode: "SOURCE_UNIVERSE",
        severity: "LOW",
        survived: true,
        startedFrom: ["PUBLISHER_SOURCE_UNIVERSE", "EVIDENCE_VAULT"],
        detail: "independently enumerated the publisher surfaces",
        at: T1,
        resolvedAt: null,
      },
    ],
    contradictions: [],
    upstreamStates: new Map(),
    denominatorComplete,
    /* No instrument-evidence contract here; the empty set is the refusing default. */
    instrumentGreens: new Set<string>(),
    now: T1,
  };
}

/** ------------------------------------------------ the floor is REAL ---- */

test("the Pima floor is computed from the real method store plus the adapter's declared routes", () => {
  const { knowledge, floor } = floorFor();

  assert.ok(knowledge.version >= 55, `method store version ${knowledge.version} — the store was not read`);
  assert.ok(knowledge.routes.length > 100, "the committed method store was not loaded; the floor would be vacuous");

  // Every adapter route is in the floor, by id, and none was dropped.
  for (const routeId of FIRST_PARTY_ROUTES) {
    assert.ok(
      floor.routeIds.includes(routeId),
      `${routeId} is a declared first-party surface and is missing from the inherited floor`,
    );
  }

  // The floor is at least the adapter's eight; the method store may add more.
  assert.ok(
    floor.routes.length >= FIRST_PARTY_ROUTES.length,
    `floor of ${floor.routes.length} is smaller than the adapter's ${FIRST_PARTY_ROUTES.length} routes`,
  );

  // The unclassified population is reported rather than hidden.
  assert.ok(
    floor.legacyUnclassifiedCount >= 0,
    "the legacy-unclassified count must be carried so a small floor is not read as a small store",
  );

  assert.equal(floor.methodVersion, knowledge.version, "the floor pins the method version for replay");
  assert.match(describeFloor(floor), /INHERITED ROUTE FLOOR/);
});

test("adapter-declared routes are never marked speculative, whatever the store's portability says", () => {
  const { floor } = floorFor();
  const adapterIds = new Set<string>(FIRST_PARTY_ROUTES);
  for (const r of floor.routes) {
    if (adapterIds.has(r.routeId)) {
      assert.equal(
        r.speculative,
        false,
        `${r.routeId} is declared for this publisher by the adapter and cannot be a speculative offer`,
      );
      assert.ok(r.origins.includes("ADAPTER_DECLARED"));
    }
  }
});

/** ------------------------- THE PROOF: forgetting a route refuses the close */

test("SEEDED: walking seven of eight routes and omitting /EventDates cannot close MTG-13", () => {
  const { floor } = floorFor();
  const { item, routeTasks } = materializeFloor(pimaFutureMeetingsWorkItem(T0), floor, T0);

  assert.equal(item.contract.inheritedRouteFloor.length, floor.routeIds.length);
  assert.equal(routeTasks.length, floor.routeIds.length, "one RouteTask per inherited route");

  const forgotten = "LEGISTAR_WEBAPI_EVENTDATES";
  const walked = routeTasks
    .filter((t) => t.routeId !== forgotten)
    .map((t) => {
      if (t.routeId === "GRANICUS_VIEW_PUBLISHER") {
        return walk(t, "BLOCKED_CURRENTLY", { permission: "DISALLOWED", transport: "CHALLENGED" });
      }
      const rows = PIMA_MEASURED_FUTURE_COUNTS[t.routeId as keyof typeof PIMA_MEASURED_FUTURE_COUNTS];
      return rows && rows > 0
        ? walk(t, "INGESTED", { rows })
        : walk(t, "WALKED_NO_YIELD", { rows: 0 });
    });

  const verdict = evaluateCompletion(snapshotFor(item, walked, true), "VERIFIED_COMPLETE");

  assert.equal(verdict.mayComplete, false, "seven of eight routes cannot close an eight-route floor");

  const missing = verdict.refusals
    .filter((r) => r.code === "INHERITED_ROUTE_WITHOUT_DISPOSITION")
    .map((r) => r.subject);
  assert.deepEqual(missing, [forgotten], "the refusal must name the forgotten route, not report a count");
});

test("SEEDED: the Granicus wall keeps the obligation open — a permission verdict is not a finding", () => {
  const { floor } = floorFor();
  const { item, routeTasks } = materializeFloor(pimaFutureMeetingsWorkItem(T0), floor, T0);

  // Every route walked, including /EventDates. Granicus is disallowed.
  const walked = routeTasks.map((t) => {
    if (t.routeId === "GRANICUS_VIEW_PUBLISHER") {
      return walk(t, "BLOCKED_CURRENTLY", { permission: "DISALLOWED", transport: "CHALLENGED" });
    }
    const rows = PIMA_MEASURED_FUTURE_COUNTS[t.routeId as keyof typeof PIMA_MEASURED_FUTURE_COUNTS];
    return rows && rows > 0 ? walk(t, "INGESTED", { rows }) : walk(t, "WALKED_NO_YIELD", { rows: 0 });
  });

  const verdict = evaluateCompletion(snapshotFor(item, walked, true), "VERIFIED_COMPLETE");

  assert.equal(verdict.mayComplete, false, "a BLOCKED_CURRENTLY route is an open obligation");
  const blocked = verdict.refusals.filter((r) => r.code === "ROUTE_TASK_STILL_OUTSTANDING");
  assert.ok(blocked.length >= 1);
  assert.ok(
    blocked.some((r) => /BLOCKED_CURRENTLY/.test(r.detail)),
    "the refusal must say the route is blocked, not that the meetings are absent",
  );

  // And the adapter's own record still refuses to say anything about the content.
  assert.equal(
    PIMA_GRANICUS_PERMISSION.claimAboutContent,
    null,
    "a wall carries no claim about what is behind it",
  );
  assert.match(PIMA_GRANICUS_PERMISSION.rule, /Disallow: \//);
});

test("SEEDED: an incomplete denominator refuses the close even when every route is disposed", () => {
  const { floor } = floorFor();
  const { item, routeTasks } = materializeFloor(pimaFutureMeetingsWorkItem(T0), floor, T0);

  const walked = routeTasks.map((t) => {
    const rows = PIMA_MEASURED_FUTURE_COUNTS[t.routeId as keyof typeof PIMA_MEASURED_FUTURE_COUNTS];
    return rows && rows > 0 ? walk(t, "INGESTED", { rows }) : walk(t, "WALKED_NO_YIELD", { rows: 0 });
  });

  // denominatorComplete === null is "never established", and that refuses.
  const unknown = evaluateCompletion(snapshotFor(item, walked, null), "VERIFIED_COMPLETE");
  assert.ok(unknown.refusals.some((r) => r.code === "DENOMINATOR_INCOMPLETE"));
  assert.ok(
    unknown.refusals.some((r) => /measured against\s+our own output/.test(r.detail)),
    "the refusal must name WHY an unestablished denominator is not a denominator",
  );

  const established = evaluateCompletion(snapshotFor(item, walked, true), "VERIFIED_COMPLETE");
  assert.equal(
    established.mayComplete,
    true,
    established.refusals.map((r) => `${r.code}:${r.subject}`).join(", "),
  );
});

/** ------------------------------------------- shadow mode stays shadow --- */

test("the union denominator matches the adapter's independently proven acceptance", () => {
  // This constant is carried, not computed here. If the adapter's acceptance
  // moves, this assertion is the alarm rather than a silent divergence.
  assert.equal(PIMA_UNION_DENOMINATOR, 14);
  assert.equal(
    PIMA_MEASURED_FUTURE_COUNTS.INSITE_CALENDAR_GRID,
    PIMA_UNION_DENOMINATOR,
    "the grid carried the full union",
  );
  assert.equal(PIMA_MEASURED_FUTURE_COUNTS.LEGISTAR_WEBAPI_EVENTS, 0);
  assert.equal(
    PIMA_MEASURED_FUTURE_COUNTS.LEGISTAR_WEBAPI_EVENTDATES,
    0,
    "the forgotten route is precisely the one that returns zero — which is why forgetting it felt safe",
  );
});

test("the fixture binds the REGISTERED body id, never a tenant-minted one (R-0197)", () => {
  assert.equal(PIMA_BODY_ID, "ocd-division/country:us/state:az/county:pima#governing");
  const item = pimaFutureMeetingsWorkItem(T0);
  assert.equal(item.subject, PIMA_BODY_ID);
  assert.equal(item.priority, "P0");
  assert.equal(item.contract.requiresAudit, true);
  assert.equal(item.contract.requiresCompleteDenominator, true);
});
