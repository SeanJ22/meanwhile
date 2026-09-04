/**
 * **DERIVE READINESS INPUTS FROM COMMITTED INSTRUMENTS — pure, no fs, no db, no clock-read.**
 * (Control-centre resource-safety closure, 2026-09-04. Closes the R-H gap: R-H
 * said the snapshot is derived, never authored, but the publisher still
 * hand-authored the gate evidence, counts and dates.)
 *
 * Every gate cell now traces to a real, current-main instrument or it is
 * NOT_WALKED. The rule is the same one the whole product runs on: absence is
 * argued, never asserted, and a gate we cannot prove from an instrument is
 * "we have not looked", never a typed-in success.
 *
 * ## capability × gate → instrument (what exists on current main)
 *
 * ```
 *   SOURCE_KNOWN / ACQUIRED   held records:
 *                               districts  -> registry divisions of the type
 *                               meetings   -> registry governing bodies at the level
 *                                             (coverageStatus: LIVE = agendas pulled,
 *                                              KNOWN_UNCOVERED/LIVE = a source located)
 *                             as-of read from each record's provenance.collectedAt.
 *   VERIFIED                  an EXTERNAL reconciliation, never our own parser:
 *                               finance.federal-fec        -> data/fec (matchReport)
 *                               ballot.candidate-filings   -> AZ certified-lineup recon
 *                               finance.state-disclosure   -> AZ SeeTheMoney recon
 *                             and a recorded CLOSED WALK renders ARGUED_ABSENT
 *                               officials.state-federal-seats (NH/NJ argued absences)
 *   SHOWN_TO_READER           NO committed per-capability production-served
 *                             record exists on current main (the served state is
 *                             runtime-only in Neon; a localhost render is not
 *                             proof of delivery). -> NOT_WALKED, everywhere.
 *   ASK_ANSWERS               committed grounded-Ask records are keyed by
 *                             zip/question, not per capability. -> NOT_WALKED.
 * ```
 *
 * A gate with no instrument is simply omitted from the map, and
 * `deriveGateCells` fills it NOT_WALKED. Denominators are the external Census of
 * Governments counts (R-D); a class with no legitimately-established external
 * denominator renders a named gap, never "we found N therefore N of N".
 */
import { gap, held, measured, type Held, type Measured } from "../owner-surface.ts";
import { CAPABILITY_TAXONOMY } from "./catalog.ts";
import type { Gate, GateEvidence } from "./gates.ts";
import type { CapabilityInput, ReadinessInputs } from "./compute.ts";
import type { EvidenceWalk } from "./model.ts";

/* Freshness thresholds by kind of record (R-G). Structural facts (boundaries,
 * body registration) change rarely; external reconciliations run on a cadence. */
export const STRUCTURAL_STALE_DAYS = 365;
export const RECONCILE_STALE_DAYS = 45;

const CENSUS = "Census of Governments 2022";

/* ------------------------------------------------------------- instrument shapes */

/** Per-level governing-body statistics, already tallied from the registry. */
export interface BodyLevelStat {
  /** Bodies with a source located at all (coverageStatus LIVE or KNOWN_UNCOVERED). */
  readonly sourceLocated: number;
  /** Bodies whose agendas are actually pulled (coverageStatus LIVE). */
  readonly live: number;
  /** Newest provenance.collectedAt (YYYY-MM-DD) across the level's bodies, or null. */
  readonly asOf: string | null;
}

/** The FEC reconciliation, read from data/fec/fec-2026.json `matchReport`. */
export interface FecInstrument {
  readonly ballotMatched: number;
  readonly ballotTotal: number;
  readonly rosterMatched: number;
  readonly rosterTotal: number;
  /** ISO date of the fetch — read from the record, not typed. */
  readonly asOf: string;
}

/** A generic external reconciliation: covered of a stated external universe. */
export interface ReconInstrument {
  readonly covered: number;
  readonly total: number;
  readonly authority: string;
  readonly asOf: string;
}

/** A recorded CLOSED walk that argues an absence (R-I). */
export interface ClosedWalkInstrument {
  readonly ref: string;
  readonly asOf: string;
  readonly walk: EvidenceWalk;
}

/**
 * Everything one state's readiness is derived FROM. The publisher tallies these
 * from committed files; this module never touches the filesystem.
 */
