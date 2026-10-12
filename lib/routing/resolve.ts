import type { CoverageSummary, CoveredBody } from "../registry/coverage.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { officeTypeForTitle } from "../officials/office-blurbs.ts";
// The one roster member Ask names: whoever runs the body.
import { topOfficesFor } from "../officials/top-offices.ts";
// The same store the body card and the representation view read.
import { projectedBodyRoster } from "../registry/body-roster-client.ts";

import type { NamedEntityBinding } from "./named-entity.ts";
import { routeForTopic, type RouteStep, type TopicRoute } from "./topics.ts";

/**
 * The explainer sentence this reader sees. Shared topic templates are jurisdiction-neutral; an override
 * applies only when the reader's own coverage contains the named division. No match, no override.
 */
function whyFor(step: RouteStep, coverage: CoverageSummary): string {
  if (!step.divisionWhy?.length) return step.why;
  const own = new Set<string>();
  for (const body of coverage.bodies) if (body.ocdId) own.add(body.ocdId);
  for (const seat of coverage.seats) own.add(seat.ocdId);
  const hit = step.divisionWhy.find((d) => own.has(d.divisionOcdId));
  return hit ? hit.why : step.why;
}

/**
 * The routing resolution: given a topic and what we know about a point, name the real bodies and
 * people, with the denominator carried. A step that maps to nothing we hold carries an honest gap
 * naming the general body that owns the topic, never a guessed name. Party never enters routing. Pure.
 */

export interface ResolvedStep {
  why: string;
  /**
   * The bodies we can actually point at for this step. May be empty. `body` is the whole covered row, so
   * the name opens the body's card (where every external door lives) rather than linking out.
   */
  bodies: { label: string; homepageUrl: string | null; body: CoveredBody }[];
  /** The people we can actually name, each with their source intact. */
  people: SeatHolder[];
  /** The honest statement when bodies or people are missing. */
  gap: string | null;
}

export interface RoutingAnswer {
  kind: "ROUTED" | "NO_ROUTE";
  topic: TopicRoute | null;
  /** For NO_ROUTE: the refusal, stated. */
  statement: string | null;
  steps: ResolvedStep[];
  /** The denominator: how much of the route we could actually ground. */
  grounding: { stepsWithSomeone: number; totalSteps: number };
}

/**
 * Is this body the division's own governing body (council, board of supervisors, school board), as
 * opposed to a curated body attached to the same division? Structural, not a name match: the registry
 * mints a division's own governing body at the `#governing` slot (school boards at `#board`). If the slot
 * is absent, the step renders its gap, never the nearest lookalike.
 */
function isOwnGoverningBody(body: CoveredBody): boolean {
  if (!body.ocdId) return false;
  return (
    body.bodyId === `${body.ocdId}#governing` ||
    body.bodyId === `${body.ocdId}#board`
  );
}

function bodiesFor(
  step: RouteStep,
  coverage: CoverageSummary,
  binding: NamedEntityBinding = { kind: "NONE" },
): CoveredBody[] {
  if (!step.bodyTarget) return [];

  // The named entity binds before the context default. A binding that names something the reader's
  // coverage cannot satisfy returns nothing here; the empty list renders as a named gap one level up.
  if (binding.kind === "AMBIGUOUS" || binding.kind === "UNRESOLVED") return [];

  const inScope = coverage.bodies.filter((body) => {
    if (!isOwnGoverningBody(body)) return false;
    if (step.bodyTarget === "county") return body.divisionType === "county";
    if (step.bodyTarget === "municipal") {
      return body.divisionType === "place" && body.bodyClass === "GOVERNING";
    }
    return (
      body.divisionType === "school_district" && body.bodyClass === "GOVERNING"
    );
  });

  if (binding.kind !== "BOUND") return inScope;

  // A name was resolved: retrieval is constrained to that government, matched on identity, never on the
  // label. Zero survivors renders as the named gap.
  const wanted = binding.entity.id;
  return inScope.filter(
    (body) => body.bodyId === wanted || body.ocdId === wanted,
  );
}

/**
 * People for a step. A body's roster is looked up by `body.bodyId`, the same key the body card uses, so
 * the two surfaces cannot drift. Legislative seats come from coverage.
 */
