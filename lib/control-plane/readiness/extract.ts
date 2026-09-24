/**
 * **DERIVE READINESS INPUTS FROM COMMITTED INSTRUMENTS — pure, no fs, no db, no clock-read.**
 * (Control-centre resource-safety closure, 2026-09-04, closing the R-H gap.
 * Rewritten 2026-09-06 for ADM-40 / §9A.9: the Admin was contradicting the
 * live product.)
 *
 * ## The failure this module was rewritten to end
 *
 * The owner, reading the grid on 2026-09-06:
 *
 * > *"we have candidate listings in New Hampshire and New Jersey on the site.
 * > Live right now. So saying that we don't have candidate filings for state or
 * > anything like that, that doesn't make any sense at all. We also absolutely
 * > have federal FEC campaign finance, and it's blank across the board. But if I
 * > go to like Mark Kelly, who is a senator, it shows very detailed information
 * > on money."*
 *
 * Every one of those cells was blank because this module had no instrument
 * wired to the holding that the Reader was, at that moment, rendering from.
 * `data/states/nh/ballot/nh-merrimack-2026.json` holds 47 candidacies sourced
 * to `sos.nh.gov`; `data/fec/fec-2026.json` carries each candidate's own
 * `state` and each absence's state-bearing `targetKey`. Nothing was missing
 * except the derivation. A blank cell that reads as "we have nothing" while
 * the product serves the thing is a false claim about our own holdings, and it
 * is the same class of failure as a false claim about a government.
 *
 * The fix is NOT to turn cells green. §9A.9 asks for seven distinguishable
 * facts and this module now derives all seven:
 *
 * ```
 *   canonical data exists   a committed holding with rows for this state
 *   acquired                records pulled and committed, with an as-of
 *   formally verified       reconciled against an EXTERNAL authority
 *   shown to Reader         the holding is a declared, trace-checked input to
 *                           a named Reader surface  (PARTIAL_OR_STALE, said)
 *   Ask can answer          …and one of those surfaces is grounded Ask
 *   proof is stale          complete but past its freshness threshold
 *   proof never run         NOT_WALKED — nobody looked; no claim either way
 * ```
 *
 * ## capability × gate → instrument (what exists on current main)
 *
 * ```
 *   SOURCE_KNOWN   a named, observed publisher path behind the records held:
 *                    districts    -> registry divisions of the type, against an
 *                                    external Census / cartographic universe
 *                    ballot       -> the government filing document every held
 *                                    candidacy cites (§8: an official
 *                                    government source is sufficient authority
 *                                    evidence; no second publisher is required)
 *                    finance      -> the FEC lookup / the state disclosure route
 *                    meetings     -> registry governing bodies at the level
 *   ACQUIRED       records pulled and committed with an as-of:
 *                    districts    -> held boundaries of the external universe
 *                    ballot       -> held candidacies / measure questions
 *                    finance      -> held FEC filings; held disclosure records
 *                    meetings     -> bodies with at least one HELD meeting in
 *                                    data/meetings-snapshot.json (CC-F4 is
 *                                    superseded: held agenda material now
 *                                    exists, and registry status is still not
 *                                    what establishes it)
 *   VERIFIED       an EXTERNAL reconciliation, never our own parser:
 *                    finance.federal-fec      -> every federal candidacy on the
 *                                                state's ballot resolved at the
 *                                                FEC (a filing, or a recorded
 *                                                absence with the FEC search
 *                                                that established it)
 *                    ballot.candidate-filings -> AZ certified-lineup recon
 *                    finance.state-disclosure -> AZ SeeTheMoney recon
 *                  and a recorded CLOSED WALK renders ARGUED_ABSENT — including
 *                  a government's own statement that the thing does not exist.
 *   SHOWN_TO_READER / ASK_ANSWERS
 *                  the state's canonical holding for the capability is a
 *                  DECLARED reader input: `lib/holdings/datasets.ts` names the
 *                  reader surfaces for its path, and `lib/holdings/reader-trace.ts`
 *                  names the reader routes whose deployment traces must contain
 *                  it. That is a standing contract, not a rendered-row readback,
 *                  so it renders PARTIAL_OR_STALE saying
 *                  "Shown on the Reader · verification proof needs a fresh
 *                  check" — never CURRENT, and never blank.
 * ```
 *
 * A gate with no instrument is simply omitted from the map, and
 * `deriveGateCells` fills it NOT_WALKED. Denominators are external where one
 * exists (R-D); a class with no legitimately-established external denominator
 * renders a named gap with the count it does hold beside it, never
 * "we found N therefore N of N".
 */
