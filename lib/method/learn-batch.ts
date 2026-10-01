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
import {
  introducedIssues,
  markAdmitted,
  markRejected,
  markValidated,
  proposeCandidate,
  type CandidateStore,
} from "./candidate.ts";
import { attachClaims, type MethodClaim } from "./claims.ts";
import {
  learnRoute,
  recordRouteOutcome,
  type MethodIssue,
  type MethodKnowledge,
  type MethodRoute,
} from "./knowledge.ts";
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
  /**
   * What this route COST, in kinds rather than in minutes (2026-08-27).
   *
   * Optional, and an absent value means nobody recorded it — which is a
   * different thing from zero, and is what stops a forecast reporting the
   * project as cheaper the less it has measured. See `MethodRoute.effort`.
   *
   * It is carried HERE because the schema had the field and nothing wrote it:
   * a type is not a write path, and declaring one without the other is how a
   * measurement stays permanently unrecorded.
   */
  effort?: MethodRoute["effort"];
  /**
   * **THE ASSERTIONS THIS ROUTE MAKES, CLASSIFIED.** (2026-08-28.)
   *
   * Required by the validator for every route learned after method version 55,
   * so a `learn-*` script that omits it fails `pnpm method:check` rather than
   * landing an unclassified entry in the canonical store. The same
   * additive-fill rule as `effort` applies to an already-known route: a claim
   * id the route does not carry is added, and one it already carries is left
   * exactly as its author wrote it.
   */
  claims?: MethodClaim[];
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
        ...(r.effort ? { effort: r.effort } : {}),
        ...(r.claims ? { claims: r.claims } : {}),
      },
      stamp,
    );
    if (res.duplicate) {
      already += 1;
      log.push(`  already known   ${r.id}`);
      /*
       * **AN ABSENT EFFORT IS FILLED IN; A RECORDED ONE IS NEVER OVERWRITTEN.**
       *
       * The cost fields arrived after 91 routes already existed, so without
       * this the measurement could only ever attach to routes learned in the
       * future — and the ones worth measuring are the ones already walked.
       * Filling an absent value is additive. Replacing a recorded one would be
       * a silent mutation of somebody else's observation, so it does not
       * happen and the run says nothing changed.
       */
      if (r.effort) {
        const idx = k.routes.findIndex((x) => x.id === r.id);
        if (idx >= 0 && !k.routes[idx].effort) {
          const routes = [...k.routes];
          routes[idx] = { ...routes[idx], effort: r.effort };
          k = { ...k, routes };
          log.push(`                  effort recorded for ${r.id} (was unmeasured)`);
        }
      }
      /*
       * Claims arrived after 116 routes existed, so the same additive fill
       * applies: a claim id the route does not carry is added, and one it
       * already carries is never rewritten. A re-run therefore says nothing
       * changed rather than replacing a recorded assertion with a reworded one.
       */
      if (r.claims && r.claims.length > 0) {
        const att = attachClaims(k.routes, r.id, r.claims);
        if (att.added.length > 0) {
          k = { ...k, routes: att.routes };
          log.push(`                  claims attached to ${r.id}: ${att.added.join(", ")}`);
        }
      }
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

/* ------------------------------------------------------- VALIDATION BEFORE ADMISSION */

/**
 * The Attempt id recorded when a route is admitted by a HAND-RUN SCRIPT rather
 * than by a control-plane Attempt.
 *
 * It is a named sentinel, not a fabricated id. Minting `at-<hash>` here would
 * put a value in the audit chain that resolves to nothing and reads exactly like
 * one that resolves to something — the same failure `provenance.artifact` has,
 * one field over. "No Attempt existed" is a fact about us and is written as one.
 */
export const UNATTRIBUTED_SCRIPT_ATTEMPT = "UNATTRIBUTED_SCRIPT_RUN";

export interface AdmissionOutcome {
  /** The prospective store. Identical to the input when admission was refused. */
  readonly knowledge: MethodKnowledge;
  readonly batch: LearnBatchResult;
  readonly candidates: CandidateStore;
  readonly admitted: boolean;
  /** The issues this batch would INTRODUCE. Empty when admitted. */
  readonly introduced: readonly MethodIssue[];
  readonly refusal: string | null;
}

/**
 * Which introduced issues belong to which proposal.
 *
 * The validator reports `id` as a route id, or as a claim id under the
 * `<routeId>#<slug>` convention. Attribution is best-effort BY DESIGN: when
 * nothing matches, the candidate keeps the WHOLE issue set rather than an empty
 * one, because a rejection record that names no reason is the silence this
 * mechanism exists to abolish.
 */
function issuesFor(routeId: string, introduced: readonly MethodIssue[]): readonly MethodIssue[] {
  const mine = introduced.filter((i) => i.id === routeId || i.id.startsWith(`${routeId}#`));
  return mine.length > 0 ? mine : introduced;
}

/**
 * **OFFER, VALIDATE, THEN ADMIT — NEVER ADMIT AND THEN CHECK.**
 *
 * Every route becomes a durable `MethodCandidate` before anything is computed,
 * the prospective store is validated by the canonical validators, and only a
 * batch that introduces no issue reaches the write path.
 *
 * **The batch is atomic.** One store is written once, so a batch that cannot be
 * written whole is not written at all — and every candidate in a refused batch is
 * rejected with the issues, its own where they can be attributed and the whole
 * set where they cannot. Admitting the innocent half would leave the store in a
 * state no script has ever produced and no re-run reproduces.
 */
export function admitLearnedRoutes(
  store: MethodKnowledge,
  candidates: CandidateStore,
  routes: readonly LearnedRoute[],
  options: { stamp: string; attemptId?: string },
): AdmissionOutcome {
  const stamp = options.stamp;
  const attemptId = options.attemptId ?? UNATTRIBUTED_SCRIPT_ATTEMPT;

  let cs = candidates;
  const ids: string[] = [];
  for (const proposal of routes) {
    const p = proposeCandidate(cs, {
      attemptId,
      proposal,
      submittedAt: stamp,
      observedMethodVersion: store.version,
    });
    cs = p.store;
    ids.push(p.candidate.id);
  }

  const batch = learnBatch(store, routes, stamp);
  const { introduced, preExisting } = introducedIssues(store, batch.knowledge);
  const ok = introduced.length === 0;

  for (let i = 0; i < ids.length; i += 1) {
    // A candidate is marked VALIDATED whether or not it PASSED: `VALIDATED`
    // records that the validators ran, and `ok` records what they said. A
    // candidate that skipped straight from PROPOSED to REJECTED would be
    // indistinguishable from one refused before validation could run at all.
    const v = markValidated(cs, ids[i], {
      at: stamp,
      againstMethodVersion: store.version,
      introduced: issuesFor(routes[i].id, introduced),
      preExisting,
      ok,
    });
    cs = v.store;
  }

  if (!ok) {
    for (let i = 0; i < ids.length; i += 1) {
      cs = markRejected(cs, ids[i], {
        at: stamp,
        code: "VALIDATION_FAILED",
        reason:
          `admitting this batch would introduce ${introduced.length} validator issue(s); the store is ` +
          "written once and a batch that cannot be written whole is not written at all",
        issues: issuesFor(routes[i].id, introduced),
      }).store;
    }
    return {
      knowledge: store,
      batch,
      candidates: cs,
      admitted: false,
      introduced,
      refusal:
        `REFUSED — ${introduced.length} validator issue(s) would be INTRODUCED by this batch. ` +
        "Nothing written. Correct first.",
    };
  }

  const known = new Map(batch.knowledge.routes.map((r) => [r.id, r]));
  for (let i = 0; i < ids.length; i += 1) {
    const landed = known.get(routes[i].id);
    cs = markAdmitted(cs, ids[i], {
      at: stamp,
      admittedAs: routes[i].id,
      effect: landed && landed.learnedAtVersion > store.version ? "LEARNED" : "ALREADY_KNOWN",
      methodVersionAfter: batch.knowledge.version,
    }).store;
  }

  return { knowledge: batch.knowledge, batch, candidates: cs, admitted: true, introduced: [], refusal: null };
}
