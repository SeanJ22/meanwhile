/**
 * `pnpm method:prove` — the compounding proof, run as a command.
 *
 * The remediation brief calls this proof LOAD-BEARING, so it exists as
 * something a person can run and read rather than only as an assertion inside
 * the suite. It walks the whole cycle against the REAL committed method store:
 *
 *   a new jurisdiction inherits every applicable route it has never seen
 *     -> it invents one more
 *     -> the route is persisted with a portability class
 *     -> the method version increments
 *     -> the route becomes available to a DIFFERENT applicable jurisdiction
 *     -> an old conclusion that the route would have applied to REOPENS
 *
 * It mutates nothing on disk. The store is loaded, copied, and exercised.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyReopenings,
  findReopenings,
  learnRoute,
  routeCount,
  validateKnowledge,
  type MethodKnowledge,
  type PriorConclusion,
} from "../lib/method/knowledge.ts";
import {
  projectMethodFor,
  projectionHasRoute,
  substantiveAssertions,
} from "../lib/method/projection.ts";
import { unknownApplicability } from "../lib/method/portability.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STORE = join(ROOT, "data", "method", "knowledge.json");
const TODAY = process.env.WTP_TODAY ?? "2026-08-26";

let k = JSON.parse(readFileSync(STORE, "utf8")) as MethodKnowledge;
const startingRoutes = routeCount(k);
const startingVersion = k.version;

// RULING 159 — the floor before any count is reported. A proof that "passes"
// against an empty method store proves nothing at all, and it would print a
// green board while measuring a population of zero. Zero routes here means the
// store failed to load, never a project that knows no routes.
floored(
  "method:prove starting routes",
  "data/method/knowledge.json routes[]",
  startingRoutes,
  k.routes.filter((r) => r.applicability).length,
);

console.log("=".repeat(72));
console.log("THE COMPOUNDING PROOF");
console.log("=".repeat(72));
console.log(`starting method version   ${startingVersion}`);
console.log(`starting route count      ${startingRoutes}`);
console.log("");

// --- 1. a jurisdiction this project has never touched ----------------------
// Louisiana: parishes and police juries, a civil-law vocabulary in which half
// this project's route names mean something else. RULING 60's own example of
// where a New England route will not travel.
const newState = { state: "la", governmentType: "parish" };
/*
 * **READ THROUGH THE PROJECTION, NEVER OFF THE RAW ROUTE.** (2026-08-28.)
 *
 * This block used to call `inheritedRoutes()` and print raw `MethodRoute`
 * objects, which meant the proof's own idea of "what a new state inherits"
 * included four unclassified prose fields — the same fields the withdrawn Pima
 * conclusion is still sitting in. `projectMethodFor` hands over route identity,
 * applicability, observations as tuples, and ONLY the substantive assertions
 * whose retraction and validation state permit inheritance. See
 * `lib/method/projection.ts`.
 */
const projection = projectMethodFor(k, newState);
const inheritedCount = projection.counts.routesInherited;

console.log("1. INHERITANCE — a state with no prior work here");
console.log(`   jurisdiction            ${newState.state} / ${newState.governmentType}`);
console.log(`   routes inherited        ${inheritedCount} of ${startingRoutes}`);
console.log(
  `   of those, speculative   ${projection.counts.routesSpeculative} (UNKNOWN portability — offered, never claimed as proven)`,
);
console.log("   Inheritance is the STARTING advantage of a new state, never its constraint.");
console.log("");
console.log("   WHAT IT INHERITS AS AUTHORITY, by class:");
console.log(`     A  route existence       ${projection.counts.existenceAssertions} declared assertion(s)`);
console.log(
  `     B  observations          ${projection.counts.observations} recorded walk(s), ` +
    `${projection.counts.observationAssertions} declared assertion(s)`,
);
console.log(`     C+D substantive          ${projection.counts.substantiveAssertions} current and inheritable`);
console.log(
  `     WITHHELD                 ${projection.counts.withheld} substantive assertion(s) named and NOT taught`,
);
for (const w of projection.withheld) {
  console.log(`       ${w.reason.padEnd(18)} ${w.id}`);
  console.log(`                          corrected by: ${w.correctedBy ?? "(no successor — see what survives)"}`);
}
console.log(
  `     UNCLASSIFIED LEGACY      ${projection.counts.routesLegacyUnclassified} route(s) known, prose NOT inherited as a conclusion`,
);
console.log("");

// --- 2. a prior conclusion, earned under the CURRENT method version --------
const conclusions: PriorConclusion[] = [
  {
    id: "nh-03255-roster-absence",
    kind: "ABSENCE",
    field: "roster",
    jurisdiction: { state: "nh", governmentType: "town" },
    earnedAtVersion: startingVersion,
    earnedOn: "2026-08-20",
  },
];
console.log("2. A PRIOR CONCLUSION, earned under the method as it stands");
console.log(`   ${conclusions[0].id}: ${conclusions[0].kind} on '${conclusions[0].field}', earned at v${startingVersion}`);
console.log(`   reopenings pending now  ${findReopenings(k, conclusions).length}  (nothing new has been learned yet)`);
console.log("");