import { gap, held, measured, type Held, type Measured } from "../owner-surface.ts";
import { CAPABILITY_TAXONOMY } from "./catalog.ts";
import { NO_EVIDENCE, type Gate, type GateEvidence, type PendingProof } from "./gates.ts";
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
 * HELD agenda material at one level, from `data/meetings-snapshot.json` — the
 * same normalized snapshot `/api/meetings` serves. This is the instrument CC-F4
 * said did not exist on 2026-09-04; it does, and registry `coverageStatus` is
 * still not what establishes it. `bodies` is the count of DISTINCT governing
 * bodies at this level with at least one meeting in the snapshot.
 */
export interface HeldAgendaStat {
  readonly bodies: number;
  readonly meetings: number;
  /** The snapshot's own generatedAt date, or null when nothing is held. */
  readonly asOf: string | null;
}

/**
 * A STATE-SPECIFIC federal-finance slice (CC-F5, corrected 2026-09-06).
 *
 * The 2026-09-04 note said "the committed FEC reconciliation is national and
 * its absences carry no state, so no deterministic state slice exists". That
 * was FALSE at the record level and it is why Federal · FEC rendered blank for
 * every state while the Reader showed a senator's filings in full:
 * `data/fec/fec-2026.json` gives every candidate its own `state`, and every
 * absence a `targetKey` of the form `ballot-<state>-<county>:…` plus a reason
 * naming the office as `NJ-S` / `NH-H02`. Both are deterministic state keys.
 * The national counter is still never shown as a state's own.
 */
