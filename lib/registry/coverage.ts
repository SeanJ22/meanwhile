import type { Tier } from "../ocd/tiers.ts";
import type {
  CivicDataReadMetadata,
  CivicDataReadResult,
} from "../civic-data/read-model.ts";
import {
  holdersFor,
  senatorsFor,
  type OfficeholderIndex,
  type SeatHolder,
} from "../officials/lookup.ts";
import { statewideExecutivesFor } from "../officials/statewide-executives.ts";
import { schoolDependency, type SchoolDependency } from "../officials/school-dependency.ts";

import { bodiesAt, type GeoFeature } from "./resolve.ts";
import type { BodyTerritoryFile } from "./body-territory.ts";
import type { RosterReaderGap } from "./body-rosters.ts";
import type {
  Body,
  BodyClass,
  CoverageStatus,
  Division,
  DivisionType,
} from "./types.ts";
import { WIRED_STATUSES } from "./coverage-client.ts";
import { indexAudits } from "./audit.ts";
import { COVERAGE_AUDIT_FILE } from "./coverage-audit.ts";
import type { PublicBodyAttempt } from "./body-attempt-read.ts";
import type { BodyFamilyAttempts } from "./attempt-families.ts";
import type { Meeting } from "../sources/types.ts";

/** A dated cited source hunt is evidence; a registry status alone is not.
 * New control-plane attempts are not present in this historic audit yet, so
 * the count below is a documented lower bound, never a never-searched claim. */
const DOCUMENTED_SEARCHES = indexAudits(COVERAGE_AUDIT_FILE);

/**
 * What we can honestly say about who governs a point, and how much of it we
 * have.
 *
 * The failure this exists to kill: the stat card reads `0`, the map is empty,
 * and a reader concludes nothing is happening. The truth is almost always *this
 * app has no source for the bodies that govern here* — a completely different
 * statement, and the one the product exists to never make.
 *
 * It is the same discipline the meeting cascade already applies. `query.ts`
 * always reports which rung produced its answer, because a silently widened
 * radius is a wrong answer. Coverage silence is the same bug one level up, so
 * it gets the same treatment: say what is known, say what is missing, and never
 * let the second one look like the first.
 *
 * **Never tell a reader they have no representation.** Every square foot of the
 * country is governed by something. Where no municipal government exists — Vail,
 * unincorporated county land, a New Hampshire grant — there is still a county
 * board, a school board, state legislators and a member of Congress. An absent
 * municipal tier is a fact to state plainly beside the tiers that do exist,
 * never a reason to show less.
 */

/**
 * Which of the four states the reader is actually in.
 *
 * `MEETINGS`       — bodies known and meetings found. The map speaks for itself.
 * `NONE_SCHEDULED` — bodies known, sources wired, nothing on the calendar. This
 *                    is the only one of the four that is a statement about
 *                    *government* being quiet rather than about us being blind.
 * `NO_SOURCE`      — bodies known, no calendar wired for them. Name them anyway.
 * `UNMAPPED`       — no bodies known here at all.
 */
export type CoverageState = "MEETINGS" | "NONE_SCHEDULED" | "NO_SOURCE" | "UNMAPPED";

/**
 * The canonical current-person authority observed for one exact state scope.
 *
 * This deliberately carries no roster payload. The people already ride on
 * `seats`; this is the authority disposition that prevents an empty people
 * array from making two materially different statements look identical:
 * `NOT_RECORDED` means the store answered and has no pointer, while
 * `STORE_UNREACHABLE` means the Reader could not establish that fact.
 */
export interface StateLegislatorCoverageAuthority {
  readonly scope: string;
  readonly kind: CivicDataReadResult<unknown>["kind"];
  readonly metadata: CivicDataReadMetadata;
  readonly code: Extract<
    CivicDataReadResult<unknown>,
    { readonly kind: "STORE_UNREACHABLE" }
  >["code"] | null;
  readonly detail: string | null;
}

/** Strip a roster read to the authority facts safe and useful on coverage. */
export function stateLegislatorCoverageAuthority(
  scope: string,
  read: CivicDataReadResult<unknown>,
): StateLegislatorCoverageAuthority {
  return {
    scope,
    kind: read.kind,
    metadata: read.metadata,
    code: read.kind === "STORE_UNREACHABLE" ? read.code : null,
    detail: "detail" in read ? read.detail : null,
  };
}