export interface StateAuthorities {
  readonly code: string;
  readonly name: string;
  /** Census of Governments counts: COUNTY, CITY_OR_TOWN, SCHOOL_DISTRICT, SPECIAL_DISTRICT, ... */
  readonly counts: Record<string, number>;
  /** Held registry divisions by divisionType (cd, county, school_district, sldu, ...). */
  readonly heldDivisions: Record<string, number>;
  /** Newest provenance.collectedAt across held divisions (YYYY-MM-DD), or null. */
  readonly divisionsAsOf: string | null;
  readonly bodies: {
    readonly county: BodyLevelStat;
    readonly place: BodyLevelStat;
    readonly school: BodyLevelStat;
  };
  readonly fec: FecInstrument | null;
  readonly ballotFilings: ReconInstrument | null;
  readonly stateDisclosure: ReconInstrument | null;
  /** A NH/NJ closed argued-absence walk behind officials.state-federal-seats. */
  readonly officialsClosedWalk: ClosedWalkInstrument | null;
}

/* ------------------------------------------------------------- gate helpers */

/** A fraction gate cell: covered of total, established at `asOf`. */
function frac(covered: number, total: number, asOf: string | null, staleAfterDays: number): GateEvidence {
  return { covered, total, asOf, staleAfterDays, walkClosed: false, blockedReason: null, gatedReason: null, evidenceRef: null };
}

/** A closed-walk gate cell → ARGUED_ABSENT (R-I). */
function closedWalk(ref: string, asOf: string): GateEvidence {
  return { covered: 0, total: 0, asOf, staleAfterDays: null, walkClosed: true, blockedReason: null, gatedReason: null, evidenceRef: ref };
}

/** SOURCE_KNOWN + ACQUIRED for a held boundary set of a known, complete universe. */
function heldBoundary(
  held_: number,
  universe: number,
  asOf: string | null,
): Partial<Record<Gate, GateEvidence>> {
  if (asOf === null || universe <= 0) return {};
  return {
    // The source (a complete Census cartographic set) is known for the whole universe.
    SOURCE_KNOWN: frac(universe, universe, asOf, STRUCTURAL_STALE_DAYS),
    // We hold `held_` of the `universe` boundaries.
    ACQUIRED: frac(Math.min(held_, universe), universe, asOf, STRUCTURAL_STALE_DAYS),
  };
}

/* ------------------------------------------------------------- coverage cells */

/** A capability's coverage phrase + fraction inputs, or a named-gap denominator. */
interface Coverage {
  readonly covered: number;
  readonly total: number | null;
  readonly authority: string | null;
  readonly label: string;
  readonly asOf: string | null;
}

function coverageFrac(covered: number, total: number, authority: string, asOf: string | null): Coverage {
  return { covered: Math.min(covered, total), total, authority, label: `${Math.min(covered, total)} of ${total}`, asOf };
}
function coverageGap(): Coverage {
  return { covered: 0, total: null, authority: null, label: "no external denominator", asOf: null };
}

/* ------------------------------------------------------------- the derivation */

/**
 * A capability's derived coverage + gate evidence. Anything not returned here is
 * NOT_WALKED by construction (deriveGateCells fills the gap).
 */
