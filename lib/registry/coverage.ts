import type { Tier } from "../ocd/tiers.ts";
import type {
  CivicDataReadMetadata,
  CivicDataReadResult,
} from "../civic-data/read-model.ts";
import {
  holdersFor,
  senatorsFor,
  stateOcdIdFrom,
  type OfficeholderIndex,
  type SeatHolder,
} from "../officials/lookup.ts";
import { statewideExecutivesFor } from "../officials/statewide-executives.ts";
import { isStatewideExecutive, scopedHolders } from "../officials/scoped-holders.ts";
import { schoolDependency, type SchoolDependency } from "../officials/school-dependency.ts";

import { bodiesAt, type GeoFeature } from "./resolve.ts";
import { slotsFor } from "./derive.ts";
import type { BodyTerritoryFile } from "./body-territory.ts";
import type { RosterReaderGap } from "./body-rosters.ts";
import { heldDivisionRepresentatives } from "./representation-server.ts";
import type {
  Body,
  BodyClass,
  CoverageStatus,
  Division,
  DivisionType,
  RegistryProvenance,
} from "./types.ts";
import { WIRED_STATUSES } from "./coverage-client.ts";
import { indexAudits } from "./audit.ts";
import { COVERAGE_AUDIT_FILE } from "./coverage-audit.ts";
import type { PublicBodyAttempt } from "./body-attempt-read.ts";
import type { BodyFamilyAttempts } from "./attempt-families.ts";
import type { Meeting } from "../sources/types.ts";
import { historyGapFor, type HistoryGap } from "../meetings/history-gaps.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import type { StateOfficeContact } from "../reference/state-offices.ts";
import type { SeatVacancy } from "../officials/types.ts";

/** A dated cited source hunt is evidence; a registry status alone is not.
 * New control-plane attempts are not present in this historic audit yet, so
 * the count below is a documented lower bound, never a never-searched claim. */
const DOCUMENTED_SEARCHES = indexAudits(COVERAGE_AUDIT_FILE);

/**
 * What can honestly be said about who governs a point, and how much of it we hold. Coverage silence
 * must never read as "nothing is happening": say what is known and what is missing, and never let the
 * second look like the first.
 *
 * Never tell a reader they have no representation. Where no municipal government exists there is still
 * a county board, a school board, state legislators and a member of Congress.
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

;

/**
 * A body covering the point. `divisionLabel` is the division's sourced name, or the special district's
 * registered name for that district's board; the body's own name is never invented.
 */
export interface CoveredBody {
  bodyId: string;
  ocdId: string | null;
  /**
   * The body's own name, non-null only when read off a cited page. Derived rows render their division's
   * label.
   */
  name: string | null;
  divisionLabel: string;
  /**
   * Null where the body has no division; never a placeholder type, which would attach a class
   * definition to a body nobody has classified.
   */
  divisionType: DivisionType | null;
  /**
   * The Census LSAD, carried from the division. Tells a township (44) from a town (43) without matching
   * on a name.
   */
  lsad: string | null;
  /**
   * INDEPENDENT / DEPENDENT / UNCLASSIFIED school-system stamp, computed on the server so the client
   * needs no lookup.
   */
  schoolDependency: SchoolDependency;
  bodyClass: BodyClass;
  coverageStatus: CoverageStatus;
  homepageUrl: string | null;
  /** Saved sources for each published body field shown on its card. */
  fieldSources?: Body["fieldSources"];
  /** Where this body's agendas live, when a hunt found them. */
  agendaSourceRef: string | null;
  /** The body's office address and phone, with the saved page that states them. */
  officeContact?: { address: string | null; phone: string | null; provenance: RegistryProvenance } | null;
  /** When the body regularly meets, in its official page's words, with that page. */
  meetingCadence?: { text: string; sourceUrl: string | null } | null;
  /**
   * Whether a dated, cited hunt for this exact body is in the historical audit.
   * False means no such receipt is held here, not that nobody has searched.
   */
  lookedAt: boolean;
  /** Set when the body's door publishes no past meetings: why, for the empty Concluded list. */
  historyGap?: HistoryGap;
  /**
   * This body's publisher attempts when the bounded public projection answered, kept within one kind of fact:
   * a family shows its own latest attempt, last good check and what is published now, and a family with no
   * attempt is absent. An attempt for one kind of fact is never shown as another's. This does not prove an
   * exhaustive source search.
   */
  publicationAttempts?: BodyFamilyAttempts<PublicBodyAttempt>;
  tier: Tier;
  /**
   * This body's territory covers only part of the ZIP the reader named, so whether it governs them
   * depends on their street. Absent when no ZIP was named; absent means "not applicable", never "certain".
   * Not a completeness statement. See `lib/geo/zip-certainty.ts`.
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
 * A sourced office for a division covering the point. Kept apart from body membership:
 * a division's representatives do not establish who sits on every board there.
 */
export interface Seat {
  ocdId: string;
  label: string;
  divisionType: DivisionType;
  tier: Tier;
  /**
   * Who currently holds this seat, where a sourced record exists. Empty means we have no record, never
   * that the seat is vacant.
   */
  representatives: SeatHolder[];
  /** A vacancy is shown only when the office's own source explicitly states it. */
  vacancy?: SeatVacancy;
}

export interface CoverageSummary {
  state: CoverageState;
  bodies: CoveredBody[];
  /** Source inventories are independent of sourced meeting bodies and people. */
  governments?: RegistrationGovernmentListing[];
  governmentInventoryStates?: string[];
  governmentInventoryUnavailableStates?: string[];
  /** Divisions reaching into the ZIP where few of its residents live: named, their boards not shown. */
  fringeDivisions?: { ocdId: string; label: string }[];
  /** National FEC directories selected for the states this place touches. */
  stateOffices?: StateOfficeContact[];
  federalDirectoryUnavailable?: boolean;
  seats: Seat[];
  /**
   * One entry per official state-legislator scope implicated by `seats`.
   * Empty means no state-legislative division was resolved, not that a store
   * read failed. Non-healthy entries keep absence and unavailability named for
   * both the map and owner-facing diagnostics.
   */
  stateLegislatorAuthorities: StateLegislatorCoverageAuthority[];
  /**
   * Every division whose boundary contains this point: the raw point-in-polygon answer, including
   * divisions with no body and statistical places. Resolved by the same `divisionsAt` the who-governs card
   * uses.
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
   * Statewide elected executives. Kept apart from `seats` for the same reason as `senators`: no division
   * on the map elects them.
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
     * The governing-class subset. Advisory boards, committees and commissions are not governments and are
     * not counted here.
     */
    governing: { total: number; withSource: number };
  };
  /** How many of the seats above we can name someone for. */
  seatCounts: { total: number; named: number };
}