/** Reader-facing distinction for the two empty-roster failure domains. */
export {
  stateLegislatorCoverageGapText,
  WIRED_STATUSES,
} from "./coverage-client.ts";

/**
 * A body covering the point.
 *
 * `divisionLabel` is the **division's** name, which is sourced — it comes off
 * the Census boundary file. The body's own name is deliberately absent, because
 * `Body.name` is null on every derived row and inventing one ("Vail Unified
 * School District Governing Board") is the fabricated-agenda-URL failure again,
 * except read aloud. What is known is that the division exists and that its type
 * implies a governing body; that is exactly what this carries and no more.
 */
export interface CoveredBody {
  bodyId: string;
  ocdId: string | null;
  /**
   * The body's own name — non-null only when it was read off a cited page
   * (curated rows). Derived rows stay null and render their division's
   * label; a curated Tucson board must render its own name, or five rows
   * all read "Tucson".
   */
  name: string | null;
  divisionLabel: string;
  /**
   * **NULL WHERE THE BODY HAS NO DIVISION** (`NH94`, closed 2026-08-23).
   *
   * This was `DivisionType` and was filled with `"place"` for a body that has
   * no division at all — the Southeast Regional Council case. That default was
   * a PLACEHOLDER chosen for the type's convenience, and closing the class
   * layer on 2026-08-23 made it a finding: `"place"` resolves to the
   * municipality class, so such a body would have rendered *"This is a New
   * Jersey municipality — the layer of government closest to a resident"*
   * about a body nobody has established is a municipality.
   *
   * `definitionsForBody` guards the symptom by returning nothing for a null
   * `ocdId`, and that guard stays. **This closes the cause**: a placeholder
   * wearing a value's clothes, waiting for the next thing that reads it as a
   * finding without a guard in place. The render-default rule, one layer below
   * a component.
   */
  divisionType: DivisionType | null;
  /**
   * The Census legal/statistical area description, carried through from the
   * division (DEF-1, 2026-08-22).
   *
   * It is what tells a New Jersey TOWNSHIP from a Town without matching on a
   * name string, and the two are different claims about what kind of thing the
   * body is. **LSAD 44 is `township` and LSAD 43 is `town`** — this comment
   * said 43 was Township until 2026-08-23, which is the same wrong fact that
   * put New Jersey's township definition on eleven Towns' cards. It was already
   * on `Division` and was being dropped here.
   */
  lsad: string | null;
  /**
   * INDEPENDENT / DEPENDENT / UNCLASSIFIED school-system stamp (DEF-2), computed
   * on the server from the Census classification. Carried on the body so the
   * battlecard's class definition needs no client-side lookup — the 103 KB
   * `school-district-dependency.json` used to ride into the first-load JS bundle
   * through `map-entry.tsx` for exactly this one field (G, 2026-09-14).
   */
  schoolDependency: SchoolDependency;
  bodyClass: BodyClass;
  coverageStatus: CoverageStatus;
  homepageUrl: string | null;
  /** Where this body's agendas live, when a hunt found them. */
  agendaSourceRef: string | null;
  /** When the body regularly meets, in its official page's words, with that page. */
  meetingCadence?: { text: string; sourceUrl: string | null } | null;
  /**
   * Whether a dated, cited hunt for this exact body is in the historical audit.
   * False means no such receipt is held here, not that nobody has searched.
   */
  lookedAt: boolean;
  /**
   * This body's publisher attempts when the bounded public projection answered, kept within one kind of fact:
   * a family shows its own latest attempt, last good check and what is published now, and a family with no
   * attempt is absent. An attempt for one kind of fact is never shown as another's. This does not prove an
   * exhaustive source search.
   */
  publicationAttempts?: BodyFamilyAttempts<PublicBodyAttempt>;
  tier: Tier;
  /**
   * **RULING 71.** This body's territory covers only PART of the zip the reader
   * typed, so whether it governs THEM is a fact about their street.
   *
   * Optional and absent by default, because it is only knowable when a reader
   * NAMED a zip. A settled-viewport fetch carries none — the reader panned
   * rather than named a place — and there is then no zip for a body to be
   * partial about. Absent means "not applicable here", never "certain".
   *
   * **It is not a completeness statement and RULING 44 is not weakened by it.**
   * A completeness marker says *we did not find this*, about our data. This
   * says *this is a fact about your street that only you can settle*. We hold
   * Rockaway Borough's government and Rockaway Township's, both in full; what
   * is unsettled is which one is the reader's. See `lib/geo/zip-certainty.ts`.
   */
  couldGovern?: boolean;
  /**
   * Body-scoped people and completeness gaps projected at the server Reader
   * boundary. Client components consume these bytes; they never import the
   * canonical roster/runtime graph to reconstruct them in the browser.
   *
   * Optional only for pure historical fixtures that construct CoveredBody by
   * hand. `coverageAt` always supplies the projection for production reads.
   */
  readerRoster?: {
    members: SeatHolder[];
    gaps: RosterReaderGap[];
    officePhone: {
      phone: string;
      sourceUrl: string;
      sourceOrg: string;
    } | null;
  };
}

