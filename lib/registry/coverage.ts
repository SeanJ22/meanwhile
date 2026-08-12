import type { Tier } from "../ocd/tiers.ts";

import { bodiesAt, type GeoFeature } from "./resolve.ts";
import type {
  Body,
  BodyClass,
  CoverageStatus,
  Division,
  DivisionType,
} from "./types.ts";

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
  divisionLabel: string;
  divisionType: DivisionType;
  bodyClass: BodyClass;
  coverageStatus: CoverageStatus;
  homepageUrl: string | null;
  tier: Tier;
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
}

export interface CoverageSummary {
  state: CoverageState;
  bodies: CoveredBody[];
  seats: Seat[];
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
  counts: { total: number; withSource: number; withoutSource: number };
}

/** Coverage statuses that mean a calendar is actually wired. */
const WIRED: ReadonlySet<CoverageStatus> = new Set<CoverageStatus>(["LIVE", "MANUAL"]);

const SEAT_TYPES: ReadonlySet<DivisionType> = new Set<DivisionType>([
  "cd",
  "sldu",
  "sldl",
]);

/**
 * Whether a municipal division came from the county-subdivision layer.
 *
 * Structural, not a name match: a cousub-derived identifier nests under its
 * county (`state:nh/county:merrimack/place:concord_city`) where a place-derived
 * one is flat (`state:nh/place:concord`). CLAUDE.md forbids joining on name
 * strings and this obeys that — it reads the identifier's shape, which the
 * generator controls, never the label.
 */
function isSubdivisionDerived(ocdId: string): boolean {
  return ocdId.includes("/county:");
}

/**
 * Drop the same government appearing twice.
 *
 * **This is a real defect in the registry, not a display quirk.** The build
 * reads every file in `public/geo`, which includes `cousub-*.geojson`, so New
 * Hampshire and New Jersey municipalities are ingested from both the place layer
 * and the county-subdivision layer. Concord NH is
 * `state:nh/place:concord` *and* `state:nh/county:merrimack/place:concord_city`
 * — one city, two divisions, two governing bodies. 32 of the registry's 153
 * municipal bodies are duplicates of this kind.
 *
 * The layer to keep is settled by what each state actually uses, which
 * `docs/state.md` §4.3 established from the Census files: Arizona's
 * municipalities are places and all 80 of its county subdivisions are
 * statistical; New Jersey's 564 municipalities are all county subdivisions; New
 * Hampshire's 222 towns are too. So where both layers produce a governing
 * division for the same point, the **subdivision** is the government and the
 * flat place row is the duplicate.
 *
 * Preferring the subdivision is also the only choice that keeps Rockaway
 * township distinct from Rockaway borough — two separate Morris County
 * municipalities that collapse onto one identifier under the flat form.
 *
 * **This is a stopgap at the read layer.** The real fix is 4.6.0: carry Census
 * `FUNCSTAT` and `CLASSFP` on the features so the duplicate is resolved once at
 * build time, nationally and from data rather than from a three-state
 * observation. Tracker M17. Dropping the flat rows here brings the three clip
 * counties to exactly the 74 general-purpose governments the 2022 Census of
 * Governments enumerates, which is what makes the rule credible rather than
 * convenient.
 */
export function dedupeMunicipal(
  divisions: Division[],
  bodies: Body[],
): { divisions: Division[]; bodies: Body[]; dropped: Division[] } {
  // The subdivision layer only wins where it actually carries a *government*.
  // Testing for a subdivision-derived division alone is not enough and gets
  // Arizona badly wrong: Tucson is covered by `county:pima/place:tucson_ccd`, a
  // statistical Census County Division with no government, and treating that as
  // evidence would drop the flat `place:tucson` — deleting the City of Tucson
  // and reporting downtown as unincorporated. So the test is whether the
  // subdivision row produced a body, which is the LSAD rule's answer to exactly
  // this question rather than a second guess at it.
  const governing = new Set(bodies.map((b) => b.ocdId));
  const hasSubdivisionGovernment = divisions.some(
    (d) =>
      d.divisionType === "place" &&
      isSubdivisionDerived(d.ocdId) &&
      governing.has(d.ocdId),
  );

  // Nothing to disambiguate: no municipal government here, or only one layer
  // produced one. Arizona lands here, correctly.
  if (!hasSubdivisionGovernment) {
    return { divisions, bodies, dropped: [] };
  }

  const dropped = divisions.filter(
    (d) => d.divisionType === "place" && !isSubdivisionDerived(d.ocdId),
  );
  const droppedIds = new Set(dropped.map((d) => d.ocdId));

  return {
    divisions: divisions.filter((d) => !droppedIds.has(d.ocdId)),
    bodies: bodies.filter((b) => !b.ocdId || !droppedIds.has(b.ocdId)),
    dropped,
  };
}

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
): CoverageSummary {
  const hit = bodiesAt(point, features, divisionsById, allBodies);
  const { divisions, bodies } = dedupeMunicipal(hit.divisions, hit.bodies);

  const covered: CoveredBody[] = bodies.map((body) => {
    const division = body.ocdId ? divisionsById.get(body.ocdId) : undefined;
    return {
      bodyId: body.id,
      ocdId: body.ocdId,
      // A body with no division is the Southeast Regional Council case: real,
      // hyperlocal, and not a division. Nothing populates that path yet.
      divisionLabel: division?.label ?? "",
      divisionType: division?.divisionType ?? "place",
      bodyClass: body.bodyClass,
      coverageStatus: body.coverageStatus,
      homepageUrl: body.homepageUrl,
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
    }));

  // Only claim "unincorporated" when a municipal-shaped division was actually
  // found and every one of them turned out to be statistical. No division at all
  // is a coverage gap, not a fact about the reader's government.
  const municipal = divisions.filter((d) => d.divisionType === "place");
  const municipalWithBody = new Set(
    covered.filter((b) => b.divisionType === "place").map((b) => b.ocdId),
  );
  const unincorporated =
    municipal.length > 0 && municipal.every((d) => !municipalWithBody.has(d.ocdId));

  const withSource = covered.filter((b) => WIRED.has(b.coverageStatus)).length;
  const withoutSource = covered.length - withSource;

  const state: CoverageState =
    meetingCount > 0
      ? "MEETINGS"
      : covered.length === 0
        ? "UNMAPPED"
        : withoutSource > 0
          ? "NO_SOURCE"
          : "NONE_SCHEDULED";

  return {
    state,
    bodies: covered,
    seats,
    unincorporated,
    counts: { total: covered.length, withSource, withoutSource },
  };
}
