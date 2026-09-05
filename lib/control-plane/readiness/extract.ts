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

/**
 * Which store the readiness publisher writes to (CC-F3). PRODUCTION is written
 * ONLY on an explicit `control-plane` target — the mere presence of the
 * production connection string never selects it. So a generic `readiness:refresh`
 * (no target, or `--target=file`) derives locally and cannot touch production,
 * even when `.env.local` carries the production URL. Pure and side-effect-free
 * so a test can pin it without constructing any database client.
 */
export type ReadinessStoreTarget = "file" | "control-plane";
export function chooseReadinessStoreTarget(target: string | undefined): ReadinessStoreTarget {
  return target === "control-plane" ? "control-plane" : "file";
}

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

/**
 * A STATE-SPECIFIC federal-finance reconciliation slice (CC-F5). The committed
 * FEC reconciliation is national; a state page may only show a state's own
 * matched/total, never the national counter. This is null when no deterministic
 * state slice exists (then the state renders a named gap, never the national N).
 */
export interface FecInstrument {
  /** THIS state's federal candidates reconciled to FEC. */
  readonly matched: number;
  readonly total: number;
  readonly authority: string;
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
  /** The capability this closed walk actually proves an absence FOR. A walk may
   *  never be projected onto a different capability (CC-F1). */
  readonly capabilityId: string;
  /** The date the absence argument expires; null = never expires. An expired
   *  walk cannot render ARGUED_ABSENT (CC-F1). */
  readonly expiresOn: string | null;
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
  /** INDEPENDENT external count of congressional districts (the cd119 geojson
   *  feature count), or null when no committed external denominator exists (CC-F2).
   *  Never the held registry count — that is the numerator, not an authority. */
  readonly cdUniverse: number | null;
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
  /**
   * The state's total population from the committed Census ACS 5-Year 2023
   * table (B01003, `data/reference/acs5_2023_b01003_state.csv`), the
   * EXTERNAL denominator of the population-weighted completeness figure
   * (ADM-23). Null when the table carries no row for the state, which is a
   * named gap and never a zero.
   */
  readonly statePopulation: number | null;
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

/**
 * True when a dated absence has expired as of `nowIso` (CC-F1). A null expiry
 * never expires; an undatable expiry is treated as expired — we do not render an
 * absence we cannot date.
 */
function isExpired(expiresOn: string | null, nowIso: string): boolean {
  if (expiresOn === null) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return true;
  return expiresOn < nowIso.slice(0, 10);
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
  nowIso: string,
): { coverage: Coverage; gates: Partial<Record<Gate, GateEvidence>> } {
  const c = a.counts;
  const isAz = a.code === "az";

  switch (capabilityId) {
    /* ---------------- Districts and geography: held boundaries ---------------- */
    case "districts.congressional": {
      const held_ = a.heldDivisions.cd ?? 0;
      // The denominator is the INDEPENDENT cd119 feature count (external), never
      // the held count (CC-F2). No external count → named gap.
      const universe = a.cdUniverse;
      if (universe === null || universe <= 0 || a.divisionsAsOf === null) {
        return { coverage: coverageGap(), gates: {} };
      }
      return {
        coverage: coverageFrac(held_, universe, "Census 119th-Congress cartographic boundary (cd119) feature count", a.divisionsAsOf),
        gates: heldBoundary(held_, universe, a.divisionsAsOf),
      };
    }
    case "districts.state-legislative":
      // No committed STATEWIDE count of legislative districts exists — the
      // sldu/sldl geojson are county-clipped, not a statewide universe — so a
      // coverage fraction would be a self-denominator (CC-F2). Named gap, and no
      // gate may claim completeness against a universe we cannot establish.
      return { coverage: coverageGap(), gates: {} };
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
      const w = a.officialsClosedWalk;
      // ARGUED_ABSENT ONLY from a closed walk that is FOR THIS capability and is
      // UNEXPIRED (CC-F1). A candidate-field absence (a missing verifiedPage for
      // one candidacy) proves nothing about officials/seats and must never be
      // projected here; nor may an expired absence render as current.
      if (
        w &&
        w.capabilityId === "officials.state-federal-seats" &&
        !isExpired(w.expiresOn, nowIso)
      ) {
        return {
          coverage: coverageGap(),
          gates: { ACQUIRED: closedWalk(w.ref, w.asOf), VERIFIED: closedWalk(w.ref, w.asOf) },
        };
      }
      // No correctly-scoped, unexpired officials instrument on current main.
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
      // The committed FEC reconciliation is NATIONAL and its absences carry no
      // state, so no deterministic state slice exists; a.fec is populated only
      // when a genuine STATE slice is available (CC-F5). Never show the national
      // denominator as this state's own — a named state gap instead.
      const f = a.fec;
      if (f && f.total > 0) {
        return {
          coverage: coverageFrac(f.matched, f.total, f.authority, f.asOf),
          gates: {
            SOURCE_KNOWN: frac(f.total, f.total, f.asOf, RECONCILE_STALE_DAYS),
            ACQUIRED: frac(f.total, f.total, f.asOf, RECONCILE_STALE_DAYS),
            VERIFIED: frac(f.matched, f.total, f.asOf, RECONCILE_STALE_DAYS),
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

/**
 * Meetings capability from a level's governing-body statistics.
 *
 * The registry `coverageStatus` contract (lib/registry/types.ts) says LIVE means
 * "an adapter reads this body's calendar today" and MANUAL "hand-entered from a
 * source someone read" — a source/route that is KNOWN, NOT canonical agenda
 * material that is held/vaulted. So these support SOURCE_KNOWN only; ACQUIRED
 * stays NOT_WALKED until it derives from an actual held-agenda instrument
 * (CC-F4). `stat.asOf` is the body's registration date, which is honest for
 * "source known", not for material acquisition.
 */
function meetingsCap(
  stat: BodyLevelStat,
  total: number | null,
  authority: string,
): { coverage: Coverage; gates: Partial<Record<Gate, GateEvidence>> } {
  if (total === null) return { coverage: coverageGap(), gates: {} };
  if (stat.asOf === null || stat.sourceLocated <= 0) {
    return { coverage: coverageFrac(0, total, `${CENSUS} (${authority}: sources located)`, null), gates: {} };
  }
  return {
    coverage: coverageFrac(stat.sourceLocated, total, `${CENSUS} (${authority}: sources located)`, stat.asOf),
    gates: {
      // A source is LOCATED for these bodies (registry LIVE / KNOWN_UNCOVERED).
      SOURCE_KNOWN: frac(stat.sourceLocated, total, stat.asOf, STRUCTURAL_STALE_DAYS),
      // ACQUIRED is deliberately omitted → NOT_WALKED: registry source-status is
      // not held agenda material, and no held-material instrument is wired here.
    },
  };
}

/** Build one capability input from its taxonomy row + derived evidence. */
function capabilityInput(
  row: (typeof CAPABILITY_TAXONOMY)[number],
  a: StateAuthorities,
  nowIso: string,
): CapabilityInput {
  const { coverage, gates } = deriveCapability(row.capabilityId, a, nowIso);
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
/**
 * **POPULATION IN A READER-COMPLETE ZIP, OF THE STATE'S POPULATION.**
 * (ADM-23, the 9.4.26 evening admin feedback.)
 *
 * The numerator sums the ACS population of every researched ZIP whose
 * governing bodies are ALL resolved (CURRENT or ARGUED_ABSENT — the same
 * worst-of rule `computeZipRow` applies); the denominator is the Bureau's
 * state total, external to us. Until a ZIP is complete the figure is
 * honestly 0 of the state — a measured zero, which is a different fact from
 * "not on file". Three named gaps, never a zero standing in for them:
 * no state total on file; no researched ZIP; every researched ZIP without a
 * tabulation area.
 */
export function populationInCompleteZip(a: StateAuthorities, zips: ReadinessInputs["zips"]): Held<Measured> {
  if (a.statePopulation === null) {
    return gap<Measured>("OURS", `no state population on file for ${a.name} in data/reference/acs5_2023_b01003_state.csv, so a population-weighted completeness cannot be computed`);
  }
  if (zips.length === 0) return gap<Measured>("OURS", `no ZIP has been researched in ${a.name} yet, so no population can be counted as complete`);
  const withPopulation = zips.filter((z) => z.population.held);
  if (withPopulation.length === 0) {
    return gap<Measured>("OURS", `none of the ${zips.length} researched ZIP(s) in ${a.name} has a Census tabulation area on file, so no population can be counted`);
  }
  const resolved = (state: string) => state === "CURRENT" || state === "ARGUED_ABSENT";
  const complete = withPopulation.filter((z) => z.bodies.length > 0 && z.bodies.every((b) => resolved(b.state)));
  const value = complete.reduce((n, z) => n + (z.population.held ? z.population.value.value : 0), 0);
  return held(
    measured(
      Math.min(value, a.statePopulation),
      a.statePopulation,
      `residents of researched ZIPs whose every governing body is resolved (${complete.length} of ${withPopulation.length} researched ZIP(s) with a population on file), of the state's ACS 5-Year 2023 total population`,
      "Census ACS 5-Year 2023 B01003 (data/reference/acs5_2023_b01003_state.csv and _zcta.csv)",
    ),
  );
}

export function deriveStateInputs(
  a: StateAuthorities,
  meta: { readonly nowIso: string; readonly sha: string | null; readonly publisher: string },
  zips: ReadinessInputs["zips"],
): ReadinessInputs {
  const capabilities = CAPABILITY_TAXONOMY.map((row) => capabilityInput(row, a, meta.nowIso));

  // Reader-visible jurisdictions is a named gap: "reader-visible" requires
  // SHOWN_TO_READER proof, which is NOT_WALKED everywhere on current main (no
  // committed per-capability delivery record), and a held count is not a
  // reader-visible count nor an external denominator (CC-F2).
  const readerVisibleJurisdictions: Held<Measured> = gap<Measured>(
    "OURS",
    `no committed proof that any ${a.name} jurisdiction is delivered to a reader — SHOWN_TO_READER is NOT_WALKED — so a reader-visible count cannot be asserted`,
  );

  // Project the officials walk ONLY when it passes the SAME capability+expiry
  // guard as the gate (CC-F1): a mis-scoped or expired walk that reads NOT_WALKED
  // must not be shipped as an orphan into evidenceWalks — the record holds only
  // walks a rendered cell actually references.
  const ow = a.officialsClosedWalk;
  const officialsWalkUsable =
    ow !== null &&
    ow.capabilityId === "officials.state-federal-seats" &&
    !isExpired(ow.expiresOn, meta.nowIso);
  const evidenceWalks: EvidenceWalk[] = officialsWalkUsable ? [ow.walk] : [];

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
    populationInCompleteZip: populationInCompleteZip(a, zips),
    // No full readiness pass is recorded as an instrument yet — a named gap, not "0 days".
    timeSinceLastFullPass: gap<string>("OURS", `no full readiness pass is recorded for ${a.name} yet`),
  };
}