/**
 * A legislative seat covering the point.
 *
 * Kept apart from `bodies` because a legislative district is not a body that
 * meets — it elects a seat in a chamber sitting elsewhere, and Arizona's
 * districts elect one senator and two representatives, so the district is not
 * even one seat. It is still representation, and the "you are not unrepresented"
 * statement is wrong without it.
 */
export interface Seat {
  ocdId: string;
  label: string;
  divisionType: Extract<DivisionType, "cd" | "sldu" | "sldl">;
  tier: Tier;
  /**
   * Who currently holds this seat, where a sourced record exists.
   *
   * **Empty is the normal case and must render as such.** Today only the
   * federal roster is loaded, so `cd:` seats are filled and `sldu`/`sldl` are
   * not — until Plural Open lands (D03). An empty array means we have no
   * record, never that the seat is vacant, and the copy has to say the first
   * rather than imply the second.
   */
  representatives: SeatHolder[];
}

export interface CoverageSummary {
  state: CoverageState;
  bodies: CoveredBody[];
  seats: Seat[];
  /**
   * One entry per official state-legislator scope implicated by `seats`.
   * Empty means no state-legislative division was resolved, not that a store
   * read failed. Non-healthy entries keep absence and unavailability named for
   * both the map and owner-facing diagnostics.
   */
  stateLegislatorAuthorities: StateLegislatorCoverageAuthority[];
  /**
   * **Every division whose boundary CONTAINS this point** — the governing
   * set (2026-08-15).
   *
   * Distinct from anything else on this summary: `bodies` is the governments
   * we hold rows for and `seats` is the three legislative types, while this is
   * the raw point-in-polygon answer, including a division with no body and a
   * statistical place. It is what makes "you are in N districts" a sentence
   * about the reader rather than about the viewport — the districts counter
   * used to read "179 DISTRICTS" off what the map happened to be drawing,
   * which is a fact about the camera.
   *
   * Same committed geometry the map draws from, resolved by the same
   * `divisionsAt` the who-governs card uses. Never a second geometry source.
   */
  divisions: Array<{
    ocdId: string;
    label: string;
    divisionType: DivisionType;
    tier: Tier;
  }>;
  /**
   * A municipal-shaped division covers this point and every one of them is
   * statistical — a CDP or a CCD — so there is genuinely no city or town
   * government here.
   *
   * This is only true when a statistical place *was* found. Finding nothing at
   * all is a different answer: it means the boundary data does not reach here,
   * not that the reader is unincorporated. Conflating the two would turn a
   * coverage gap into a false claim about somebody's government.
   */
  unincorporated: boolean;
  /**
   * US senators for the state this point sits in.
   *
   * Kept apart from `seats` because a senator represents the whole state, and
   * the state is not one of the divisions resolved at the point — there is no
   * state boundary layer. The identifier is derived from the `state:` prefix of
   * the divisions that *were* resolved.
   */
  senators: SeatHolder[];
  /**
   * Statewide elected executives — the governor, today (item 2b,
   * 2026-08-14 second session). Kept apart from `seats` for the same
   * reason `senators` is: a statewide office is elected by no division on
   * the map, so no district row can ever claim it — the blind spot that
   * kept the most prominent officer in every state off the card. Governor
   * only for now; the card's copy names that honestly.
   */
  statewideExecutives: SeatHolder[];
  /**
   * `lookedAt` counts exact-body, cited historical audit rows. New attempts
   * outside that audit remain unknown until a bounded public-safe projection
   * joins them; this is a documented lower bound, not a complete attempt total.
   */
  counts: {
    total: number;
    withSource: number;
    withoutSource: number;
    lookedAt: number;
    /**
     * The GOVERNING-class subset. Split out because "N bodies govern here"
     * became false the moment Tucson's 50-odd advisory boards, committees
     * and commissions landed as curated rows (D29) — an advisory committee
     * is representation-adjacent, not a government, and the lead sentence
     * must not count it as one.
     */
    governing: { total: number; withSource: number };
  };
  /**
   * How many of the seats above we can actually name someone for.
   *
   * The footnote depends on this. "We haven't sourced their names" was true of
   * every seat until the federal roster landed; saying it of AZ-6 now, with
   * Juan Ciscomani sitting in the file, would be false.
   */
  seatCounts: { total: number; named: number };
}