function deriveCapability(
  capabilityId: string,
  a: StateAuthorities,
): { coverage: Coverage; gates: Partial<Record<Gate, GateEvidence>> } {
  const c = a.counts;
  const isAz = a.code === "az";

  switch (capabilityId) {
    /* ---------------- Districts and geography: held boundaries ---------------- */
    case "districts.congressional": {
      const held_ = a.heldDivisions.cd ?? 0;
      // cd119 is the complete apportioned set; the held count is the universe.
      if (held_ <= 0 || a.divisionsAsOf === null) return { coverage: coverageGap(), gates: {} };
      return {
        coverage: coverageFrac(held_, held_, "Census 119th-Congress cartographic boundary (cd119, complete set)", a.divisionsAsOf),
        gates: heldBoundary(held_, held_, a.divisionsAsOf),
      };
    }
    case "districts.state-legislative": {
      const held_ = a.heldDivisions.sldu ?? 0;
      if (held_ <= 0 || a.divisionsAsOf === null) return { coverage: coverageGap(), gates: {} };
      return {
        coverage: coverageFrac(held_, held_, "Census legislative district boundaries (sldu, complete set)", a.divisionsAsOf),
        gates: heldBoundary(held_, held_, a.divisionsAsOf),
      };
    }
    case "districts.county-precinct": {
      const total = c.COUNTY ?? null;
      const held_ = a.heldDivisions.county ?? 0;
      if (total === null) return { coverage: coverageGap(), gates: {} };
      return {
        coverage: coverageFrac(held_, total, `${CENSUS} (counties; precincts not held)`, a.divisionsAsOf),
        gates: heldBoundary(held_, total, a.divisionsAsOf),
      };
    }
    case "districts.school": {
      const total = c.SCHOOL_DISTRICT ?? null;
      const held_ = a.heldDivisions.school_district ?? 0;
      if (total === null) return { coverage: coverageGap(), gates: {} };
      return {
        coverage: coverageFrac(held_, total, CENSUS, a.divisionsAsOf),
        gates: heldBoundary(held_, total, a.divisionsAsOf),
      };
    }
    case "districts.municipal-wards": {
      // We hold PLACE boundaries, not ward boundaries. No wards held -> NOT_WALKED.
      const total = c.CITY_OR_TOWN ?? null;
      if (total === null) return { coverage: coverageGap(), gates: {} };
      return { coverage: coverageFrac(0, total, `${CENSUS} (municipal wards; none held)`, null), gates: {} };
    }
    case "districts.special": {
      const total = c.SPECIAL_DISTRICT ?? null;
      if (total === null) return { coverage: coverageGap(), gates: {} };
      return { coverage: coverageFrac(0, total, CENSUS, null), gates: {} };
    }

    /* ---------------- Officials: no committed roster instrument (except walks) ---------------- */
    case "officials.state-federal-seats": {
      if (a.officialsClosedWalk) {
        const w = a.officialsClosedWalk;
        return {
          coverage: coverageGap(),
          gates: {
            // A source was known and the ladder was walked to a closed absence.
            ACQUIRED: closedWalk(w.ref, w.asOf),
            VERIFIED: closedWalk(w.ref, w.asOf),
          },
        };
      }
      // No committed per-state officials-roster count/proof -> NOT_WALKED.
      return { coverage: coverageGap(), gates: {} };
    }
    case "officials.county":
    case "officials.municipal":
    case "officials.school-board":
    case "officials.special-district-boards":
      // Registry bodies are meeting/governing bodies, not official rosters; no
      // committed roster instrument on current main -> NOT_WALKED.
      return { coverage: coverageGap(), gates: {} };

    /* ---------------- Elections and ballot ---------------- */
    case "ballot.candidate-filings": {
      if (isAz && a.ballotFilings) {
        const r = a.ballotFilings;
        return {
          coverage: coverageFrac(r.covered, r.total, r.authority, r.asOf),
          gates: {
            SOURCE_KNOWN: frac(r.total, r.total, r.asOf, RECONCILE_STALE_DAYS),
            ACQUIRED: frac(r.total, r.total, r.asOf, RECONCILE_STALE_DAYS),
            VERIFIED: frac(r.covered, r.total, r.asOf, RECONCILE_STALE_DAYS),
          },
        };
      }
      return { coverage: coverageGap(), gates: {} };
    }
    case "ballot.statewide-propositions":
    case "ballot.local-measures":
    case "ballot.certified-results":
      return { coverage: coverageGap(), gates: {} };

    /* ---------------- Campaign finance ---------------- */
    case "finance.federal-fec": {
      if (a.fec) {
        const f = a.fec;
        return {
          coverage: coverageFrac(f.ballotMatched, f.ballotTotal, "FEC (bulk + API), our ballot reconciled to FEC filings", f.asOf),
          gates: {
            SOURCE_KNOWN: frac(f.ballotTotal, f.ballotTotal, f.asOf, RECONCILE_STALE_DAYS),
            ACQUIRED: frac(f.ballotTotal, f.ballotTotal, f.asOf, RECONCILE_STALE_DAYS),
            // VERIFIED against the external FEC authority: ballot candidates matched.
            VERIFIED: frac(f.ballotMatched, f.ballotTotal, f.asOf, RECONCILE_STALE_DAYS),
          },
        };
      }
      return { coverage: coverageGap(), gates: {} };
    }
    case "finance.state-disclosure": {
      if (isAz && a.stateDisclosure) {
        const r = a.stateDisclosure;
        return {
          coverage: coverageFrac(r.covered, r.total, r.authority, r.asOf),
          gates: {
            SOURCE_KNOWN: frac(r.total, r.total, r.asOf, RECONCILE_STALE_DAYS),
            ACQUIRED: frac(r.total, r.total, r.asOf, RECONCILE_STALE_DAYS),
            VERIFIED: frac(r.covered, r.total, r.asOf, RECONCILE_STALE_DAYS),
          },
        };
      }
      return { coverage: coverageGap(), gates: {} };
    }
    case "finance.county-committees":
    case "finance.municipal":
      return { coverage: coverageGap(), gates: {} };

    /* ---------------- Meetings and agendas: registry governing bodies ---------------- */
    case "meetings.county-boards":
      return meetingsCap(a.bodies.county, c.COUNTY ?? null, "county clerk agendas");
    case "meetings.city-councils":
      return meetingsCap(a.bodies.place, c.CITY_OR_TOWN ?? null, "city clerk agendas");
    case "meetings.school-boards":
      return meetingsCap(a.bodies.school, c.SCHOOL_DISTRICT ?? null, "district clerk agendas");
    case "meetings.planning-zoning":
      // Planning/zoning bodies are not separated in the registry -> NOT_WALKED.
      return { coverage: coverageGap(), gates: {} };

    default:
      return { coverage: coverageGap(), gates: {} };
  }
}