export interface FecInstrument {
  /** THIS state's federal candidacies whose FEC filings are held. */
  readonly matched: number;
  /** …of this state's federal candidacies looked up at the FEC. Every one not
   *  in `matched` carries a recorded absence with the FEC search behind it. */
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

/**
 * The candidate filings a state's committed ballot holdings actually carry.
 *
 * §8 of the Admin C brief is binding here: *an official responsible-government
 * source is sufficient authority evidence for facts that government is
 * competent to state*, and *do not display an arbitrary "needs second
 * publisher" requirement as though it were project law*. A Secretary of State's
 * cumulative filing and a County Clerk's filed-candidate list are exactly such
 * sources. What they do NOT give is a published count of how many candidacies
 * exist statewide, so the coverage fraction stays a named gap while the counts
 * and the authority go on the face.
 */
export interface BallotFilingInstrument {
  /** Candidacy rows held for this state. */
  readonly candidacies: number;
  /** …of which carry a named government source document. */
  readonly sourced: number;
  readonly contests: number;
  /** How many distinct filing documents those rows cite. */
  readonly documents: number;
  /** The publishing authorities, e.g. "New Hampshire Secretary of State". */
  readonly authority: string;
  /** True when every cited document is on a .gov host or an established
   *  official government publication platform (§8). */
  readonly officialSource: boolean;
  readonly asOf: string;
}

/** Ballot measures at one scope: contests known, question text acquired. */
export interface MeasureInstrument {
  readonly contests: number;
  readonly acquired: number;
  readonly authority: string;
  readonly asOf: string;
}

/**
 * A government's own statement that a thing does not exist, with the document
 * that says it. Stronger than a walk we closed ourselves, and treated as a
 * closed walk by the gate logic (R-I) — with the authority's sentence carried
 * through so the drawer shows the argument rather than a generic phrase.
 */
export interface SourcedAbsence {
  readonly capabilityId: string;
  readonly statement: string;
  readonly authority: string;
  readonly ref: string;
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
 * **THE READER-DELIVERY INSTRUMENT** (§9A.9, ADM-40).
 *
 * One committed holding, the rows it carries for this state, and the Reader
 * surfaces and routes the canonical system DECLARES for its path. It is derived
 * from two independent declarations that already govern this repository:
 *
 *  - `lib/holdings/datasets.ts` `DATASET_FAMILIES` maps a holdings path to the
 *    reader surfaces that render it. `validateDatasetMapping` fails the build
 *    if a declared surface or consumer module does not exist.
 *  - `lib/holdings/reader-trace.ts` `readerTraceRequirements` maps a reader
 *    ROUTE to the exact files its loader must be able to read, and
 *    `checkReaderTraces` fails when Next's emitted deployment trace for that
 *    route does not contain the file.
 *
 * What that pair proves: this state's rows are in a file the deployed Reader
 * route is contractually required to be able to read. What it does NOT prove:
 * that a given row rendered for a given reader at a given moment, or that
 * stated N equalled rendered rows. So the gate reads PARTIAL_OR_STALE and says
 * so in words. It is a standing declaration, and the honest sentence for a
 * standing declaration is that the proof needs a fresh check — not "no data",
 * and not an empty cell.
 */
export interface ReaderDelivery {
  readonly capabilityId: string;
  /** The canonical holdings path, e.g. "data/states/nh/ballot/nh-merrimack-2026.json". */
  readonly holding: string;
  /** Rows in that holding attributable to this state. Zero means no delivery. */
  readonly rows: number;
  /** What a row is, e.g. "candidacies". */
  readonly unit: string;
  /** Declared reader surfaces, e.g. ["ballot", "ask"]. */
  readonly surfaces: readonly string[];
  /** Declared reader routes whose deployment traces must carry this file. */
  readonly routes: readonly string[];
  /** True when grounded Ask is one of the declared surfaces or routes. */
  readonly askAnswers: boolean;
  readonly asOf: string | null;
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
  /** HELD agenda material per level, from the served meetings snapshot. */
  readonly heldAgendas: {
    readonly county: HeldAgendaStat;
    readonly place: HeldAgendaStat;
    readonly school: HeldAgendaStat;
  };
  readonly fec: FecInstrument | null;
  /** What the state's committed ballot holdings carry (all states, not just AZ). */
  readonly ballotFilings: BallotFilingInstrument | null;
  /** An EXTERNAL reconciliation of those filings, where one exists (AZ). */
  readonly ballotVerification: ReconInstrument | null;
  readonly statewideMeasures: MeasureInstrument | null;
  readonly localMeasures: MeasureInstrument | null;
  /** Held state-disclosure finance records against the candidacies in scope. */
  readonly stateDisclosure: ReconInstrument | null;
  /** An EXTERNAL reconciliation of those records, where one exists (AZ). */
  readonly stateDisclosureVerification: ReconInstrument | null;
  /** A NH/NJ closed argued-absence walk behind officials.state-federal-seats. */
  readonly officialsClosedWalk: ClosedWalkInstrument | null;
  /** Governments' own statements that a class does not exist in this state. */
  readonly sourcedAbsences: readonly SourcedAbsence[];
  /** What the Reader is declared to be served, per capability. */
  readonly delivery: readonly ReaderDelivery[];
  /**
   * The state's total population from the committed Census ACS 5-Year 2024
   * table (B01003, `data/reference/acs5_2024_b01003_state.csv`), the
   * EXTERNAL denominator of the population-weighted completeness figure
   * (ADM-23). Null when the table carries no row for the state, which is a
   * named gap and never a zero.
   */
  readonly statePopulation: number | null;
}

/* ------------------------------------------------------------- gate helpers */

/** A fraction gate cell: covered of total, established at `asOf`. */
function frac(covered: number, total: number, asOf: string | null, staleAfterDays: number, of?: string): GateEvidence {
  return { ...NO_EVIDENCE, covered, total, asOf, staleAfterDays, of: of ?? null };
}

/** A closed-walk gate cell → ARGUED_ABSENT (R-I). */
function closedWalk(ref: string, asOf: string, statement?: string): GateEvidence {
  return { ...NO_EVIDENCE, asOf, walkClosed: true, evidenceRef: ref, absenceStatement: statement ?? null };
}

/** A delivery gate cell: real, declared, and never CURRENT (§9A.9). */
function declared(rows: number, asOf: string | null, proof: PendingProof, of: string): GateEvidence {
  return { ...NO_EVIDENCE, covered: rows, total: rows, asOf, staleAfterDays: STRUCTURAL_STALE_DAYS, of, pendingProof: proof };
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
  of: string,
): Partial<Record<Gate, GateEvidence>> {
  if (asOf === null || universe <= 0) return {};
  return {
    // The source (a complete Census cartographic set) is known for the whole universe.
    SOURCE_KNOWN: frac(universe, universe, asOf, STRUCTURAL_STALE_DAYS, of),
    // We hold `held_` of the `universe` boundaries.
    ACQUIRED: frac(Math.min(held_, universe), universe, asOf, STRUCTURAL_STALE_DAYS, of),
  };
}

/* ------------------------------------------------------------- delivery gates */

/** The two gates a reader-delivery declaration can speak to, and nothing else. */
function deliveryGates(d: ReaderDelivery | undefined): Partial<Record<Gate, GateEvidence>> {
  if (!d || d.rows <= 0) return {};
  const where = d.surfaces.length > 0 ? d.surfaces.join(", ") : d.routes.join(", ");
  const out: Partial<Record<Gate, GateEvidence>> = {
    SHOWN_TO_READER: declared(
      d.rows,
      d.asOf,
      {
        says: "Shown on the Reader · verification proof needs a fresh check",
        detail:
          `${d.rows} ${d.unit} for this state are held in ${d.holding}, which the canonical dataset contract declares ` +
          `an input to the Reader (${where})` +
          (d.routes.length > 0 ? `, and which the deployment-trace contract requires the ${d.routes.join(" and ")} route(s) to be able to read` : "") +
          ". That is a standing declaration, not a count of rows a reader saw: it says the Reader is served from this holding, " +
          "and it does not re-prove that stated N equalled rendered rows today. A fresh reader readback is what would settle it.",
      },
      d.unit,
    ),
  };
  if (d.askAnswers) {
    out.ASK_ANSWERS = declared(
      d.rows,
      d.asOf,
      {
        says: "Ask is grounded in this holding · answer proof needs a fresh check",
        detail:
          `The same ${d.rows} ${d.unit} in ${d.holding} are a declared input to the grounded-Ask route, so Ask answers from ` +
          "this data rather than from general knowledge. What is not re-proved here is that a live Ask answer cited it today. " +
          "A fresh grounded-Ask readback is what would settle it.",
      },
      d.unit,
    );
  }
  return out;
}

/* ------------------------------------------------------------- coverage cells */

/** A capability's coverage phrase + fraction inputs, or a named-gap denominator. */
interface Coverage {
  readonly covered: number;
  readonly total: number | null;
  readonly authority: string | null;
  readonly label: string;
  readonly asOf: string | null;
  /** What to say where there is no external denominator; the row still counts. */
  readonly says: string | null;
}

function coverageFrac(covered: number, total: number, authority: string, asOf: string | null): Coverage {
  return { covered: Math.min(covered, total), total, authority, label: `${Math.min(covered, total)} of ${total}`, asOf, says: null };
}

/**
 * No external denominator — but the row still says what is held and why no
 * fraction can be drawn. "no external denominator" alone reads as "nothing
 * here", which is the exact misreading ADM-40 is about.
 */
function coverageGap(label = "no published count to measure against", says: string | null = null, asOf: string | null = null): Coverage {
  return { covered: 0, total: null, authority: null, label, asOf, says };
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
  const delivery = deliveryGates(a.delivery.find((d) => d.capabilityId === capabilityId));
  /* A government's own statement that this class does not exist here. */
  const absence = a.sourcedAbsences.find((s) => s.capabilityId === capabilityId) ?? null;

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
        gates: { ...heldBoundary(held_, universe, a.divisionsAsOf, "congressional district boundaries"), ...delivery },
      };
    }
    case "districts.state-legislative":
      // No committed STATEWIDE count of legislative districts exists — the
      // sldu/sldl geojson are county-clipped, not a statewide universe — so a
      // coverage fraction would be a self-denominator (CC-F2). Named gap, and no
      // gate may claim completeness against a universe we cannot establish. The
      // boundaries we DO hold are served to readers, and that is said, not hidden.
      return {
        coverage: coverageGap(
          `${(a.heldDivisions.sldu ?? 0) + (a.heldDivisions.sldl ?? 0)} district boundaries held`,
          "The committed legislative-district geometry is county-clipped, so there is no statewide universe to measure it against yet. The boundaries held are real and are served; the fraction is what is missing.",
          a.divisionsAsOf,
        ),
        gates: { ...delivery },
      };
    case "districts.county-precinct": {
      const total = c.COUNTY ?? null;
      const held_ = a.heldDivisions.county ?? 0;
      if (total === null) return { coverage: coverageGap(), gates: { ...delivery } };
      return {
        coverage: coverageFrac(held_, total, `${CENSUS} (counties; precincts not held)`, a.divisionsAsOf),
        gates: { ...heldBoundary(held_, total, a.divisionsAsOf, "county boundaries"), ...delivery },
      };
    }
    case "districts.school": {
      const total = c.SCHOOL_DISTRICT ?? null;
      const held_ = a.heldDivisions.school_district ?? 0;
      if (total === null) return { coverage: coverageGap(), gates: { ...delivery } };
      return {
        coverage: coverageFrac(held_, total, CENSUS, a.divisionsAsOf),
        gates: { ...heldBoundary(held_, total, a.divisionsAsOf, "school-district boundaries"), ...delivery },
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

    /* ---------------- Officials: delivery is the only committed instrument ---------------- */
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
          gates: { ACQUIRED: closedWalk(w.ref, w.asOf), VERIFIED: closedWalk(w.ref, w.asOf), ...delivery },
        };
      }
      // No external seat-count denominator is committed, and the officeholder
      // corpus does not record how many the publisher listed — so no fraction is
      // drawn and SOURCE_KNOWN/ACQUIRED stay unclaimed. What IS true is that the
      // records held are served, and the delivery gates say exactly that.
      const d = a.delivery.find((x) => x.capabilityId === capabilityId);
      return {
        coverage: d
          ? coverageGap(
              `${d.rows} ${d.unit} held`,
              "No external count of this state's seats is on file, so a coverage fraction would be a count checking itself. The records held are served to readers.",
              d.asOf,
            )
          : coverageGap(),
        gates: { ...delivery },
      };
    }
    case "officials.county":
    case "officials.municipal":
    case "officials.school-board":
    case "officials.special-district-boards":
      // Registry bodies are meeting/governing bodies, not official rosters; no
      // committed per-state roster instrument on current main -> NOT_WALKED.
      return { coverage: coverageGap(), gates: { ...delivery } };

    /* ---------------- Elections and ballot ---------------- */
    case "ballot.candidate-filings": {
      const f = a.ballotFilings;
      if (!f || f.candidacies <= 0) return { coverage: coverageGap(), gates: {} };
      const v = a.ballotVerification;
      return {
        // §8: the filing authority is sufficient authority evidence for who
        // filed. What it does not publish is a statewide total, so the row
        // carries its real counts and names the missing denominator.
        coverage: coverageGap(
          `${f.candidacies} filings · ${f.contests} contests`,
          `${f.candidacies} candidacy record(s) across ${f.contests} contest(s) are held from ${f.authority}, read from ${f.documents} filing document(s). ` +
            "The authority publishes the filings, not a count of how many exist statewide, so no coverage fraction is drawn against it.",
          f.asOf,
        ),
        gates: {
          // The publisher path is named, official and observed, and every held
          // record cites it. This is a claim about the SOURCE, not about coverage.
          SOURCE_KNOWN: frac(f.sourced, f.candidacies, f.asOf, RECONCILE_STALE_DAYS, "held candidacies citing a named government filing document"),
          // Records pulled and committed with an as-of. Same scope, same honesty.
          ACQUIRED: frac(f.candidacies, f.candidacies, f.asOf, RECONCILE_STALE_DAYS, `candidacy records committed from ${f.authority}`),
          // Verified only where an EXTERNAL reconciliation exists.
          ...(v ? { VERIFIED: frac(v.covered, v.total, v.asOf, RECONCILE_STALE_DAYS, "candidacies uniquely reconciled to the certified canvass") } : {}),
          ...delivery,
        },
      };
    }
    case "ballot.statewide-propositions": {
      const m = a.statewideMeasures;
      // A government's own statement that no statewide question is on a ballot
      // is a stronger absence than any ladder we could walk, and it is a
      // completely different fact from "nobody looked" (R-I).
      if (absence && (m === null || m.contests === 0)) {
        return {
          coverage: coverageGap(
            "none on this ballot",
            `${absence.authority}: ${absence.statement}`,
            absence.asOf,
          ),
          // All three left gates carry the absence: the authority that would
          // publish the question is the same authority saying there is none, so
          // the source is known, the record is the statement, and the statement
          // is the external verification. Leaving SOURCE_KNOWN unwalked beside
          // an argued absence would read as a contradiction it is not.
          gates: {
            SOURCE_KNOWN: closedWalk(absence.ref, absence.asOf, `${absence.authority}: ${absence.statement}`),
            ACQUIRED: closedWalk(absence.ref, absence.asOf, `${absence.authority}: ${absence.statement}`),
            VERIFIED: closedWalk(absence.ref, absence.asOf, `${absence.authority}: ${absence.statement}`),
          },
        };
      }
      if (!m || m.contests <= 0) return { coverage: coverageGap(), gates: { ...delivery } };
      return {
        coverage: coverageFrac(m.acquired, m.contests, m.authority, m.asOf),
        gates: {
          SOURCE_KNOWN: frac(m.contests, m.contests, m.asOf, RECONCILE_STALE_DAYS, "statewide measure contests on the acquired filing"),
          ACQUIRED: frac(m.acquired, m.contests, m.asOf, RECONCILE_STALE_DAYS, "statewide measures whose question text is held"),
          ...delivery,
        },
      };
    }
    case "ballot.local-measures": {
      const m = a.localMeasures;
      if (!m || m.contests <= 0) return { coverage: coverageGap(), gates: { ...delivery } };
      return {
        coverage: coverageFrac(m.acquired, m.contests, m.authority, m.asOf),
        gates: {
          SOURCE_KNOWN: frac(m.contests, m.contests, m.asOf, RECONCILE_STALE_DAYS, "local measure contests on the acquired filing"),
          ACQUIRED: frac(m.acquired, m.contests, m.asOf, RECONCILE_STALE_DAYS, "local measures whose question text is held"),
          ...delivery,
        },
      };
    }
    case "ballot.certified-results":
      return { coverage: coverageGap(), gates: { ...delivery } };

    /* ---------------- Campaign finance ---------------- */
    case "finance.federal-fec": {
      // CORRECTED 2026-09-06 (ADM-40): a deterministic state slice DOES exist —
      // every candidate row carries its own `state` and every absence a
      // state-bearing `targetKey`. The national counter is still never shown.
      const f = a.fec;
      if (f && f.total > 0) {
        return {
          coverage: coverageFrac(f.matched, f.total, f.authority, f.asOf),
          gates: {
            // Every candidacy on this state's ballot was looked up at the FEC:
            // the ones without filings carry a recorded absence with the FEC
            // search that established it, which is why the source is known for
            // the whole universe and not only for the ones that had money.
            SOURCE_KNOWN: frac(
              f.total,
              f.total,
              f.asOf,
              RECONCILE_STALE_DAYS,
              `federal candidacies for this state looked up at the FEC (${f.matched} hold filings; ${f.total - f.matched} carry a recorded absence with the FEC search that established it)`,
            ),
            ACQUIRED: frac(f.matched, f.total, f.asOf, RECONCILE_STALE_DAYS, "federal candidacies whose FEC filings are held"),
            // The FEC is the external authority and it is what our held filings
            // were reconciled against; nothing here checks a parser against
            // itself. Deliberately the SAME fraction as ACQUIRED rather than the
            // whole resolved universe: counting an argued absence as verified
            // would put verification ahead of acquisition, which is an
            // impossible state, not a stronger claim.
            VERIFIED: frac(f.matched, f.total, f.asOf, RECONCILE_STALE_DAYS, "federal candidacies whose held filings reconcile to the FEC's own record for them"),
            ...delivery,
          },
        };
      }
      return { coverage: coverageGap(), gates: { ...delivery } };
    }
    case "finance.state-disclosure": {
      const r = a.stateDisclosure;
      if (!r || r.total <= 0) return { coverage: coverageGap(), gates: { ...delivery } };
      const v = a.stateDisclosureVerification;
      return {
        coverage: coverageFrac(r.covered, r.total, r.authority, r.asOf),
        gates: {
          SOURCE_KNOWN: frac(r.total, r.total, r.asOf, RECONCILE_STALE_DAYS, `candidacies routed to ${r.authority}`),
          ACQUIRED: frac(r.covered, r.total, r.asOf, RECONCILE_STALE_DAYS, `candidacies whose disclosure filings are held from ${r.authority}`),
          ...(v ? { VERIFIED: frac(v.covered, v.total, v.asOf, RECONCILE_STALE_DAYS, "committees agreeing with the disclosure system on an independent re-read") } : {}),
          ...delivery,
        },
      };
    }
    case "finance.county-committees":
    case "finance.municipal":
      return { coverage: coverageGap(), gates: { ...delivery } };

    /* ---------------- Meetings and agendas: registry bodies + held agendas ---------------- */
    case "meetings.county-boards":
      return meetingsCap(a.bodies.county, a.heldAgendas.county, c.COUNTY ?? null, "county clerk agendas", delivery);
    case "meetings.city-councils":
      return meetingsCap(a.bodies.place, a.heldAgendas.place, c.CITY_OR_TOWN ?? null, "city clerk agendas", delivery);
    case "meetings.school-boards":
      return meetingsCap(a.bodies.school, a.heldAgendas.school, c.SCHOOL_DISTRICT ?? null, "district clerk agendas", delivery);
    case "meetings.planning-zoning":
      // Planning/zoning bodies are not separated in the registry -> NOT_WALKED.
      return { coverage: coverageGap(), gates: {} };

    default:
      return { coverage: coverageGap(), gates: {} };
  }
}