/**
 * Coverage statuses that mean a calendar is actually wired. Shared with the who-governs notice so both
 * ask the same question.
 */
const WIRED = WIRED_STATUSES;

const SEAT_TYPES: ReadonlySet<DivisionType> = new Set<DivisionType>([
  "cd",
  "sldu",
  "sldl",
]);

/**
 * The place/cousub duplicate is resolved upstream: `lib/registry/derive.ts` reads Census FUNCSTAT, and
 * a fictitious (`F`) row produces no body.
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
   * Officeholders by division. An empty index is valid: a roster that fails to load degrades the copy
   * rather than failing the coverage answer.
   */
  officials: OfficeholderIndex = new Map(),
  /**
   * The divisions covering this point, when the caller has already resolved them; omitted, they are
   * resolved here.
   */
  resolvedDivisions?: Division[],
  /** Committed body-territory polygons for governments with no division. */
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
    const historyGap = historyGapFor(body.id);
    return {
      bodyId: body.id,
      ocdId: body.ocdId,
      name: body.name,
      // A body with no division: real, hyperlocal, and not a division.
      divisionLabel: body.governmentName ?? division?.label ?? "",
      // Null, never a placeholder type.
      divisionType: division?.divisionType ?? null,
      lsad: division?.lsad ?? null,
      schoolDependency: schoolDependency(body.ocdId),
      bodyClass: body.bodyClass,
      coverageStatus: held ? "LIVE" : body.coverageStatus,
      homepageUrl: body.homepageUrl,
      ...(body.fieldSources ? { fieldSources: body.fieldSources } : {}),
      agendaSourceRef: held?.provenance.sourceUrl ?? body.agendaSourceRef,
      meetingCadence: body.meetingCadence
        ? { text: body.meetingCadence, sourceUrl: body.meetingCadenceSource?.sourceUrl ?? body.provenance.sourceUrl ?? null }
        : null,
      ...(body.officeAddress || body.officePhone
        ? { officeContact: { address: body.officeAddress ?? null, phone: body.officePhone ?? null, provenance: body.fieldSources?.officeAddress ?? body.fieldSources?.officePhone ?? body.provenance } }
        : {}),
      lookedAt: held !== undefined || DOCUMENTED_SEARCHES.has(body.id),
      ...(historyGap ? { historyGap } : {}),
      tier: division?.tier ?? "local",
    };
  });

  const rootLegislators = (d: Division) => stateOcdIdFrom(d.ocdId) === d.ocdId
    ? holdersFor(officials, d.ocdId).filter(holder => holder.chamber === "upper" || holder.chamber === "lower") : [];
  const seats: Seat[] = divisions
    .filter((d) => SEAT_TYPES.has(d.divisionType) || rootLegislators(d).length > 0 || d.tier === "local" && holdersFor(officials, d.ocdId).length > 0)
    .map((d) => ({
      ocdId: d.ocdId,
      label: d.label,
      divisionType: d.divisionType,
      tier: d.tier,
      representatives: stateOcdIdFrom(d.ocdId) === d.ocdId ? rootLegislators(d) : d.tier === "local"
        ? heldDivisionRepresentatives(d.ocdId, holdersFor(officials, d.ocdId))
        : holdersFor(officials, d.ocdId),
    }));

  const senators = senatorsFor(
    officials,
    divisions.map((d) => d.ocdId),
  );

  const stateIds = [...new Set(divisions.map(d => stateOcdIdFrom(d.ocdId)).filter((id): id is string => id !== null))];
  const statewideExecutives = stateIds.flatMap(stateId => scopedHolders(
    statewideExecutivesFor([stateId]), holdersFor(officials, stateId).filter(isStatewideExecutive),
  ));

  // Only claim "unincorporated" when a municipal-shaped division was actually
  // found and every one of them turned out to be statistical. No division at all
  // is a coverage gap, not a fact about the reader's government.
  const municipal = divisions.filter((d) => d.divisionType === "place");
  const municipalWithBody = new Set(
    covered.filter((b) => b.divisionType === "place").map((b) => b.ocdId),
  );
  const unincorporated =
    municipal.length > 0 && municipal.every((d) =>
      slotsFor(d).skipped === "statistical-or-unorganized" &&
      !municipalWithBody.has(d.ocdId) && holdersFor(officials, d.ocdId).length === 0 &&
      heldDivisionRepresentatives(d.ocdId).length === 0);

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

  // The state turns on the governing bodies: an unwired advisory committee must neither turn "nothing is
  // scheduled" into a coverage gap nor mask a government's missing calendar.
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