/** Meetings capability from a level's governing-body statistics. */
function meetingsCap(
  stat: BodyLevelStat,
  total: number | null,
  authority: string,
): { coverage: Coverage; gates: Partial<Record<Gate, GateEvidence>> } {
  if (total === null || stat.asOf === null || stat.sourceLocated <= 0) {
    return { coverage: total === null ? coverageGap() : coverageFrac(stat.live, total, `${CENSUS} (${authority})`, stat.asOf), gates: {} };
  }
  return {
    coverage: coverageFrac(stat.live, total, `${CENSUS} (${authority})`, stat.asOf),
    gates: {
      // A source is located for the bodies that are LIVE or KNOWN_UNCOVERED.
      SOURCE_KNOWN: frac(stat.sourceLocated, total, stat.asOf, STRUCTURAL_STALE_DAYS),
      // Acquired = agendas actually pulled (LIVE).
      ACQUIRED: frac(stat.live, total, stat.asOf, STRUCTURAL_STALE_DAYS),
    },
  };
}

/** Build one capability input from its taxonomy row + derived evidence. */
function capabilityInput(row: (typeof CAPABILITY_TAXONOMY)[number], a: StateAuthorities): CapabilityInput {
  const { coverage, gates } = deriveCapability(row.capabilityId, a);
  return {
    capabilityId: row.capabilityId,
    domain: row.domain,
    label: row.label,
    level: row.level,
    coverage: {
      covered: coverage.covered,
      total: coverage.total,
      authority: coverage.authority,
      contract: `${row.label} coverage over its external universe`,
      label: coverage.label,
      asOf: coverage.asOf,
    },
    gates,
  };
}

/**
 * Derive the whole set of readiness inputs for one state, purely from its
 * committed instruments. `nowIso`/`sha`/`publisher` are carried through; the
 * summary figures are derived (or named gaps) — never authored.
 */
export function deriveStateInputs(
  a: StateAuthorities,
  meta: { readonly nowIso: string; readonly sha: string | null; readonly publisher: string },
  zips: ReadinessInputs["zips"],
): ReadinessInputs {
  const capabilities = CAPABILITY_TAXONOMY.map((row) => capabilityInput(row, a));

  // Reader-visible jurisdictions: held congressional districts over their
  // complete external set, when we actually hold them; else a named gap.
  const cd = a.heldDivisions.cd ?? 0;
  const readerVisibleJurisdictions: Held<Measured> =
    cd > 0
      ? held(measured(cd, cd, `${a.name} congressional districts held over the cd119 set`, "Census cd119 (complete set)"))
      : gap<Measured>("OURS", `${a.name} congressional districts are not held, so none are reader-visible yet`);

  const evidenceWalks: EvidenceWalk[] = a.officialsClosedWalk ? [a.officialsClosedWalk.walk] : [];

  return {
    state: a.code,
    stateName: a.name,
    publishedAt: meta.nowIso,
    publishedFromSha: meta.sha,
    publisher: meta.publisher,
    capabilities,
    zips,
    evidenceWalks,
    readerVisibleJurisdictions,
    // Population weighting needs Census ACS B01003, not yet ingested — a named gap.
    populationInCompleteZip: gap<Measured>(
      "OURS",
      "population not on file — Census ACS (B01003) not yet ingested, so a population-weighted completeness cannot be computed",
    ),
    // No full readiness pass is recorded as an instrument yet — a named gap, not "0 days".
    timeSinceLastFullPass: gap<string>("OURS", `no full readiness pass is recorded for ${a.name} yet`),
  };
}