/**
 * Meetings capability from a level's governing bodies and its HELD agendas.
 *
 * The registry `coverageStatus` contract (lib/registry/types.ts) says LIVE means
 * "an adapter reads this body's calendar today" and MANUAL "hand-entered from a
 * source someone read" — a source/route that is KNOWN, NOT canonical agenda
 * material that is held. So those support SOURCE_KNOWN only (CC-F4).
 *
 * ACQUIRED is now derived, and from a DIFFERENT instrument: the count of
 * distinct bodies at this level with at least one meeting in
 * `data/meetings-snapshot.json` — the same normalized snapshot `/api/meetings`
 * serves. CC-F4's "no held-material instrument is wired here" is superseded by
 * the instrument existing, not by relaxing what registry status means.
 */
function meetingsCap(
  stat: BodyLevelStat,
  held_: HeldAgendaStat,
  total: number | null,
  authority: string,
  delivery: Partial<Record<Gate, GateEvidence>>,
): { coverage: Coverage; gates: Partial<Record<Gate, GateEvidence>> } {
  if (total === null) return { coverage: coverageGap(), gates: { ...delivery } };
  const acquired: Partial<Record<Gate, GateEvidence>> =
    held_.bodies > 0 && held_.asOf !== null
      ? {
          ACQUIRED: frac(
            Math.min(held_.bodies, total),
            total,
            held_.asOf,
            STRUCTURAL_STALE_DAYS,
            `bodies with at least one meeting held (${held_.meetings} meeting(s) on file)`,
          ),
        }
      : {};
  if (stat.asOf === null || stat.sourceLocated <= 0) {
    return {
      coverage: coverageFrac(0, total, `${CENSUS} (${authority}: sources located)`, null),
      gates: { ...acquired, ...delivery },
    };
  }
  return {
    coverage: coverageFrac(stat.sourceLocated, total, `${CENSUS} (${authority}: sources located)`, stat.asOf),
    gates: {
      // A source is LOCATED for these bodies (registry LIVE / KNOWN_UNCOVERED).
      SOURCE_KNOWN: frac(stat.sourceLocated, total, stat.asOf, STRUCTURAL_STALE_DAYS, "bodies with a located agenda source"),
      ...acquired,
      ...delivery,
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
      says: coverage.says,
    },
    gates,
  };
}

