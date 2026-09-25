/**
 * Observing a manifest walk into canonical method knowledge.
 *
 * ## The gap this closes
 *
 * The method store shipped with `recordRouteOutcome`, `earnedPortability` and
 * `applyEarnedPortability`, and `scripts/descent.mts` called them — but only for
 * routes it MINTED, with ids shaped `descent-tier-<tier>`. The 61 INHERITED
 * routes that came from `lib/hunt/branch-manifest.ts` — `host-inversion`,
 * `tier-above-directory-inversion`, `party-county-directory` and the rest —
 * still had `outcomes: []` and could have stayed `UNKNOWN` forever.
 *
 * So the previous report's "route outcomes actually written by operational
 * path: yes" was true about newly invented routes and false about every route
 * the project already knew. A synthetic id receiving the observation is the
 * same defect as no observation at all: the route that was actually walked
 * learns nothing.
 *
 * ## Why identity cannot be substituted here
 *
 * The route id is READ OFF THE WALK. `ManifestBranch.route` already carries the
 * canonical id through execution — `judgeManifestWalk` uses exactly that field
 * to decide which routes were walked — so this module never constructs an id,
 * never maps one, and never falls back to a generated name. If a branch does
 * not name its route, the walk did not record which method it used, and that is
 * reported as an unattributed attempt rather than silently attached to
 * something plausible.
 */

import type { ManifestBranch, ManifestWalk } from "../hunt/branch-manifest.ts";
import {
  recordRouteOutcome,
  type MethodKnowledge,
  type RouteOutcome,
} from "./knowledge.ts";

export interface ObservedAttempt {
  /** The CANONICAL route id, taken from the branch. Never synthesized. */
  routeId: string;
  outcome: RouteOutcome["outcome"];
  rows: number;
  note: string;
}

/**
 * Words a branch uses when the wall is on the other side.
 *
 * A walled, challenged, timed-out or credential-blocked branch is `BLOCKED`,
 * and `BLOCKED` never narrows applicability — RULING 182 and RULING 184 both
 * turn on that. Reading these as ZERO would convert a wall into a measurement
 * of the government behind it, which is the collapse this project names first.
 *
 * A robots.txt line is not one of them (owner decision 2026-09-25: "Robots.txt
 * alone must not block acquisition"). "permission" alone meant the robots
 * verdict in these results, so only an access-control "permission denied"
 * stays here.
 */
const BLOCKED_SHAPES =
  /\b(403|401|429|captcha|challenge|cloudflare|blocked|wall(ed)?|forbidden|permission denied|credential|paywall|login|sign[- ]in|tls|timed? ?out|timeout)\b/i;

/**
 * A branch that stopped on robots.txt alone. That was never a measurement of the
 * fact (so never ZERO) and is no longer the source's wall (so never BLOCKED): no
 * fetcher stops on robots.txt since the owner decision of 2026-09-25, so a branch
 * that did stopped on OUR side, and is walked again. A result that merely reports
 * the robots verdict beside a real answer ("robots.txt allows; no rows") is not this.
 */
const ROBOTS_STOP_SHAPES =
  /\bdisallow|\b(robots(\.txt)?|permission)\b[^.;]*\b(refus\w*|den(y|ied|ies)|not requested|no request|skipp\w*|cannot[_ ]tell)\b/i;

/** Words a branch uses when OUR side broke. RULING 12: a JOB failure. */
const FAILED_SHAPES =
  /\b(error|exception|threw|crash|unparse|malformed|no adapter|not implemented|500|502|503|504)\b/i;

/**
 * Classify one branch into an outcome.
 *
 * The order matters and is deliberate: FOUND first, then the two
 * not-our-answer-to-give classes, and only then ZERO. A branch that hit a wall
 * and returned nothing must not read as "this route measured nothing here" —
 * it measured nothing about the FACT and something quite specific about the
 * wall.
 */
export function classifyBranch(b: ManifestBranch): { outcome: RouteOutcome["outcome"]; why: string } {
  if (b.found) return { outcome: "YIELDED", why: "the branch produced the fact" };
  const text = `${b.result} ${b.branch}`;
  if (BLOCKED_SHAPES.test(text)) {
    return { outcome: "BLOCKED", why: "a wall on the source's side — never a measurement of the fact" };
  }
  if (ROBOTS_STOP_SHAPES.test(text)) {
    return {
      outcome: "FAILED",
      why: "stopped on robots.txt alone, which never blocks a read (owner decision 2026-09-25): our side, walked again — never a measurement of the fact",
    };
  }
  if (FAILED_SHAPES.test(text)) {
    return { outcome: "FAILED", why: "the attempt failed on our side (RULING 12: a JOB failure)" };
  }
  return {
    outcome: "ZERO",
    why: "walked and returned nothing — a measurement, and knowledge (RULING 88)",
  };
}

export interface ObservationResult {
  knowledge: MethodKnowledge;
  /** Attempts written, by canonical route id. */
  recorded: ObservedAttempt[];
  /** Attempts already on the record for this jurisdiction and date. */
  duplicates: ObservedAttempt[];
  /**
   * Branches that named NO route. Reported, never guessed at — a walk that did
   * not say which method it used cannot teach that method anything.
   */
  unattributed: number;
  /** Route ids the walk named that project knowledge does not hold. */
  unknownRoutes: string[];
}

/**
 * Record every canonical route a walk actually attempted.
 *
 * **The route id comes from the branch and nowhere else.** That is the whole
 * property this module exists to hold: an inherited route that was executed
 * receives the observation under its own id, and no substitute id can be
 * introduced between the attempt and the record.
 */
export function observeManifestWalk(
  k: MethodKnowledge,
  walk: ManifestWalk,
  jurisdiction: string,
): ObservationResult {
  let knowledge = k;
  const recorded: ObservedAttempt[] = [];
  const duplicates: ObservedAttempt[] = [];
  const unknownRoutes: string[] = [];
  let unattributed = 0;

  for (const branch of walk.branches as readonly ManifestBranch[]) {
    const routeId = typeof branch.route === "string" ? branch.route.trim() : "";
    if (!routeId) {
      unattributed += 1;
      continue;
    }
    if (!knowledge.routes.some((r) => r.id === routeId)) {
      // A route the walk names and project knowledge does not hold is a route
      // worth LEARNING, not one worth inventing an outcome for. It is reported
      // so a session can add it deliberately (RULING 178).
      if (!unknownRoutes.includes(routeId)) unknownRoutes.push(routeId);
      continue;
    }

    const { outcome, why } = classifyBranch(branch);
    const attempt: ObservedAttempt = {
      routeId,
      outcome,
      rows: branch.found ? 1 : 0,
      note: `${why} — ${branch.result}`.slice(0, 300),
    };
    const res = recordRouteOutcome(knowledge, routeId, {
      jurisdiction,
      walkedOn: branch.attemptedAt,
      rows: attempt.rows,
      outcome,
      note: attempt.note,
    });
    knowledge = res.knowledge;
    (res.recorded ? recorded : duplicates).push(attempt);
  }

  return { knowledge, recorded, duplicates, unattributed, unknownRoutes };
}
