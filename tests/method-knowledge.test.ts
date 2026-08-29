import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  applyReopenings,
  emptyKnowledge,
  findReopenings,
  applicableRoutesUnprojected,
  learnRoute,
  routeCount,
  validateKnowledge,
  type MethodKnowledge,
  type MethodRoute,
  type PriorConclusion,
} from "../lib/method/knowledge.ts";
import { appliesTo, overGeneralized, unknownApplicability } from "../lib/method/portability.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function route(id: string, over: Partial<MethodRoute> = {}): Omit<MethodRoute, "learnedAtVersion"> {
  return {
    id,
    title: id,
    tier: "A1",
    fields: ["roster"],
    applicability: unknownApplicability("test route"),
    outcomes: [],
    subBranches: [],
    origin: "test",
    learnedOn: "2026-08-26",
    ...over,
  };
}

/** Build a store of N routes without touching any constant. */
function storeOf(n: number): MethodKnowledge {
  let k = emptyKnowledge();
  for (let i = 0; i < n; i += 1) k = learnRoute(k, route(`r${i}`), "2026-08-26").knowledge;
  return k;
}

/* ------------------------------------------------------------------ THE COMPOUNDING TEST */

test("THE COMPOUNDING TEST — a 44th state inherits 76 methods and adds a 77th, with no cap to change", () => {
  // Start from a store the size the brief describes. Nothing in the library
  // knows or cares what 76 is.
  let k = storeOf(76);
  assert.equal(routeCount(k), 76);
  assert.equal(k.version, 76);

  // The new jurisdiction INHERITS everything applicable. Inheritance is the
  // starting advantage of a new state, never its constraint (RULING 178).
  const stateForty4 = { state: "la", governmentType: "parish" };
  const inherited = applicableRoutesUnprojected(k, stateForty4);
  assert.equal(inherited.length, 76, "every applicable route is offered to a new jurisdiction");
  assert.ok(
    inherited.every((i) => i.speculative),
    "UNKNOWN portability inherits but is MARKED — a report may not claim it was known to fit",
  );

  // ...and it remains able to INVENT. Neither disables the other.
  const learned = learnRoute(
    k,
    route("la-police-jury-minutes", {
      applicability: {
        ...unknownApplicability("Louisiana police juries publish minutes as PDFs"),
        portability: "STATE_SPECIFIC",
        states: ["la"],
      },
    }),
    "2026-08-26",
  );
  k = learned.knowledge;
  assert.equal(routeCount(k), 77, "the 77th route exists");
  assert.equal(learned.version, 77, "the method version incremented");

  // And again, and again. There is no maximum.
  for (let i = 0; i < 14; i += 1) k = learnRoute(k, route(`extra-${i}`), "2026-08-26").knowledge;
  assert.equal(routeCount(k), 91);
  k = learnRoute(k, route("ninety-second"), "2026-08-26").knowledge;
  assert.equal(routeCount(k), 92);
});

test("no route-count cap exists anywhere in the method library", () => {
  // A cap would freeze the manifest, which RULING 178 and the non-final-
  // manifest test both forbid. This looks for one rather than trusting that
  // nobody added it.
  for (const f of ["lib/method/knowledge.ts", "lib/method/portability.ts"]) {
    // Comments are STRIPPED before the sweep. `knowledge.ts` explains at length
    // that no cap exists and names the constant it is refusing to define, so a
    // raw text search finds the explanation and calls it the defect. A guard
    // that fires on its own documentation is a guard somebody weakens.
    const src = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const caps = src.match(/\b(MAX_ROUTES|ROUTE_LIMIT|MAX_METHODS)\b|routes\.length\s*[<>]=?\s*\d+/g);
    assert.equal(caps, null, `${f} must contain no route cap, found: ${caps?.join(", ")}`);
  }
});

/* ------------------------------------------------------- THE NON-FINAL-MANIFEST TEST */

test("THE NON-FINAL-MANIFEST TEST — nothing represents the route list as exhaustive", () => {
  const src = readFileSync(join(ROOT, "lib/method/knowledge.ts"), "utf8");
  assert.match(src, /never a finished list|what the project knows now|no maximum/i);
  // The store has no `complete` or `final` flag to set.
  const k = storeOf(3) as unknown as Record<string, unknown>;
  assert.ok(!("complete" in k) && !("final" in k) && !("exhaustive" in k));
});