/**
 * **CAPABILITIES THE READER IS BEING SERVED, OF THE ROWS THIS GRID TRACKS.**
 * (ADM-39/§9A.7 "blank KPI cards": a dash is not a metric.)
 *
 * The old tile — "reader-visible jurisdictions" — could never hold a value,
 * because a reader-visible COUNT of jurisdictions has no instrument and the
 * tile therefore rendered a permanent em dash. This one is the question that
 * tile was reaching for and that the delivery instrument can actually answer:
 * how many of the capability rows below is the Reader served from a committed
 * holding? A measured zero here would be a fact, not a blank.
 */
export function capabilitiesServedToReaders(a: StateAuthorities): Held<Measured> {
  const served = new Set(a.delivery.filter((d) => d.rows > 0).map((d) => d.capabilityId));
  return held(
    measured(
      served.size,
      CAPABILITY_TAXONOMY.length,
      "capability rows whose committed holdings for this state are a declared input to a Reader surface, of the rows this grid tracks",
      "lib/holdings/datasets.ts (dataset → reader surface) and lib/holdings/reader-trace.ts (reader route → traced input file)",
    ),
  );
}

/**
 * **THE OLDEST AS-OF BEHIND ANY WALKED CELL** (ADM-39).
 *
 * Replaces "since the last full pass", which had no instrument and rendered a
 * permanent em dash — the second blank KPI the owner named. There is no record
 * of a full research pass per state, and inventing one from the publish time
 * would be a fabrication: the publisher re-derives the readout every cycle, and
 * re-reading instruments is not re-walking sources. What IS derivable, and is
 * what the tile was reaching for, is how old the oldest evidence on the grid is.
 */
