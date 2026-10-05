/**
 * **THE MEASURE STANDARD — what DONE means for a ballot measure.**
 * (2026-08-26, the descent session, Item 6a.)
 *
 * ## Why this exists before a single measure has shipped
 *
 * There is a definition of done for a CANDIDATE, enforced by `pnpm kelly`
 * (`lib/hunt/kelly-depth.ts`, RULING 143). **There is none for a ballot
 * measure.** So the first measures to land would land at whatever depth was
 * convenient on the day, and that depth would become the standard by
 * default — a standard nobody chose, set by whichever measure happened to be
 * easiest.
 *
 * Vail Unified has published an **Override Reauthorization 2026** and it does
 * not appear at `85641`. Pima County's Propositions 418 and 419 were on a March
 * 2026 ballot. The measures are already real; the definition is what is missing.
 *
 * ## The seven fields
 *
 * A measure is DONE when it carries all seven. Not a scale, not a tier — the
 * same reasoning as the Kelly standard, and for the same reason: **a tiered
 * standard tracks which measures had well-funded campaigns**, which is the
 * information asymmetry the equal-effort rule exists to catch.
 *
 * ## Equal effort is measured, not a publication gate
 *
 * Money is measured as a pair so an unfinished side remains visible as work.
 * Each verified fact publishes immediately; the score never holds its neighbor.
 * A sourced NONE_REGISTERED finding is distinct from NOT_HUNTED.
 *
 * ## The vote-recommendation ban is UNCHANGED
 *
 * Nothing here scores, ranks, leans, or orders. There is no `score`, no
 * `recommendation`, no `lean`, no aggregate. The household-cost field is a
 * FACT ABOUT A BILL and never an argument about it, and where the certifying
 * body publishes no official fiscal estimate **this product says so and does
 * not estimate one itself** — the never-generate-a-position rule, pointed at
 * money.
 */

/** The seven fields, named once so nothing drifts into an eighth or a sixth. */
export const MEASURE_FIELDS = [
  /** The official text AND the official summary, from the certifying body, cited. */
  "officialText",
  /** What it actually does, for a reader with no civic background. The founding promise. */
  "plainLanguage",
  /** What it does to a household's bill, in units a person feels. */
  "householdCost",
  /** Who certified it, by what authority, and on what date it appears. */
  "certification",
  /** Committees FOR. Half of a pair — never shippable alone. */
  "moneyFor",
  /** Committees AGAINST. The other half. */
  "moneyAgainst",
  /** A Sources section to the same standard as a candidate card. */
  "sources",
] as const;

export type MeasureField = (typeof MEASURE_FIELDS)[number];

/**
 * The two halves of the money pair.
 *
 * Named as a constant rather than left to a caller's memory, because the whole
 * point of this rule is that nothing may ship one without the other.
 */
export const MONEY_PAIR: readonly MeasureField[] = ["moneyFor", "moneyAgainst"];

/**
 * RULING 53's clock for a measure.
 *
 * **Fourteen days, not seven.** A measure's OFFICIAL TEXT does not change after
 * certification — that is what certification means — so it is a body-and-roster
 * shaped fact rather than a candidate-field shaped one. The money moves faster
 * and carries its own clock below.
 */
export const MEASURE_FIELD_EXPIRY_DAYS = 14;

/**
 * The money's own clock, and it is the SHORTER one.
 *
 * Committee filings change on statutory deadlines and a reader looking at a
 * three-week-old contribution total is looking at a different race. Seven days,
 * the candidate-field clock, because it is the same kind of moving target.
 */
export const MEASURE_MONEY_EXPIRY_DAYS = 7;

export type MeasureFieldState =
  /** Held, sourced, and inside its clock. */
  | "FOUND"
  /** Nobody has looked. Ours, and it reads as ours. */
  | "NOT_HUNTED"
  /** Hunted to exhaustion with a stuck protocol and an expiry (RULING 94, 144). */
  | "ARGUED_ABSENT"
  /**
   * A FINDING about the world, not about us. Only legal on the money fields and
   * only with the filing officer named: this contest has no registered
   * committee on this side. NEVER interchangeable with NOT_HUNTED.
   */
  | "NONE_REGISTERED"
  /**
   * The certifying body publishes no official fiscal estimate. A finding, and
   * the ONLY honest answer for `householdCost` in that case — this product does
   * not estimate a household's bill itself.
   */
  | "NO_OFFICIAL_ESTIMATE";

export interface MeasureFieldReading {
  readonly field: MeasureField;
  readonly state: MeasureFieldState;
  /** The day this was measured. RULING 107 — minted by the code that read. */
  readonly at: string | null;
  /** Required for NONE_REGISTERED: which officer was asked, under which statute. */
  readonly filingOfficer?: string;
  /** Required for NO_OFFICIAL_ESTIMATE: the body that publishes none, and where we looked. */
  readonly estimateSource?: string;
}

