/**
 * **LEARNING A BATCH OF ROUTES, ONCE.** (RULING 103, extracted 2026-08-27.)
 *
 * Every session that conceives new discovery routes writes a script naming
 * them, and every one of those scripts needs the same body: read the store,
 * offer each route to `learnRoute`, record its outcome whether it was new or
 * already known, write the store back, and report BOTH numbers against the
 * population the run actually offered.
 *
 * The second session to do this — `scripts/learn-85641-routes.mts` — produced
 * a `main` byte-identical to the first, which is precisely the shape RULING 103
 * refuses. So the body lives here and the scripts carry only what is actually
 * theirs: the routes.
 *
 * ## The reporting is the part worth sharing
 *
 * `learned` alone is a trap. "0 learned" and "6 learned" print identically as a
 * headline and mean opposite things: the first says every route this run
 * offered was already project knowledge — which is the correct answer to a
 * RE-RUN and an alarming one on a first run. RULING 159's floor makes the
 * denominator impossible to omit, so this function owns it rather than trusting
 * each caller to remember.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { floored, floorLine } from "../ops/denominator-floor.ts";
import { learnRoute, recordRouteOutcome, type MethodKnowledge } from "./knowledge.ts";
import { unknownApplicability } from "./portability.ts";

/**
 * One route a session conceived, with what it actually returned.
 *
 * `outcome` is required, including when it is `ZERO`. RULING 88: a newly
 * conceived route that returns nothing is a reported success and the invention
 * is the deliverable, so there is no shape here for "learned but never walked".
 */
export interface LearnedRoute {
  id: string;
  title: string;
  tier: "A0" | "A1" | "B" | "C";
  fields: string[];
  /** Why the route is expected to travel — evidence, never a portability claim. */
  note: string;
  /** How it was conceived, so a later session can tell whether it still applies. */
  origin: string;
  outcome: {
    jurisdiction: string;
    rows: number;
    outcome: "YIELDED" | "ZERO" | "FAILED" | "BLOCKED";
    note: string;
  };
}

export interface LearnBatchResult {
  knowledge: MethodKnowledge;
  versionBefore: number;
  learned: number;
  already: number;
  offered: number;
  /** One line per route, in the order offered, for the caller to print. */
  log: string[];
}

/**
 * Offer every route to the store. Idempotent by construction: `learnRoute`
 * refuses a duplicate id and says so, so a re-run cannot inflate the method
 * version or deepen a route's evidence.
 *
 * **Every route enters at `UNKNOWN` portability, always.** RULING 178: a route
 * does not become nationwide by working somewhere, and the `note` is a
 * jurisdictional observation rather than a portability proof. `UNKNOWN` still
 * inherits to every jurisdiction — it simply does not claim.
 */
export function learnBatch(
  store: MethodKnowledge,
  routes: readonly LearnedRoute[],
  stamp: string,
): LearnBatchResult {
  let k = store;
  const versionBefore = k.version;
  let learned = 0;
  let already = 0;
  const log: string[] = [];

  for (const r of routes) {
    const res = learnRoute(
      k,
      {
        id: r.id,
        title: r.title,
        tier: r.tier,
        fields: r.fields,
        applicability: unknownApplicability(r.note),
        outcomes: [],
        subBranches: [],
        origin: r.origin,
        learnedOn: stamp,
      },
      stamp,
    );
    if (res.duplicate) {
      already += 1;
      log.push(`  already known   ${r.id}`);
    } else {
      k = res.knowledge;
      learned += 1;
      log.push(`  LEARNED         ${r.id}  -> method version ${k.version}`);
    }

    /*
     * The outcome is recorded whether or not the route was new. A route this
     * project already knew, walked again somewhere new, is exactly the evidence
     * that earns it a portability class later — dropping it because the id was
     * a duplicate would throw away the only thing that ever promotes a route
     * out of UNKNOWN.
     */
    const out = recordRouteOutcome(k, r.id, {
      jurisdiction: r.outcome.jurisdiction,
      walkedOn: stamp,
      rows: r.outcome.rows,
      outcome: r.outcome.outcome,
      note: r.outcome.note,
    });
    if (out.recorded) k = out.knowledge;
    log.push(`                  ${out.reason}`);
  }

  return { knowledge: k, versionBefore, learned, already, offered: routes.length, log };
}

/**
 * The whole of what a `learn-*-routes` script does: read the store, offer the
 * routes, write it back, and report.
 *
 * This exists because the two callers' `main` bodies were byte-identical and
 * extracting only `learnBatch` left them byte-identical again — RULING 103 is
 * satisfied by removing the duplicate, not by shrinking it. A script that
 * conceives routes should now contain nothing but the routes.
 */
export function runLearnBatch(
  storePath: string,
  routes: readonly LearnedRoute[],
  stamp: string,
): void {
  const store = JSON.parse(readFileSync(storePath, "utf8")) as MethodKnowledge;
  const r = learnBatch(store, routes, stamp);
  for (const line of r.log) console.log(line);

  writeFileSync(storePath, `${JSON.stringify({ ...r.knowledge, updatedOn: stamp }, null, 2)}\n`, "utf8");

  console.log(
    `\nmethod version ${r.versionBefore} -> ${r.knowledge.version}   ` +
      `(${r.learned} learned, ${r.already} already known)`,
  );
  console.log(
    `routes known now: ${r.knowledge.routes.length}  — WHAT THE PROJECT KNOWS NOW, never a cap`,
  );
  console.log(
    `  ${floorLine(
      r.offered > 0
        ? floored(
            "routes new to the project",
            "the routes this session conceived",
            r.offered,
            r.learned,
          )
        : floored(
            "routes new to the project",
            "the routes this session conceived",
            0,
            0,
            "this run offered no routes",
          ),
    )}`,
  );
}