export function oldestEvidenceDate(capabilities: readonly CapabilityInput[]): Held<string> {
  const dates: string[] = [];
  for (const cap of capabilities) {
    for (const ev of Object.values(cap.gates)) {
      if (ev && typeof ev.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ev.asOf)) dates.push(ev.asOf);
    }
  }
  if (dates.length === 0) {
    return gap<string>("OURS", "no cell on this grid carries a dated instrument yet, so there is no oldest evidence to report");
  }
  return held(dates.sort()[0]);
}

/**
 * **POPULATION IN A READER-COMPLETE ZIP, OF THE STATE'S POPULATION.**
 * (ADM-23, the 9.4.26 evening admin feedback.)
 *
 * The numerator sums the ACS population of every ZIP in the state (every one
 * the national ZIP index carries, since 2026-09-23) whose governing bodies are
 * ALL resolved (CURRENT or ARGUED_ABSENT — the same worst-of rule
 * `computeZipRow` applies); the denominator is the Bureau's
 * state total, external to us. Until a ZIP is complete the figure is
 * honestly 0 of the state — a measured zero, which is a different fact from
 * "not on file". Three named gaps, never a zero standing in for them:
 * no state total on file; no ZIP indexed for the state; every ZIP without a
 * tabulation area.
 */
export function populationInCompleteZip(a: StateAuthorities, zips: ReadinessInputs["zips"]): Held<Measured> {
  if (a.statePopulation === null) {
    return gap<Measured>("OURS", `no state population is on file for ${a.name} in the Census ACS state table, so a population-weighted completeness cannot be computed`);
  }
  if (zips.length === 0) return gap<Measured>("OURS", `the ZIP index carries no ZIP in ${a.name}, so no population can be counted as complete`);
  const withPopulation = zips.filter((z) => z.population.held);
  if (withPopulation.length === 0) {
    return gap<Measured>("OURS", `none of the ${zips.length} ZIP(s) in ${a.name} has a Census tabulation area on file, so no population can be counted`);
  }
  const resolved = (state: string) => state === "CURRENT" || state === "ARGUED_ABSENT";
  const complete = withPopulation.filter((z) => z.bodies.length > 0 && z.bodies.every((b) => resolved(b.state)));
  const value = complete.reduce((n, z) => n + (z.population.held ? z.population.value.value : 0), 0);
  return held(
    measured(
      Math.min(value, a.statePopulation),
      a.statePopulation,
      `residents of ZIPs whose every governing body is resolved (${complete.length} of ${withPopulation.length} ZIP(s) in ${a.name} with a population on file), of the state's ACS 5-Year 2024 total population`,
      "U.S. Census Bureau, American Community Survey 5-Year 2024 (table B01003), state total and ZIP Code Tabulation Area estimates",
    ),
  );
}

export function deriveStateInputs(
  a: StateAuthorities,
  meta: { readonly nowIso: string; readonly sha: string | null; readonly publisher: string },
  zips: ReadinessInputs["zips"],
): ReadinessInputs {
  const capabilities = CAPABILITY_TAXONOMY.map((row) => capabilityInput(row, a, meta.nowIso));

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
    delivery: a.delivery.filter((d) => d.rows > 0),
    capabilitiesServedToReaders: capabilitiesServedToReaders(a),
    populationInCompleteZip: populationInCompleteZip(a, zips),
    oldestEvidence: oldestEvidenceDate(capabilities),
  };
}
