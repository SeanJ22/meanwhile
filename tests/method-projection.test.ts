/**
 * The consumer read path reads the correction: a withdrawn conclusion never reaches a worker's projection, the route
 * it was drawn from still does, a contradicted claim leaves the projection and stays in history, an unclassified
 * legacy entry is inherited as a route with a named gap and its prose is never emitted as an assertion, and the raw
 * applicability primitive has no consumers outside its own layer.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { allClaims, currentTruthFor, type MethodClaim } from "../lib/method/claims.ts";
import {
  emptyKnowledge,
  learnRoute,
  type MethodKnowledge,
} from "../lib/method/knowledge.ts";
import {
  LEGACY_UNCLASSIFIED_GAP,
  inheritedTruthFor,
  legacyUnclassifiedRoutes,
  projectMethodFor,
  projectionHasRoute,
  readNonAuthoritativeProse,
  substantiveAssertions,
} from "../lib/method/projection.ts";
import { testRoute } from "./method-fixtures.ts";
import { METHOD_FIXTURE_PATH } from "./method-store-fixture.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ON = "2026-08-28";
const AZ = { state: "az", governmentType: "county" };

const SCHEDULE = "body-publishes-its-schedule-separately-from-its-agendas";
const RECONCILE = "reconcile-the-adapter-before-suspecting-it";
const UI_VS_API = "vendor-api-and-vendor-web-ui-are-different-records";
const NOT_COMPLETE = "reconciled-is-not-complete";

/** The two withdrawn Pima assertions, by their real ids in the committed store. */
const FALSE_CONCLUSION = `${SCHEDULE}#pima-september-only-as-rule`;
const FALSE_COVERAGE = `${RECONCILE}#pima-window-complete`;
/** The validated coverage claim that corrected the first of them. */
const CURRENT_COVERAGE = `${UI_VS_API}#legistar-events-omits-non-viewable`;
const CURRENT_CONCLUSION = `${UI_VS_API}#pima-september-individually-published`;

function committedStore(): MethodKnowledge {
  return JSON.parse(
    readFileSync(METHOD_FIXTURE_PATH, "utf8"),
  ) as MethodKnowledge;
}

test("the withdrawn Pima conclusion is NOT in a worker's projection, and its route still is", () => {
  const k = committedStore();

  // The claim exists in the store; this control is worthless if the id is wrong.
  assert.ok(
    allClaims(k).some((c) => c.claim.id === FALSE_CONCLUSION),
    `${FALSE_CONCLUSION} must exist in the committed store for this control to mean anything`,
  );
  assert.ok(allClaims(k).some((c) => c.claim.id === FALSE_COVERAGE));

  const p = projectMethodFor(k, AZ);
  const taught = substantiveAssertions(p);

  // Neither false assertion is taught, by id or by text.
  for (const id of [FALSE_CONCLUSION, FALSE_COVERAGE]) {
    assert.ok(
      !taught.some((a) => a.id === id),
      `${id} was withdrawn and must never be handed to a worker as current instruction`,
    );
    const withheld = p.withheld.find((w) => w.id === id);
    assert.ok(withheld, `${id} must be NAMED as withheld, never silently dropped`);
    assert.equal(withheld.reason, "WITHDRAWN");
    assert.ok(withheld.correctedBy, "a withheld assertion names what corrected it");
  }
  assert.equal(
    p.withheld.find((w) => w.id === FALSE_CONCLUSION)!.correctedBy,
    CURRENT_CONCLUSION,
  );

  // The sentence itself is nowhere in the projection's substantive text.
  assert.ok(
    !taught.some((a) => /only as that recurring rule|not individually published/i.test(a.statement)),
    "no inherited assertion may say Pima's September sittings were not individually published",
  );

  // The routes survive: a false conclusion never deletes valid route knowledge.
  for (const id of [SCHEDULE, RECONCILE]) {
    assert.ok(projectionHasRoute(p, id), `${id} is still offered to a worker in Arizona`);
    const projected = p.routes.find((r) => r.identity.id === id)!;
    assert.ok(projected.existence.length > 0, `${id} still asserts that the route exists`);
    assert.ok(projected.observations.length > 0, `${id} still carries its recorded walks`);
  }
});

