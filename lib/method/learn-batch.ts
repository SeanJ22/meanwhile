/**
 * Learn a batch of routes once: offer each to the store, record its outcome whether new or already known, and report
 * both numbers against the population offered, since "0 learned" alone reads the same on a re-run and a first run.
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

/** One route with what it returned. `outcome` is required, including `ZERO`. */
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
  /** What this route cost, in kinds rather than minutes. Absent means nobody recorded it, not zero. */
  effort?: MethodRoute["effort"];
  /** The route's classified assertions; required for routes learned after the claim-class floor. */
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

/** Offer every route to the store; a duplicate id is refused, so a re-run cannot inflate the version. Every route enters at `UNKNOWN` portability. */
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
      // An absent effort is filled in; a recorded one is never overwritten.
      if (r.effort) {
        const idx = k.routes.findIndex((x) => x.id === r.id);
        if (idx >= 0 && !k.routes[idx].effort) {
          const routes = [...k.routes];
          routes[idx] = { ...routes[idx], effort: r.effort };
          k = { ...k, routes };
          log.push(`                  effort recorded for ${r.id} (was unmeasured)`);
        }
      }
      // The same additive fill for claims: a claim id already on the route is never rewritten.
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

    // The outcome is recorded whether or not the route was new: it is the evidence that later earns a portability class.
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

/** The Attempt id for a route admitted by a hand-run script: a named sentinel, never a fabricated id. */
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

/** Which introduced issues belong to which proposal; with no match, a candidate keeps the whole issue set. */
function issuesFor(routeId: string, introduced: readonly MethodIssue[]): readonly MethodIssue[] {
  const mine = introduced.filter((i) => i.id === routeId || i.id.startsWith(`${routeId}#`));
  return mine.length > 0 ? mine : introduced;
}

/**
 * Offer, validate, then admit. The batch is atomic: a batch that cannot be written whole is not written, and every
 * candidate in it is rejected with its issues.
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
    // VALIDATED records that the validators ran; `ok` records what they said.
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