function peopleFor(
  step: RouteStep,
  coverage: CoverageSummary,
  bodies: CoveredBody[],
): SeatHolder[] {
  const holders: SeatHolder[] = [];
  const seen = new Set<string>();
  const push = (holder: SeatHolder) => {
    if (seen.has(holder.id)) return;
    seen.add(holder.id);
    holders.push(holder);
  };

  // Ask names bodies, not their members: the body is a click target and its members are on its card. The
  // one exception is the person who runs the body, named by role (`topOfficesFor`, which never uses the
  // govern verb for an appointed official).
  // And only where there is exactly one body: under a heading covering several bodies, a named person
  // would read as belonging to all of them.
  if (bodies.length === 1) {
    for (const top of topOfficesFor([...projectedBodyRoster(bodies[0]).members])) {
      if (top.role === "Runs it day to day") push(top.holder);
    }
  }

  if (!step.officeType) return holders;
  if (step.officeType === "us-senator") {
    for (const senator of coverage.senators) push(senator);
    return holders;
  }
  for (const seat of coverage.seats) {
    for (const holder of seat.representatives) {
      if (officeTypeForTitle(holder.officeTitle) === step.officeType) {
        push(holder);
      }
    }
  }
  return holders;
}

/** The pre-existing sentence, for a question that named nobody. Unchanged. */
const UNSOURCED_HERE_GAP =
  "We don't yet know enough here to route this — the general owner of this topic is the body described above, and we haven't sourced it for this area yet.";

/**
 * The sentence for a question that did name a government: a fact about our record, offering the
 * narrowing. Null means the binding places no constraint.
 */
function gapForBinding(binding: NamedEntityBinding): string | null {
  if (binding.kind === "UNRESOLVED") {
    // Scoped to what was actually searched: the reader's own area, not our whole holdings.
    return `We haven't matched "${binding.mention}" to a government near you. Searching for it by name will show what we hold.`;
  }
  if (binding.kind === "AMBIGUOUS") {
    const names = binding.candidates.map((c) => c.name);
    // The ask box reads the class of government from the reader's words (`CLASS_PHRASE_DIVISIONS`), so
    // adding "school district" or "town" resolves the tie.
    return `More than one government here goes by that name — ${names.join(" and ")}. Say which kind you mean — "school district", "town" — and we'll answer for that one.`;
  }
  if (binding.kind === "BOUND") {
    return `We hold ${binding.entity.name}, and we haven't sourced this topic for it yet.`;
  }
  return null;
}

export function resolveRouting(
  topicId: string,
  coverage: CoverageSummary,
  /** The government the reader named, when they named one. Defaults to no binding. */
  binding: NamedEntityBinding = { kind: "NONE" },
): RoutingAnswer {
  const topic = routeForTopic(topicId);
  if (!topic) {
    // The refusal, as specified: never a guess.
    return {
      kind: "NO_ROUTE",
      topic: null,
      statement:
        "We don't have a sourced answer for who owns this topic yet. Rather than guess, we haven't routed it — as we learn more, we'll share more.",
      steps: [],
      grounding: { stepsWithSomeone: 0, totalSteps: 0 },
    };
  }

  const steps: ResolvedStep[] = topic.steps.map((step) => {
    const bodies = bodiesFor(step, coverage, binding);
    const people = peopleFor(step, coverage, bodies);

    let gap: string | null = null;
    if (bodies.length === 0 && people.length === 0) {
      /*
       * WHOSE gap is this? The render rule requires the sentence to say, and
       * after the binding rung there are three different true answers where
       * there used to be one. Naming the wrong one is the same class of defect
       * as naming the wrong body.
       */
      gap = step.bodyTarget
        ? gapForBinding(binding) ?? UNSOURCED_HERE_GAP
        : UNSOURCED_HERE_GAP;
    } else if (
      step.bodyTarget &&
      bodies.length > 0 &&
      people.length === 0 &&
      // "No names shown" is not "no names held": the gap renders only where the bodies genuinely hold
      // nobody.
      bodies.every((body) => projectedBodyRoster(body).members.length === 0)
    ) {
      // The body exists; who sits on it is unsourced. Say which half.
      gap = "We haven't sourced who sits on this body yet.";
    }

    return {
      why: whyFor(step, coverage),
      bodies: bodies.map((b) => ({
        // The division's label — sourced from Census — never an invented
        // body name (Body.name stays null on derived rows).
        label: b.name ?? b.divisionLabel,
        homepageUrl: b.homepageUrl,
        // The row itself, so the name can open its card.
        body: b,
      })),
      people,
      gap,
    };
  });

  return {
    kind: "ROUTED",
    topic,
    statement: null,
    steps,
    grounding: {
      stepsWithSomeone: steps.filter(
        (s) => s.bodies.length > 0 || s.people.length > 0,
      ).length,
      totalSteps: steps.length,
    },
  };
}