test("an inherited id is answered with its CURRENT truth, never its withdrawn text", () => {
  const k = committedStore();

  const stale = inheritedTruthFor(k, FALSE_CONCLUSION);
  assert.equal(stale.inheritable, false);
  assert.match(stale.currentStatement ?? "", /individually published all three/);

  const good = inheritedTruthFor(k, CURRENT_COVERAGE);
  assert.equal(good.inheritable, true);
  assert.match(good.currentStatement ?? "", /INCOMPLETE view of a tenant's calendar/);
});

test("a current, validated COVERAGE_CLAIM is inherited", () => {
  const p = projectMethodFor(committedStore(), AZ);
  const taught = substantiveAssertions(p);

  const coverage = taught.find((a) => a.id === CURRENT_COVERAGE);
  assert.ok(coverage, `${CURRENT_COVERAGE} is current, validated and must be inherited`);
  assert.equal(coverage.class, "COVERAGE_CLAIM");
  assert.equal(coverage.classLetter, "C");
  assert.equal(coverage.validation?.state, "VALIDATED");
  assert.ok(coverage.provenance, "an inherited C carries the provenance that earned it");

  // The corrected conclusion travels with it, and so does the lesson revalidated after its basis was withdrawn.
  assert.ok(taught.some((a) => a.id === CURRENT_CONCLUSION));
  assert.ok(
    taught.some((a) => a.id === `${NOT_COMPLETE}#reconciliation-answers-loss-not-sufficiency`),
    "a claim revalidated after its upstream was withdrawn is still inheritable, and says so",
  );

  // Every inherited substantive assertion is evidenced.
  for (const a of taught) {
    assert.ok(a.provenance, `${a.id} is inherited and therefore carries provenance`);
    assert.ok(a.validation, `${a.id} is inherited and therefore states its validation`);
    assert.notEqual(a.validation!.state, "CONTRADICTED");
  }
});

function claim(id: string, over: Partial<MethodClaim> = {}): MethodClaim {
  return {
    id,
    class: "COVERAGE_CLAIM",
    statement: `the assertion carried by ${id}`,
    restsOn: [id.split("#")[0]],
    provenance: {
      artifact: `https://example.gov/${id}`,
      observedVia: id.split("#")[0],
      disposition: "YIELDED",
      jurisdictions: ["az"],
      vendors: [],
      observedOn: ON,
    },
    validation: { state: "VALIDATED", on: ON, by: "a second route" },
    ...over,
  };
}

// Shared with `tests/method-claims.test.ts`; see tests/method-fixtures.ts.
const route = testRoute;

test("a CONTRADICTED claim leaves the current projection and REMAINS in history", () => {
  const contradicted = claim("standing#contradicted", {
    statement: "this window is complete",
    validation: {
      state: "CONTRADICTED",
      on: ON,
      by: "a second independent route",
      note: "the second route returned three rows the first could not see",
    },
  });
  const surviving = claim("standing#validated", { statement: "this route returns less than the calendar holds" });

  let k = emptyKnowledge();
  k = learnRoute(k, route("standing", { claims: [contradicted, surviving] }), ON).knowledge;

  const p = projectMethodFor(k, AZ);
  const taught = substantiveAssertions(p);

  // Gone from what is taught.
  assert.deepEqual(taught.map((a) => a.id), ["standing#validated"]);
  assert.ok(!taught.some((a) => a.statement === "this window is complete"));

  // Still in history with the reason named, though no retraction was filed: contradiction alone stops it teaching.
  const w = p.withheld.find((x) => x.id === "standing#contradicted");
  assert.ok(w, "a contradicted claim is named as withheld, never silently dropped");
  assert.equal(w.reason, "CONTRADICTED");
  assert.equal(w.statementNotCurrent, "this window is complete");
  assert.match(w.why, /a second independent route/);

  // And it is still in the store itself. History explains; history does not override.
  assert.ok(allClaims(k).some((c) => c.claim.id === "standing#contradicted"));
  assert.equal(currentTruthFor(k, "standing#contradicted").status, "CURRENT");

  // The withheld text is not reachable as `.statement` anywhere in the projection.
  const everyStatement = JSON.stringify(p).match(/"statement":"[^"]*"/g) ?? [];
  assert.ok(!everyStatement.some((s) => s.includes("this window is complete")));

  // The route is untouched by its claim being contradicted.
  assert.ok(projectionHasRoute(p, "standing"));
});

test("a substantive claim resting on a withdrawn one is withheld, and the route is not", () => {
  const upstream = claim("r#upstream", {
    retraction: {
      kind: "CORRECTED",
      on: ON,
      why: "a second route returned rows this one could not see",
      supersededBy: null,
      survives: "the route and its measurement, both intact",
    },
  });
  const dependent = claim("r#dependent", { restsOn: ["r#upstream"] });

  let k = emptyKnowledge();
  k = learnRoute(k, route("r", { claims: [upstream, dependent] }), ON).knowledge;

  const p = projectMethodFor(k, AZ);
  assert.deepEqual(substantiveAssertions(p).map((a) => a.id), []);
  assert.deepEqual(
    p.withheld.map((w) => `${w.id} ${w.reason}`).sort(),
    ["r#dependent RESTS_ON_WITHDRAWN", "r#upstream WITHDRAWN"],
  );
  assert.ok(projectionHasRoute(p, "r"), "the route survives every conclusion drawn from it");
});

test("a C or D with no provenance is never inherited, however sincerely it was written", () => {
  const belief: MethodClaim = {
    id: "belief#no-provenance",
    class: "DERIVED_CONCLUSION",
    statement: "this county does not publish its agendas",
    restsOn: ["belief"],
  };
  let k = emptyKnowledge();
  k = learnRoute(k, route("belief", { claims: [belief] }), ON).knowledge;

  const p = projectMethodFor(k, AZ);
  assert.deepEqual(substantiveAssertions(p), []);
  assert.equal(p.withheld[0].reason, "UNEVIDENCED");
  assert.ok(projectionHasRoute(p, "belief"));
});

test("a retired route's substantive claims are history, and the route is not offered", () => {
  let k = emptyKnowledge();
  k = learnRoute(
    k,
    route("gone", {
      claims: [claim("gone#coverage")],
      retiredOn: ON,
      retiredReason: "the publisher removed the endpoint",
    }),
    ON,
  ).knowledge;

  const p = projectMethodFor(k, AZ);
  assert.equal(projectionHasRoute(p, "gone"), false);
  assert.deepEqual(substantiveAssertions(p), []);
  assert.equal(p.withheld[0].reason, "ROUTE_RETIRED");
});

test("an UNCLASSIFIED legacy entry inherits as a ROUTE with a NAMED GAP, never as a conclusion", () => {
  const k = committedStore();
  const p = projectMethodFor(k, AZ);

  const legacy = k.routes.filter(
    (r) => !r.retiredOn && (r.claims ?? []).length === 0 && r.applicability.note.length > 80,
  );
  assert.ok(legacy.length > 50, `the committed store holds ${legacy.length} unclassified entries with real prose`);

  const gaps = new Map(legacyUnclassifiedRoutes(p).map((g) => [g.id, g.namedGap]));
  const taught = substantiveAssertions(p);
  const serialized = JSON.stringify(p);

  for (const r of legacy) {
    // It is still a route.
    assert.ok(projectionHasRoute(p, r.id), `${r.id} is still inherited as a route`);
    const projected = p.routes.find((x) => x.identity.id === r.id)!;

    // The gap is named, as a typed state.
    assert.equal(projected.legacyUnclassified, true);
    assert.equal(projected.namedGap, LEGACY_UNCLASSIFIED_GAP);
    assert.equal(gaps.get(r.id), LEGACY_UNCLASSIFIED_GAP);

    // Its prose is not an assertion.
    assert.deepEqual(projected.substantive, [], `${r.id} declares nothing, so it asserts nothing`);
    assert.ok(
      !taught.some((a) => a.statement === r.applicability.note),
      `${r.id}'s legacy prose must never be emitted as a substantive assertion`,
    );
    assert.ok(
      !serialized.includes(r.applicability.note),
      `${r.id}'s applicability note must not reach a consumer through the projection at all`,
    );
    assert.ok(!serialized.includes(r.origin), `${r.id}'s origin prose must not reach a consumer either`);
  }

  // The prose is reachable only through the accessor whose name is the warning.
  const prose = readNonAuthoritativeProse(k, legacy[0].id)!;
  assert.equal(prose.authoritative, false);
  assert.match(prose.warning, /NOT AUTHORITY/);
  assert.equal(prose.applicabilityNote, legacy[0].applicability.note);
});

test("outcome NOTES never reach a worker — an observation inherits as a tuple", () => {
  const k = committedStore();
  const p = projectMethodFor(k, AZ);
  const serialized = JSON.stringify(p);

  // A coverage claim written into an outcome note carries no claim and no retraction, so outcomes project as tuples.
  const reconcile = k.routes.find((r) => r.id === RECONCILE)!;
  const notes = reconcile.outcomes.map((o) => o.note ?? "").filter((n) => n.length > 0);
  assert.ok(notes.length > 0, "the control needs a real outcome note to be worth running");
  for (const n of notes) {
    assert.ok(!serialized.includes(n), "an outcome note is prose and is not projected");
  }

  // What is projected is the tuple, and all of it.
  const projected = p.routes.find((r) => r.identity.id === RECONCILE)!;
  assert.equal(projected.observations.length, reconcile.outcomes.length);
  for (const o of projected.observations) {
    assert.ok(o.jurisdiction && o.walkedOn && typeof o.rows === "number" && o.disposition);
    assert.ok(!Object.prototype.hasOwnProperty.call(o, "note"));
  }
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

test("the raw applicability primitive has no consumers outside the method layer", () => {
  // Only the projection that wraps `applicableRoutesUnprojected` and its unit tests may call it. A call or an import is
  // required, so a doc block naming the function is not read as the defect.
  const ALLOWED = new Set([
    "lib/method/knowledge.ts",
    "lib/method/projection.ts",
    "tests/method-knowledge.test.ts",
    "tests/method-claims.test.ts",
    "tests/method-projection.test.ts",
  ]);
  const CALL = /applicableRoutesUnprojected\s*[(,]|^\s*applicableRoutesUnprojected,$/m;

  const offenders: string[] = [];
  for (const dir of ["lib", "scripts", "app", "tests"]) {
    const full = join(ROOT, dir);
    try {
      statSync(full);
    } catch {
      continue;
    }
    for (const file of sourceFiles(full)) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (ALLOWED.has(rel)) continue;
      if (CALL.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "method inheritance is consumed through projectMethodFor(); these read raw routes instead",
  );
});