/**
 * Coverage statuses that mean a calendar is actually wired.
 *
 * Exported since item 1a (2026-08-17): the who-governs notice recomputes its
 * own wired count from the post-narrowing body list rather than reading the
 * server's, and it has to ask the SAME question this file asks. Two copies of
 * "what counts as wired" is how the counts drifted in the first place.
 */
const WIRED = WIRED_STATUSES;

const SEAT_TYPES: ReadonlySet<DivisionType> = new Set<DivisionType>([
  "cd",
  "sldu",
  "sldl",
]);

/**
 * The place/cousub duplicate is resolved upstream, at build time.
 *
 * There used to be a `dedupeMunicipal()` here, and it was a stopgap. It guessed
 * which layer held the government from the identifier's shape, inferred from
 * three states — and it guessed wrong for cities: it kept
 * `county:merrimack/place:concord_city` and dropped `place:concord`, which is
 * the actual City of Concord. The count came out right and the identity did not.
 *
 * Census had already answered the question. `FUNCSTAT` marks the duplicate row
 * `F`, for a *fictitious* entity created only to fill the geographic hierarchy,
 * and `lib/registry/derive.ts` now reads it: 32 fictitious rows across the three
 * clip counties produce no body, leaving exactly the 74 general-purpose
 * governments the 2022 Census of Governments enumerates. See tracker M17.
 */

/**
 * Summarize what governs a point.
 *
 * Pure — geometry and the registry come in as arguments — so it runs in a test,
 * on a server, or against vector tiles later without changing. `meetingCount` is
 * the cascade's answer for the same point; it is the only thing that separates
 * "nothing is scheduled" from "we cannot see what is scheduled".
 */