/* ------------------------------------------------- THE INHERIT-AND-INVENT TEST */

test("THE INHERIT-AND-INVENT TEST — neither inheritance nor invention disables the other", () => {
  let k = storeOf(5);
  const j = { state: "az", governmentType: "county" };
  const before = applicableRoutesUnprojected(k, j).length;
  assert.equal(before, 5);

  k = learnRoute(k, route("az-bulk-ftp", {
    applicability: { ...unknownApplicability("azsos FTP"), portability: "STATE_SPECIFIC", states: ["az"] },
  }), "2026-08-26").knowledge;

  assert.equal(applicableRoutesUnprojected(k, j).length, before + 1, "the invented route joins the inherited set");
  // ...and it does NOT leak to a state it was not proven in.
  assert.equal(applicableRoutesUnprojected(k, { state: "nh" }).length, before);
});

/* ------------------------------------------------------ THE VERSIONED-CONVERGENCE TEST */

test("THE VERSIONED-CONVERGENCE TEST — a new applicable route reopens an old absence", () => {
  let k = storeOf(3);
  const conclusions: PriorConclusion[] = [
    {
      id: "absence-1",
      kind: "ABSENCE",
      field: "roster",
      jurisdiction: { state: "nh" },
      earnedAtVersion: k.version, // earned under v3
      earnedOn: "2026-08-20",
    },
  ];

  // Nothing new has been learned, so nothing reopens.
  assert.equal(findReopenings(k, conclusions).length, 0);

  // A route learned AFTER the conclusion, applicable to the same field, reopens it.
  k = learnRoute(k, route("nh-gencourt-bulk", { fields: ["roster"] }), "2026-08-26").knowledge;
  const reopenings = findReopenings(k, conclusions);
  assert.equal(reopenings.length, 1, "the new route reopens the prior absence MECHANICALLY");
  assert.equal(reopenings[0].route.id, "nh-gencourt-bulk");
  assert.match(reopenings[0].why, /entered project knowledge at v4, after this ABSENCE was earned at v3/);

  // The old measurement is PRESERVED — reopening adds a fact, never erases one.
  const applied = applyReopenings(conclusions, reopenings, "2026-08-26");
  assert.equal(applied[0].earnedAtVersion, 3);
  assert.equal(applied[0].earnedOn, "2026-08-20");
  assert.equal(applied[0].reopenedBy, "nh-gencourt-bulk");

  // Once reopened it does not re-fire forever.
  assert.equal(findReopenings(k, applied).length, 0);
});

test("a route learned BEFORE a conclusion does not reopen it", () => {
  // Otherwise every conclusion is permanently unstable: an earlier route was
  // available when the conclusion was made, so it was either walked or
  // deliberately not.
  const k = storeOf(5);
  const conclusions: PriorConclusion[] = [
    {
      id: "a",
      kind: "ABSENCE",
      field: "roster",
      jurisdiction: { state: "nh" },
      earnedAtVersion: 5,
      earnedOn: "2026-08-26",
    },
  ];
  assert.equal(findReopenings(k, conclusions).length, 0);
});

test("a conclusion with no method version is refused — it could never be reopened", () => {
  const k = storeOf(2);
  const bad = [{ id: "x", kind: "ABSENCE", field: "roster", jurisdiction: { state: "nh" }, earnedOn: "2026-08-26" }] as unknown as PriorConclusion[];
  assert.ok(validateKnowledge(k, bad).some((i) => i.rule === "conclusion-without-version"));
});