// --- 3. invention -----------------------------------------------------------
// A route that did not exist at session start. Under RULING 88 a newly
// conceived route is a reported success whether or not it yields.
const learned = learnRoute(
  k,
  {
    id: "state-bulk-roster-download",
    title: "the body's own bulk roster download, taken before any page-by-page retrieval",
    tier: "A0",
    fields: ["roster"],
    applicability: {
      ...unknownApplicability(
        "conceived against Louisiana police juries; the SHAPE is a body publishing a bulk file, " +
          "which is not a Louisiana fact — but it is unproven anywhere else, so portability stays UNKNOWN",
      ),
      portability: "UNKNOWN",
    },
    outcomes: [],
    subBranches: [],
    origin: "pnpm method:prove — the compounding proof",
    learnedOn: TODAY,
    /*
     * **AND IT DECLARES WHAT IT ASSERTS.** (2026-08-28.)
     *
     * Claim classes became required for any route entering after v55, and this
     * proof invents a route at v56 every time it runs — so from the moment that
     * rule landed, `pnpm method:prove` has been reporting COMPOUNDING PROOF
     * FAILED on its own invented route, with one validator issue nobody was
     * looking at because the command is not in `pnpm gates`.
     *
     * The right repair is the one the rule asks for rather than an exemption:
     * the route declares its class. It is a class A ROUTE_EXISTENCE assertion —
     * the only thing a route conceived and never walked can honestly claim —
     * and it needs no provenance for exactly that reason. A route that has not
     * been walked has no outcome, no coverage claim and no conclusion, and the
     * proof now demonstrates that shape instead of tripping over it.
     */
    claims: [
      {
        id: "state-bulk-roster-download#route-exists",
        class: "ROUTE_EXISTENCE",
        statement:
          "A body's own bulk roster download, taken before any page-by-page retrieval, is an available route wherever a body publishes one.",
        restsOn: [],
      },
    ],
  },
  TODAY,
);
k = learned.knowledge;

console.log("3. INVENTION — the new state teaches the project a method");
console.log(`   route learned           ${"state-bulk-roster-download"}`);
console.log(`   duplicate of an existing route?  ${learned.duplicate ? "YES — a RULING 63 defect" : "no"}`);
console.log(`   route count             ${startingRoutes} -> ${routeCount(k)}`);
console.log(`   method version          ${startingVersion} -> ${k.version}`);
console.log("   NO CAP WAS CONSULTED. There is no maximum to consult.");
console.log("");

// --- 4. the route reaches a DIFFERENT jurisdiction --------------------------
const otherState = { state: "nh", governmentType: "town" };
const otherProjection = projectMethodFor(k, otherState);
const reachesOther = projectionHasRoute(otherProjection, "state-bulk-roster-download");

console.log("4. REAPPLICATION — the new route reaches somewhere it was not invented");
console.log(`   jurisdiction            ${otherState.state} / ${otherState.governmentType}`);
console.log(`   route available there?  ${reachesOther ? "YES" : "NO"}`);
console.log(`   routes inherited        ${otherProjection.counts.routesInherited}`);
console.log(
  `   substantive inherited   ${substantiveAssertions(otherProjection).length}  ` +
    `(${otherProjection.withheld.length} withheld and named)`,
);
console.log("");

// --- 5. the old conclusion reopens, mechanically ----------------------------
const reopenings = findReopenings(k, conclusions);
const after = applyReopenings(conclusions, reopenings, TODAY);

console.log("5. REOPENING — new knowledge invalidates an old conclusion");
console.log(`   reopenings found        ${reopenings.length}`);
for (const r of reopenings) {
  console.log(`   - ${r.conclusion.id}`);
  console.log(`     ${r.why}`);
}
console.log(`   old measurement kept?   earnedAtVersion=${after[0].earnedAtVersion}, earnedOn=${after[0].earnedOn}`);
console.log(`   now reopened by         ${after[0].reopenedBy ?? "(nothing)"} on ${after[0].reopenedOn ?? "-"}`);
console.log("   Nobody had to REMEMBER to go back. The state said so.");
console.log("");

// --- 6. and the validator agrees -------------------------------------------
const issues = validateKnowledge(k, after);
console.log("6. VALIDATION");
console.log(`   issues after reopening  ${issues.length}`);
for (const i of issues) console.log(`   - ${i.id} ${i.rule}: ${i.detail}`);

// A conclusion left CLOSED while applicable knowledge exists must fail.
const notReopened = validateKnowledge(k, conclusions);
console.log(`   issues if NOT reopened  ${notReopened.length}  <- silence here would be the failure RULING 178 names`);
console.log("");

/*
 * **AND NOTHING WITHDRAWN IS BEING TAUGHT.** (2026-08-28.)
 *
 * The proof asserted compounding and never asserted correctness of what
 * compounds. A projection that inherited a retracted, contradicted or
 * unevidenced coverage claim would print every number above unchanged, which is
 * exactly how the Pima conclusion survived its own correction for a day.
 */
const taughtWithdrawn = substantiveAssertions(projection).filter(
  (a) => a.validation?.state === "CONTRADICTED",
);
console.log("7. INHERITANCE INTEGRITY");
console.log(`   substantive inherited   ${substantiveAssertions(projection).length}`);
console.log(`   withdrawn or contradicted still taught  ${taughtWithdrawn.length}  <- must be 0`);
for (const a of taughtWithdrawn) console.log(`   - ${a.id}`);
console.log("");

const ok =
  inheritedCount === startingRoutes &&
  taughtWithdrawn.length === 0 &&
  routeCount(k) === startingRoutes + 1 &&
  k.version === startingVersion + 1 &&
  reachesOther &&
  reopenings.length === 1 &&
  issues.length === 0 &&
  notReopened.length > 0;

console.log(ok ? "COMPOUNDING PROOF PASSED" : "COMPOUNDING PROOF FAILED");
console.log("");
console.log(`The project knows ${routeCount(k)} routes at the end of this run.`);
console.log("That is WHAT THE PROJECT KNOWS NOW. It is never a statement about how many exist.");
console.log("(Nothing was written to disk; the committed store is unchanged.)");

if (!ok) process.exit(1);