export function summarizeCoverage(
  point: [number, number],
  features: GeoFeature[],
  divisionsById: Map<string, Division>,
  allBodies: Body[],
  meetingCount: number,
  /**
   * Officeholders by division. Optional, and an empty index is a valid state —
   * a roster that fails to load must degrade to the pre-roster copy rather than
   * failing the coverage answer, exactly as a failed registry load degrades to
   * the cascade's own answer.
   */
  officials: OfficeholderIndex = new Map(),
  /**
   * The divisions covering this point, when the caller has already resolved
   * them (AUD-04, 2026-08-18). Omitted, this resolves them itself exactly as it
   * always did — every caller that does not pass it is unaffected.
   */
  resolvedDivisions?: Division[],
  /** Committed body-territory polygons for governments with no division (NH233). */
  territory?: BodyTerritoryFile | null,
  /** Exact per-scope state-roster read dispositions settled by the caller. */
  stateLegislatorAuthorities: StateLegislatorCoverageAuthority[] = [],
  heldMeetings: readonly Meeting[] = [],
): CoverageSummary {
  const { divisions, bodies } = bodiesAt(
    point,
    features,
    divisionsById,
    allBodies,
    resolvedDivisions,
    territory,
  );

  const covered: CoveredBody[] = bodies.map((body) => {
    const division = body.ocdId ? divisionsById.get(body.ocdId) : undefined;
    const held = heldMeetings.find(meeting => meeting.bodyId === body.id);
    return {
      bodyId: body.id,
      ocdId: body.ocdId,
      name: body.name,
      // A body with no division is the Southeast Regional Council case: real,
      // hyperlocal, and not a division. Nothing populates that path yet.
      divisionLabel: division?.label ?? "",
      // NH94: NULL, never a placeholder. A body with no division is the
      // Southeast Regional Council case — real, hyperlocal, and not a division.
      divisionType: division?.divisionType ?? null,
      lsad: division?.lsad ?? null,
      schoolDependency: schoolDependency(body.ocdId),
      bodyClass: body.bodyClass,
      coverageStatus: held ? "LIVE" : body.coverageStatus,
      homepageUrl: body.homepageUrl,
      agendaSourceRef: held?.provenance.sourceUrl ?? body.agendaSourceRef,
      meetingCadence: body.meetingCadence
        ? { text: body.meetingCadence, sourceUrl: body.meetingCadenceSource?.sourceUrl ?? body.provenance.sourceUrl ?? null }
        : null,
      lookedAt: held !== undefined || DOCUMENTED_SEARCHES.has(body.id),
      tier: division?.tier ?? "local",
    };
  });

  const seats: Seat[] = divisions
    .filter((d) => SEAT_TYPES.has(d.divisionType))
    .map((d) => ({
      ocdId: d.ocdId,
      label: d.label,
      divisionType: d.divisionType as Seat["divisionType"],
      tier: d.tier,
      representatives: holdersFor(officials, d.ocdId),
    }));

  const senators = senatorsFor(
    officials,
    divisions.map((d) => d.ocdId),
  );

  const statewideExecutives = statewideExecutivesFor(
    divisions.map((d) => d.ocdId),
  );

  // Only claim "unincorporated" when a municipal-shaped division was actually
  // found and every one of them turned out to be statistical. No division at all
  // is a coverage gap, not a fact about the reader's government.
  const municipal = divisions.filter((d) => d.divisionType === "place");
  const municipalWithBody = new Set(
    covered.filter((b) => b.divisionType === "place").map((b) => b.ocdId),
  );
  const unincorporated =
    municipal.length > 0 && municipal.every((d) => !municipalWithBody.has(d.ocdId));

  // Governing bodies first, live sources before unwired ones, then by label —
  // the notice names only the first few, and those slots belong to the
  // reader's actual governments.
  const classRank = (b: CoveredBody) => (b.bodyClass === "GOVERNING" ? 0 : 1);
  const liveRank = (b: CoveredBody) => (WIRED.has(b.coverageStatus) ? 0 : 1);
  covered.sort(
    (a, b) =>
      classRank(a) - classRank(b) ||
      liveRank(a) - liveRank(b) ||
      a.divisionLabel.localeCompare(b.divisionLabel),
  );

  const withSource = covered.filter((b) => WIRED.has(b.coverageStatus)).length;
  const withoutSource = covered.length - withSource;
  const governing = covered.filter((b) => b.bodyClass === "GOVERNING");

  // The state turns on the *governing* bodies: "nothing is scheduled" is a
  // claim about government being quiet, and an unwired advisory committee
  // (D29 added fifty of them in Tucson) must not convert it into a coverage
  // confession — nor mask one where a government's calendar is missing.
  const governingUnwired = governing.some((b) => !WIRED.has(b.coverageStatus));
  const state: CoverageState =
    meetingCount > 0
      ? "MEETINGS"
      : covered.length === 0
        ? "UNMAPPED"
        : governingUnwired
          ? "NO_SOURCE"
          : "NONE_SCHEDULED";

  return {
    state,
    bodies: covered,
    seats,
    stateLegislatorAuthorities,
    // The governing set — every division containing the point, in the order
    // `divisionsAt` returned them. Carried whole rather than as a count so
    // the door can list what the number counts (the stated-N rule).
    divisions: divisions.map((d) => ({
      ocdId: d.ocdId,
      label: d.label,
      divisionType: d.divisionType,
      tier: d.tier,
    })),
    unincorporated,
    senators,
    statewideExecutives,
    counts: {
      total: covered.length,
      withSource,
      withoutSource,
      lookedAt: covered.filter((b) => b.lookedAt).length,
      governing: {
        total: governing.length,
        withSource: governing.filter((b) => WIRED.has(b.coverageStatus)).length,
      },
    },
    seatCounts: {
      total: seats.length,
      named: seats.filter((s) => s.representatives.length > 0).length,
    },
  };
}
