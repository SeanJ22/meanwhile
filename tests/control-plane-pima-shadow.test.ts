import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { FIRST_PARTY_ROUTES, GRANICUS_LIVE_PROCEEDINGS_ROUTE, type FirstPartyRoute } from "../lib/sources/legistar-insite/horizon.ts";
import type { Jurisdiction } from "../lib/method/portability.ts";
import { computeRouteFloor, describeFloor, materializeFloor, type AdapterRouteDeclaration } from "../lib/control-plane/preflight.ts";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import { evaluateCompletion, type CompletionSnapshot } from "../lib/control-plane/completion.ts";
import { beginAttempt, claim, endAttempt } from "../lib/control-plane/attempt.ts";
import { disposeRoute, type RouteTask } from "../lib/control-plane/route-task.ts";
import { methodFixture } from "./method-store-fixture.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const JURISDICTION: Jurisdiction = { state: "az", governmentType: "county", platform: "legistar", publisher: "example.legistar.com" };

const ADAPTER_ROUTES: readonly AdapterRouteDeclaration[] = FIRST_PARTY_ROUTES.map((routeId) => ({
  routeId,
  label: routeId,
  target: routeId === "GRANICUS_VIEW_PUBLISHER" ? GRANICUS_LIVE_PROCEEDINGS_ROUTE.host : "example.legistar.com",
}));

const MEASURED_FUTURE_COUNTS: Readonly<Partial<Record<FirstPartyRoute, number>>> = {
  LEGISTAR_WEBAPI_EVENTS: 0,
  LEGISTAR_WEBAPI_EVENTDATES: 0,
  INSITE_CALENDAR_GRID: 14,
  INSITE_CALENDAR_RSS: 14,
  CLERK_SCHEDULE_PAGE: 14,
};

function futureMeetingsWorkItem(now: string): WorkItem {
  return createWorkItem({
    project: "meanwhile",
    subject: "ocd-division/country:us/state:az/county:example#governing",
    obligation: "Enumerate every explicit future meeting instance published across materially distinct first-party routes",
    why: "The reader is shown a future meeting universe for this body.",
    priority: "P0",
    contract: { requiresValidation: true, requiresAudit: true, requiresCompleteDenominator: true },
    now,
  });
}
const T0 = "2026-08-28T00:00:00.000Z";
const T1 = "2026-08-28T00:10:00.000Z";
const TTL = 10 * 60 * 1000;

function floorFor() {
  const knowledge = methodFixture();
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
      jurisdiction: JURISDICTION,
      // Narrowing to meetings-bearing fields would be wrong here: the adapter
      // routes are the concrete floor and the method store is additive.
      fields: [],
      adapterRoutes: ADAPTER_ROUTES,
    }),
  };
}

function walk(
  task: RouteTask,
  disposition: Parameters<typeof disposeRoute>[2]["disposition"],
  opts: { artifacts?: string[]; transport?: "REACHABLE" | "CHALLENGED"; permission?: "ALLOWED" | "DISALLOWED"; rows?: number } = {},
): RouteTask {
  // Artifacts are recorded on the Attempt before a disposition cites them.
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
        id: "af-sample",
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
    instrumentGreens: new Set<string>(),
    now: T1,
  };
}

test("the floor is computed from the real method store plus the adapter's declared routes", () => {
  const { knowledge, floor } = floorFor();

  assert.ok(knowledge.version >= 55, `method store version ${knowledge.version} — the store was not read`);
  assert.ok(knowledge.routes.length > 100, "the committed method store was not loaded; the floor would be vacuous");

  for (const routeId of FIRST_PARTY_ROUTES) {
    assert.ok(
      floor.routeIds.includes(routeId),
      `${routeId} is a declared first-party surface and is missing from the inherited floor`,
    );
  }

  assert.ok(
    floor.routes.length >= FIRST_PARTY_ROUTES.length,
    `floor of ${floor.routes.length} is smaller than the adapter's ${FIRST_PARTY_ROUTES.length} routes`,
  );

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

test("SEEDED: walking seven of eight routes and omitting /EventDates cannot close the obligation", () => {
  const { floor } = floorFor();
  const { item, routeTasks } = materializeFloor(futureMeetingsWorkItem(T0), floor, T0);

  assert.equal(item.contract.inheritedRouteFloor.length, floor.routeIds.length);
  assert.equal(routeTasks.length, floor.routeIds.length, "one RouteTask per inherited route");

  const forgotten = "LEGISTAR_WEBAPI_EVENTDATES";
  const walked = routeTasks
    .filter((t) => t.routeId !== forgotten)
    .map((t) => {
      if (t.routeId === "GRANICUS_VIEW_PUBLISHER") {
        return walk(t, "REQUIRES_NEW_ADAPTER", { permission: "DISALLOWED", transport: "REACHABLE" });
      }
      const rows = MEASURED_FUTURE_COUNTS[t.routeId as keyof typeof MEASURED_FUTURE_COUNTS];
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

test("SEEDED: the unbuilt Granicus route keeps the obligation open — its robots.txt reading is evidence, not a finding", () => {
  const { floor } = floorFor();
  const { item, routeTasks } = materializeFloor(futureMeetingsWorkItem(T0), floor, T0);

  const walked = routeTasks.map((t) => {
    if (t.routeId === "GRANICUS_VIEW_PUBLISHER") {
      return walk(t, "REQUIRES_NEW_ADAPTER", { permission: "DISALLOWED", transport: "REACHABLE" });
    }
    const rows = MEASURED_FUTURE_COUNTS[t.routeId as keyof typeof MEASURED_FUTURE_COUNTS];
    return rows && rows > 0 ? walk(t, "INGESTED", { rows }) : walk(t, "WALKED_NO_YIELD", { rows: 0 });
  });

  const verdict = evaluateCompletion(snapshotFor(item, walked, true), "VERIFIED_COMPLETE");

  assert.equal(verdict.mayComplete, false, "a REQUIRES_NEW_ADAPTER route is an open obligation");
  const open = verdict.refusals.filter((r) => r.code === "ROUTE_TASK_STILL_OUTSTANDING");
  assert.ok(open.length >= 1);
  assert.ok(
    open.some((r) => /REQUIRES_NEW_ADAPTER/.test(r.detail)),
    "the refusal must say the route is unbuilt, not that the meetings are absent",
  );

  assert.equal(
    GRANICUS_LIVE_PROCEEDINGS_ROUTE.claimAboutContent,
    null,
    "an unread route carries no claim about what is behind it",
  );
  assert.match(GRANICUS_LIVE_PROCEEDINGS_ROUTE.rule, /Disallow: \//);
  assert.equal(GRANICUS_LIVE_PROCEEDINGS_ROUTE.robotsBlocks, false);
});

test("SEEDED: an incomplete denominator refuses the close even when every route is disposed", () => {
  const { floor } = floorFor();
  const { item, routeTasks } = materializeFloor(futureMeetingsWorkItem(T0), floor, T0);

  const walked = routeTasks.map((t) => {
    const rows = MEASURED_FUTURE_COUNTS[t.routeId as keyof typeof MEASURED_FUTURE_COUNTS];
    return rows && rows > 0 ? walk(t, "INGESTED", { rows }) : walk(t, "WALKED_NO_YIELD", { rows: 0 });
  });

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