test("PLANTED: an OUTCOME value off the closed set FAILS the validator", () => {
  /*
   * **THE SAME HOLE, ONE FIELD OVER, FOUND THE SAME WAY.** (2026-08-28.)
   *
   * The `effort` repair closed a closed set nothing checked. `outcome.outcome`
   * had the identical hole: this session wrote three routes carrying
   * `WORKED` — not a member of the set — every one landed in the canonical
   * store, and `method:check` reported PASSED. `tsc` caught it afterwards for
   * an unrelated reason, which is exactly the sequence the `effort` note
   * already records. Fixing one instance of a class and leaving the class open
   * is how the same defect gets found twice.
   *
   * It is not cosmetic. `YIELDED` is what `provenStates` filters on and what
   * `overGeneralized` reasons from, so an unrecognised outcome silently removes
   * a route's evidence from the guard that stops a route claiming a portability
   * it never earned — and the route then passes that guard by having no
   * evidence rather than by having good evidence.
   */
  const store = learnRoute(
    storeOf(1),
    route("bad-outcome", {
      outcomes: [
        {
          jurisdiction: "az",
          walkedOn: "2026-08-28",
          rows: 30,
          outcome: "WORKED" as unknown as "YIELDED",
          note: "the exact value that was written into the canonical store",
        },
      ],
    }),
    "2026-08-28",
  ).knowledge;

  const issues = validateKnowledge(store, []);
  const hit = issues.find((i) => i.rule === "outcome-value-off-the-closed-set");
  assert.ok(hit, "an outcome outside the closed set must be refused");
  assert.match(hit!.detail, /WORKED/);

  /* CONTROL: the same route with a valid outcome passes, so this measures the
     enum rather than the presence of an outcome at all. */
  const good = learnRoute(
    storeOf(1),
    route("good-outcome", {
      outcomes: [
        { jurisdiction: "az", walkedOn: "2026-08-28", rows: 30, outcome: "YIELDED", note: "" },
      ],
    }),
    "2026-08-28",
  ).knowledge;
  assert.equal(
    validateKnowledge(good, []).filter((i) => i.rule === "outcome-value-off-the-closed-set").length,
    0,
  );
});

test("PLANTED: an effort value off the closed set FAILS the validator", () => {
  /*
   * **THE GUARD THAT WAS GREEN BECAUSE IT NEVER LOOKED.**
   * (Repaired in PR #212; given a test 2026-08-28.)
   *
   * `effort` has had a closed set of values on all three of its fields since it
   * was declared, and for a while nothing checked them. A session wrote four
   * routes carrying `PER_SOURCE`, `AUTOMATED` and `KNOWN_METHOD` — none of
   * which is a member of any of the three sets — and every one of them landed
   * in the canonical store while `method:check` reported PASSED. `tsc` caught
   * it, minutes later and for an unrelated reason.
   *
   * The repair shipped without a test, which is the same shape one rung up: a
   * validator nobody proves is a validator that can quietly stop validating.
   * This asserts the failure DIRECTLY, on a value that is invalid in each of
   * the three fields, one field at a time — so a set that loses a member is
   * caught, and so is a check that stops running.
   *
   * The forecast is what depends on it: it buckets on `repeats`, and an
   * unrecognised value drops a route out of whichever bucket a reader is
   * counting, reporting the project as cheaper than it is.
   */
  const base = storeOf(1);

  for (const field of ["repeats", "execution", "discovery"] as const) {
    const valid: MethodRoute["effort"] = {
      repeats: "PER_COUNTY",
      execution: "MACHINE",
      discovery: "NEW_METHOD",
      note: "test",
    };
    /* One field at a time, so a passing run cannot be one set doing all the
       work while another has quietly stopped being checked. */
    const broken = { ...valid, [field]: "NOT_A_REAL_VALUE" } as MethodRoute["effort"];
    const withBad = learnRoute(
      base,
      route(`bad-${field}`, { effort: broken }),
      "2026-08-28",
    ).knowledge;

    const issues = validateKnowledge(withBad, []);
    const hit = issues.find((i) => i.rule === "effort-value-off-the-closed-set");
    assert.ok(hit, `effort.${field} = NOT_A_REAL_VALUE must be refused by the validator`);
    assert.match(hit!.detail, new RegExp(`effort\\.${field}`));
  }

  /* CONTROL: the same route with every value ON the set passes, so the test
     above is measuring the enum rather than the presence of `effort` at all. */
  const good = learnRoute(
    base,
    route("good-effort", {
      effort: {
        repeats: "PER_COUNTY",
        execution: "MACHINE",
        discovery: "NEW_METHOD",
        note: "test",
      },
    }),
    "2026-08-28",
  ).knowledge;
  assert.equal(
    validateKnowledge(good, []).filter((i) => i.rule === "effort-value-off-the-closed-set").length,
    0,
  );
});

