import type { CoverageSummary, CoveredBody } from "../registry/coverage.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { officeTypeForTitle } from "../officials/office-blurbs.ts";
/* ASK-9: the one roster member Ask still names — whoever runs the body. */
import { topOfficesFor } from "../officials/top-offices.ts";
/* ASK-5 (2026-08-24): the SAME store the battlecard and the representation
   view read. See `peopleFor` below for what reading a different one cost. */
import { rosterHoldersForBody } from "../registry/body-rosters.ts";

import type { NamedEntityBinding } from "./named-entity.ts";
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
  binding: NamedEntityBinding = { kind: "NONE" },
): CoveredBody[] {
  if (!step.bodyTarget) return [];

  /*
   * **THE NAMED ENTITY BINDS BEFORE THE CONTEXT DEFAULT (2026-08-27).**
   *
   * Everything below this block selects bodies out of the READER'S COVERAGE,
   * which is resolved from where the reader is. That is the right default for
   * the great majority of questions — "who fixes my pothole" is a question
   * about here — and it was the WRONG answer for the one question class that
   * says otherwise: a question that names a government.
   *
   * At a Tucson zip, *"What's on the Vail school district agenda?"* selected
   * every school board in the reader's coverage and rendered Sunnyside
   * Unified. Not as a guess, not hedged — as the answer. The reader's own word
   * "Vail" never reached this function, so the default could not be overruled
   * by it, and a reader had no way to see that the government they asked about
   * was not the government they were told about.
   *
   * So a binding that named something the default cannot satisfy returns
   * NOTHING here, and the caller states which case it was. An empty list
   * renders as a NAMED GAP one level up; the default body never speaks over a
   * name the reader gave.
   */
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

  /*
   * A name WAS resolved. Retrieval is constrained to that government and to no
   * other — matched on identity (the body id or the division id), never on the
   * label, because two governments can share a name and a label match is how
   * the substitution would come back through a different door.
   *
   * Zero survivors is a real and honest state: the reader named a government
   * that this step's own coverage does not contain. That renders as the named
   * gap, which is a true sentence, where the default would have been a false one.
   */
  const wanted = binding.entity.id;
  return inScope.filter(
    (body) => body.bodyId === wanted || body.ocdId === wanted,
  );
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

  /*
   * **ASK-9 / ASK-10 (2026-08-25) — ASK NAMES BODIES, NOT THEIR MEMBERS.**
   *
   * ASK-5 put the body's whole roster here and the reasoning was right as far
   * as it went: a school board's clerk IS a better answer than a state
   * representative who votes on the funding formula. What it produced is what
   * the author boxed in red on `08-58-52` — six people under one sentence at
   * Tucson, and, worse, on `09-22-18` at 07866: FOUR school districts named
   * correctly, and then ONE of their rosters printed underneath as though it
   * answered for all four. Every one of those seven addresses is `@rocktwp.net`.
   * That is a specific false impression about who governs a reader, produced by
   * a list that was individually accurate.
   *
   * So the roster does not come here. The BODY is named, the body is a click
   * target, and its members are one click away on the card that can say which
   * body they belong to. **This is not a coverage change** — nothing is
   * dropped from the data or from the battlecard, and the equal-effort rule is
   * untouched because it governs the hunt rather than the render.
   *
   * **The one exception is the person who RUNS the body**, and the author
   * asked for it by name: the superintendent, described as running the
   * district's operations day to day. One person, one role, and it is the
   * answer to "who do I call" in a way a seven-name list is not.
   *
   * RULING 118 is why the DESCRIPTION matters and not just the name: an
   * appointed official never carries the govern verb, and `topOfficesFor`
   * already types this person as "Runs it day to day" rather than as anyone
   * who governs the reader.
   */
  /*
   * **AND ONLY WHERE THERE IS EXACTLY ONE BODY** — ASK-10's half, and it is
   * the half that makes the rule safe rather than merely shorter.
   *
   * At 85701 the step resolves to ONE district, so "Dr. Gabriel Trujillo runs
   * it day to day" is an unambiguous answer to who to call. At 07866 it
   * resolves to FOUR — Morris Hills Regional, Rockaway Township, Denville
   * Township and Rockaway Borough — and naming any person under a heading that
   * covers all four says that person belongs to all four. That is exactly the
   * false impression `09-22-18` records, and it would survive being cut from
   * seven names to one; a single wrong attribution is not an improvement on
   * seven, it is a harder one to notice.
   *
   * The author's instruction is literal: no names until the reader selects a
   * district. With more than one body the step names the bodies, each of them
   * a click target, and the names live on the card that can say whose they
   * are.
   */
  if (bodies.length === 1) {
    for (const top of topOfficesFor(rosterHoldersForBody(bodies[0].bodyId))) {
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
 * The honest sentence for a question that DID name a government.
 *
 * Each of these is a fact about OUR RECORD, which is what the render rule
 * requires and what the Sunnyside answer got wrong: substituting a body we did
 * hold for one the reader asked about turned our gap into a claim about a
 * government. None of these sentences announces a failure or apologises — they
 * state what is known and offer the narrowing (RULING 139).
 *
 * Null means the binding places no constraint, and the caller's own sentence
 * about this area stands.
 */
function gapForBinding(binding: NamedEntityBinding): string | null {
  if (binding.kind === "UNRESOLVED") {
    /*
     * **THIS SENTENCE USED TO OVERCLAIM, AND THE OVERCLAIM WAS ABOUT US.**
     * (2026-08-27.)
     *
     * It read *"We don't have a government recorded under 'vail'"* — and at a
     * Tucson zip that is FALSE. The product holds Vail Unified District, with
     * eleven meetings and nine documents. What the binder actually did was
     * search the reader's OWN AREA: the search index for what is in view, plus
     * their covered bodies. It never looked further, and never could from the
     * client.
     *
     * So the claim is scoped to what was actually searched. "We haven't matched
     * that to a government near you" is true whatever the rest of the corpus
     * holds; "we don't have it" was a statement about our whole holdings made
     * from a local lookup. Same discipline as a failed fetch never becoming a
     * recorded absence — pointed inward, at a claim about ourselves.
     */
    return `We haven't matched "${binding.mention}" to a government near you. Searching for it by name will show what we hold.`;
  }
  if (binding.kind === "AMBIGUOUS") {
    const names = binding.candidates.map((c) => c.name);
    return `More than one government here goes by that name — ${names.join(" and ")}. Choose one and we'll answer for it.`;
  }
  if (binding.kind === "BOUND") {
    return `We hold ${binding.entity.name}, and we haven't sourced this topic for it yet.`;
  }
  return null;
}

export function resolveRouting(
  topicId: string,
  coverage: CoverageSummary,
  /**
   * The government the reader NAMED, when they named one (2026-08-27).
   *
   * Defaulted, so every existing caller and test is unaffected and keeps the
   * context-default behaviour that is correct for a question naming nobody.
   */
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
      /*
       * **ASK-9 / ASK-10 (2026-08-25): "no names shown" IS NOT "no names
       * held", and this clause is what keeps the two apart.**
       *
       * Ask stopped printing body rosters the same day, so `people.length ===
       * 0` became the NORMAL state for a step that names a council or several
       * districts — and without this the answer would print *We haven't
       * sourced who sits on this body yet* about a body whose members are on
       * screen one click away. That is exactly the false absence ASK-5 was
       * opened over, reintroduced through the front door by a change that had
       * nothing to do with sourcing.
       *
       * `tests/routing.test.ts` caught it before it shipped, which is that
       * guard doing its job — the assertion it makes is about the CLAIM
       * ("nobody is sourced") rather than about the render, so trimming the
       * render could not sneak past it.
       *
       * The gap is about OUR RECORD, so it is asked of our record: it renders
       * only where the bodies genuinely hold nobody.
       */
      bodies.every((body) => rosterHoldersForBody(body.bodyId).length === 0)
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