export interface MeasureReading {
  readonly measureId: string;
  readonly title: string;
  /** Which body certified it — the tier the measure sits at. */
  readonly certifyingBody: string;
  readonly fields: readonly MeasureFieldReading[];
}

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return day;
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/** Has this reading gone stale on its own clock? */
export function isStale(reading: MeasureFieldReading, today: string): boolean {
  if (reading.at === null) return true;
  const days = MONEY_PAIR.includes(reading.field) ? MEASURE_MONEY_EXPIRY_DAYS : MEASURE_FIELD_EXPIRY_DAYS;
  return addDays(reading.at, days) < today;
}

/**
 * Does a single field COUNT as satisfied today?
 *
 * `NONE_REGISTERED` and `NO_OFFICIAL_ESTIMATE` count — they are findings about
 * the world and the reader is better served by them than by silence. But each
 * carries a required companion field, and a reading that omits it does NOT
 * count: an unsourced finding is an assertion, which is the thing this product
 * exists not to make.
 */
export function fieldSatisfied(reading: MeasureFieldReading, today: string): boolean {
  if (isStale(reading, today)) return false;
  switch (reading.state) {
    case "FOUND":
    case "ARGUED_ABSENT":
      return true;
    case "NONE_REGISTERED":
      return Boolean(reading.filingOfficer && reading.filingOfficer.length > 0);
    case "NO_OFFICIAL_ESTIMATE":
      return Boolean(reading.estimateSource && reading.estimateSource.length > 0);
    case "NOT_HUNTED":
      return false;
  }
}

export interface SymmetryVerdict {
  readonly symmetric: boolean;
  /** Written to be read by somebody who is not looking for it. */
  readonly reason: string;
}

/** Scoreboard comparison only. It never controls whether a fact publishes. */
export function moneyCoverageSymmetry(reading: MeasureReading, today: string): SymmetryVerdict {
  const forSide = reading.fields.find((f) => f.field === "moneyFor");
  const againstSide = reading.fields.find((f) => f.field === "moneyAgainst");

  if (!forSide || !againstSide) {
    return {
      symmetric: false,
      reason:
        "one half of the money pair has no reading at all. Showing who funded the yes and not the no is " +
        "taking a side by omission, and a missing reading is how that happens without anybody deciding to.",
    };
  }

  const fOk = fieldSatisfied(forSide, today);
  const aOk = fieldSatisfied(againstSide, today);
  if (fOk && aOk) return { symmetric: true, reason: "both sides carry a satisfied reading" };
  if (!fOk && !aOk) {
    return { symmetric: true, reason: "neither side is hunted yet; both remain open work" };
  }

  const hunted = fOk ? "support" : "opposition";
  const notHunted = fOk ? "opposition" : "support";
  return {
    symmetric: false,
    reason:
      `the ${hunted} side is satisfied and the ${notHunted} side is not (${
        fOk ? againstSide.state : forSide.state
      }). Verified facts publish; the missing side remains open work. If that side has no registered ` +
      "committee, record NONE_REGISTERED with the filing officer named — which is a finding, and is not " +
      "the same thing as nobody having looked.",
  };
}

export type MeasureVerdict = "DONE" | "OWED" | "ASYMMETRIC_COVERAGE";

export interface MeasureScore {
  readonly measureId: string;
  readonly verdict: MeasureVerdict;
  readonly satisfied: number;
  readonly total: number;
  readonly owed: readonly MeasureField[];
  readonly symmetry: SymmetryVerdict;
}

/**
 * The whole standard, computed. DERIVED and never stored.
 *
 * A `measureDepth: "DONE"` column would be a claim that goes stale the moment
 * any source moves and nothing would notice — RULING 116's frozen gap in a
 * per-row costume. Same reasoning as the Kelly scoreboard's.
 *
 * ASYMMETRIC_COVERAGE reports which side still needs work. It is never a hold.
 */
export function scoreMeasure(reading: MeasureReading, today: string): MeasureScore {
  const symmetry = moneyCoverageSymmetry(reading, today);
  const owed: MeasureField[] = [];
  let satisfied = 0;

  for (const field of MEASURE_FIELDS) {
    const r = reading.fields.find((f) => f.field === field);
    if (r && fieldSatisfied(r, today)) satisfied += 1;
    else owed.push(field);
  }

  const verdict: MeasureVerdict = !symmetry.symmetric
    ? "ASYMMETRIC_COVERAGE"
    : satisfied === MEASURE_FIELDS.length
      ? "DONE"
      : "OWED";

  return { measureId: reading.measureId, verdict, satisfied, total: MEASURE_FIELDS.length, owed, symmetry };
}

/**
 * Keys no measure record may ever grow.
 *
 * The vote-recommendation ban, restated where a measure record is defined so it
 * cannot be reasoned around by somebody who read only this file. Guarded in
 * `tests/measure-depth.test.ts`.
 */
export const FORBIDDEN_MEASURE_KEYS = [
  "score",
  "rank",
  "rating",
  "match",
  "fit",
  "grade",
  "alignment",
  "recommendation",
  "lean",
  "endorsement",
] as const;