test("knowledge that has outgrown a still-closed conclusion is a validation failure", () => {
  let k = storeOf(2);
  const conclusions: PriorConclusion[] = [
    { id: "a", kind: "CONVERGED", field: "roster", jurisdiction: { state: "nh" }, earnedAtVersion: 2, earnedOn: "2026-08-20" },
  ];
  k = learnRoute(k, route("new-one", { fields: ["roster"] }), "2026-08-26").knowledge;
  assert.ok(
    validateKnowledge(k, conclusions).some((i) => i.rule === "unreopened-conclusion"),
    "silence here is the failure RULING 178 names",
  );
});

/* ------------------------------------------------------------------- portability */

test("a route is never generalized farther than its evidence supports", () => {
  const nationwideOnOneState = { ...unknownApplicability(), portability: "NATIONWIDE" as const };
  assert.ok(overGeneralized(nationwideOnOneState, ["nh"]), "NATIONWIDE on one state must be refused");
  assert.equal(overGeneralized(nationwideOnOneState, ["nh", "nj", "az"]), null);

  const stateless = { ...unknownApplicability(), portability: "STATE_SPECIFIC" as const, states: [] };
  assert.ok(overGeneralized(stateless, ["nh"]), "STATE_SPECIFIC naming no state must be refused");
});

test("UNKNOWN portability is a VALID state and still inherits", () => {
  const v = appliesTo(unknownApplicability(), { state: "ak", governmentType: "borough" });
  assert.equal(v.applies, true, "an unknown route is offered, never withheld");
  assert.equal(v.speculative, true, "and it is marked, so no report may claim it was proven");
});

test("a route proven in one shape does not silently travel to another", () => {
  // RULING 60: the route that reaches a Newbury board will not reach a borough
  // in Alaska, an unincorporated county in Arizona, or a parish in Louisiana.
  const newEngland = {
    ...unknownApplicability("New England town meeting"),
    portability: "GOVERNMENT_TYPE" as const,
    governmentTypes: ["town"],
  };
  assert.equal(appliesTo(newEngland, { state: "la", governmentType: "parish" }).applies, false);
  assert.equal(appliesTo(newEngland, { state: "ak", governmentType: "borough" }).applies, false);
  assert.equal(appliesTo(newEngland, { state: "nh", governmentType: "town" }).applies, true);
});

test("a failed inherited route grows a sub-branch and is never deleted", () => {
  let k = emptyKnowledge();
  k = learnRoute(
    k,
    route("clerk-pdf", {
      subBranches: [
        { jurisdiction: "la", failedOn: "2026-08-26", reason: "parishes have no town clerk", replacedBy: "la-police-jury-minutes" },
      ],
    }),
    "2026-08-26",
  ).knowledge;
  assert.equal(k.routes[0].subBranches.length, 1);
  assert.equal(validateKnowledge(k).length, 0);

  // An undated sub-branch loses the fact the next state needs.
  const undated = structuredClone(k);
  undated.routes[0].subBranches[0].failedOn = "";
  assert.ok(validateKnowledge(undated).some((i) => i.rule === "subbranch-undated"));
});

test("a duplicate route is reported as the defect RULING 63 names", () => {
  let k = emptyKnowledge();
  k = learnRoute(k, route("dupe"), "2026-08-26").knowledge;
  const again = learnRoute(k, route("dupe"), "2026-08-26");
  assert.ok(again.duplicate, "building a branch that already exists is a reported defect");
  assert.equal(routeCount(again.knowledge), 1, "and it does not silently double the store");
});

/* ------------------------------------------------------------ the committed store */

test("the committed method store validates and preserves the legacy manifest", () => {
  const p = join(ROOT, "data", "method", "knowledge.json");
  if (!existsSync(p)) return;
  const k = JSON.parse(readFileSync(p, "utf8")) as MethodKnowledge;
  assert.deepEqual(validateKnowledge(k).map((i) => `${i.id} ${i.rule}`), []);
  assert.ok(k.routes.length >= 61, "no route may vanish from project knowledge");
  assert.ok(
    k.routes.every((r) => r.applicability),
    "every persisted route carries applicability state",
  );
});
