import type { CoverageSummary, CoveredBody } from "../registry/coverage.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { officeTypeForTitle } from "../officials/office-blurbs.ts";

import { routeForTopic, type RouteStep, type TopicRoute } from "./topics.ts";

/**
 * The routing resolution (6): given a topic and what we actually know about
 * a point, name the real bodies and people — with the denominator carried.
 *
 * A07 in full: no source, no answer. A step that maps to nothing we hold
 * carries an honest gap naming the general body that owns the topic, never
 * a guessed name. **Party never enters routing** — this module does not
 * read `partyLabel`, and a test proves resolution is identical however
 * labels are set.
 *
 * Pure: coverage is an argument, so this runs in a test against the real
 * registry the same way `resolve.ts` does. The chat surface on top is next
 * session's work.
 */

export interface ResolvedStep {
  why: string;
  /** The bodies we can actually point at for this step. May be empty. */
  bodies: { label: string; homepageUrl: string | null }[];
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

function bodiesFor(
  step: RouteStep,
  coverage: CoverageSummary,
): CoveredBody[] {
  if (!step.bodyTarget) return [];
  return coverage.bodies.filter((body) => {
    if (step.bodyTarget === "county") return body.divisionType === "county";
    if (step.bodyTarget === "municipal") {
      return body.divisionType === "place" && body.bodyClass === "GOVERNING";
    }
    return (
      body.divisionType === "school_district" && body.bodyClass === "GOVERNING"
    );
  });
}

function peopleFor(
  step: RouteStep,
  coverage: CoverageSummary,
): SeatHolder[] {
  if (!step.officeType) return [];
  if (step.officeType === "us-senator") return coverage.senators;
  const holders: SeatHolder[] = [];
  for (const seat of coverage.seats) {
    for (const holder of seat.representatives) {
      if (officeTypeForTitle(holder.officeTitle) === step.officeType) {
        holders.push(holder);
      }
    }
  }
  return holders;
}

export function resolveRouting(
  topicId: string,
  coverage: CoverageSummary,
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
    const bodies = bodiesFor(step, coverage);
    const people = peopleFor(step, coverage);

    let gap: string | null = null;
    if (bodies.length === 0 && people.length === 0) {
      gap =
        "We don't yet know enough here to route this — the general owner of this topic is the body described above, and we haven't sourced it for this area yet.";
    } else if (step.bodyTarget && bodies.length > 0 && people.length === 0) {
      // The body exists; who sits on it is unsourced. Say which half.
      gap = "We haven't sourced who sits on this body yet.";
    }

    return {
      why: step.why,
      bodies: bodies.map((b) => ({
        // The division's label — sourced from Census — never an invented
        // body name (Body.name stays null on derived rows).
        label: b.name ?? b.divisionLabel,
        homepageUrl: b.homepageUrl,
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
