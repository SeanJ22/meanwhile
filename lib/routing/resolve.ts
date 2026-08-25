import type { CoverageSummary, CoveredBody } from "../registry/coverage.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { officeTypeForTitle } from "../officials/office-blurbs.ts";
/* ASK-5 (2026-08-24): the SAME store the battlecard and the representation
   view read. See `peopleFor` below for what reading a different one cost. */
import { rosterHoldersForBody } from "../registry/body-rosters.ts";

import { routeForTopic, type RouteStep, type TopicRoute } from "./topics.ts";

/**
 * The explainer sentence this reader actually sees.
 *
 * Item 1 (the tester's mobile pass, 2026-08-14): a shared topic template is
 * jurisdiction-neutral by rule, and place-specific truth reaches only the
 * place it belongs to. An override applies when the reader's OWN coverage
 * contains the named division — resolved against the divisions we already
 * hold for the point, never against a zip, a name, or a guess. No match,
 * no override: the neutral sentence stands. Tie-or-zero, same as everywhere
 * else.
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
  /**
   * The bodies we can actually point at for this step. May be empty.
   *
   * **ASK-4 (2026-08-24) — `body` is the WHOLE covered row, and that is what
   * makes the name a door rather than an exit.** The step used to carry a
   * label and a `homepageUrl`, so the only thing an Ask answer could do with a
   * body's name was link OUT of the product to the body's own website. The
   * who-governs card settled this grammar on 2026-08-16: a body's row opens
   * the body's battlecard, and every external door lives INSIDE that card.
   * Ask was the one surface still doing it the old way, on all three of its
   * placements. Carrying the row means the same opener the who-governs card
   * uses can be handed to Ask unchanged, rather than a second lookup that
   * could resolve to a different body.
   *
   * `homepageUrl` stays on the shape because it is part of the record. What
   * changed is that no Ask surface renders it as the click target.
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
 * Is this body the DIVISION'S OWN governing body — its council, board of
 * supervisors, school board — as opposed to a curated body that merely
 * governs something else while attached to the same division?
 *
 * The 85723 defect (item 2d, 2026-08-14 second session): "pothole in
 * front of my house" answered with "Tucson · Public Housing Authority
 * Board of Commissioners". The PHA is honestly `GOVERNING` — it governs
 * the housing authority — and it is attached to `place:tucson`, so a
 * class-based filter swept it into the municipal-government answer. A
 * reader who calls the PHA about a pothole is bounced; a wrong body must
 * never render as an answer.
 *
 * The discriminator is structural, not a name match: the registry mints
 * a division's own governing body at the `#governing` slot (school
 * boards at `#board`) — `lib/registry/derive.ts`'s documented id scheme.
 * Curated additions occupy their own slots (`#public-housing-authority`)
 * and never match. Tie-or-zero refuses: if the slot is absent, the step
 * renders its honest gap, never the nearest lookalike.
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
): CoveredBody[] {
  if (!step.bodyTarget) return [];
  return coverage.bodies.filter((body) => {
    if (!isOwnGoverningBody(body)) return false;
    if (step.bodyTarget === "county") return body.divisionType === "county";
    if (step.bodyTarget === "municipal") {
      return body.divisionType === "place" && body.bodyClass === "GOVERNING";
    }
    return (
      body.divisionType === "school_district" && body.bodyClass === "GOVERNING"
    );
  });
}

/**
 * **ASK-5 (2026-08-24) — ASK AND REPRESENTATION WERE READING DIFFERENT
 * STORES, AND ONLY ONE OF THEM HELD THE ANSWER.**
 *
 * The author's captures put the two side by side. `12-04-06` is Ask on
 * "when does school start", saying *We haven't sourced who sits on this body
 * yet* about Tucson Unified. `12-05-31` is the same district's battlecard,
 * Representation tab, rendering Dr. Ravi Shah, Natalie Luna Rose, Jennifer
 * Eckstrom, Val Romero, Sadie Shaw and Dr. Gabriel Trujillo — six people, five
 * with photographs.
 *
 * **WHICH STORE EACH SIDE WAS READING.** This function read `coverage.seats`
 * and `coverage.senators` — the LEGISLATIVE representation resolved from the
 * reader's districts, which is Congress and the state legislature. The
 * battlecard and the representation view read the BODY ROSTER store,
 * `BODY_ROSTERS`, through `rosterHoldersForBody(bodyId)`. A school board sits
 * in the second and has never been in the first, because a school board is not
 * a legislative district — so Ask asked the one store that structurally could
 * not answer, got nothing, and printed a sourced-sounding absence about a body
 * whose members were on screen one click away.
 *
 * That is the collection-versus-rendering pair inside one product: two numbers
 * for one question, each true about its own source, and the surface stating
 * one of them as though it were the answer. It is also the render-default rule
 * — the null was converted into a claim, and the claim was false.
 *
 * **THE FIX IS AT THE SHARED PATH**, which means the same key: the roster is
 * looked up by `body.bodyId`, exactly the id the battlecard uses, so the two
 * surfaces cannot drift again without both moving. `rosterHoldersForBody`
 * returns an empty array for a body with no roster, so the honest gap still
 * renders where there genuinely is one.
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

  // ASK-5: the body's own members lead, because they are the people the step
  // is about. A school board's clerk is a better answer to "who decides when
  // school starts" than the state representative who votes on the funding
  // formula — and the second one is already the NEXT step of the route.
  for (const body of bodies) {
    for (const holder of rosterHoldersForBody(body.bodyId)) push(holder);
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
    const people = peopleFor(step, coverage, bodies);

    let gap: string | null = null;
    if (bodies.length === 0 && people.length === 0) {
      gap =
        "We don't yet know enough here to route this — the general owner of this topic is the body described above, and we haven't sourced it for this area yet.";
    } else if (step.bodyTarget && bodies.length > 0 && people.length === 0) {
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
        // ASK-4: the row itself, so the name can open its battlecard.
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
