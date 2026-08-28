/**
 * **ZERO DEFECTS ON A PARTIAL SUBSET IS NOT ZERO DEFECTS.**
 * (2026-08-27, the ask-entity session.)
 *
 * `pnpm coverage` reported, correctly and in this order:
 *
 * ```
 * INTEGRITY DEFECTS 0   COVERAGE GAPS 8   SURFACES NOT MEASURABLE 16
 * ```
 *
 * Sixteen of its surfaces are not measured at all. The instrument says so, at
 * length, on every run. What happened next is the thing this module exists to
 * prevent: the session report compressed that into **"0 integrity defects"**,
 * and a reader of the report — including a later session — would take it as a
 * statement about the product.
 *
 * It is not. It is a statement about twenty surfaces. And the proof that the
 * distinction is load-bearing rather than pedantic arrived within a day: a
 * tester found a reader-visible integrity defect — Ask answering about a
 * different government than the one named — that the instrument never reported,
 * because Ask was one of the surfaces it could not see.
 *
 * ## The rule
 *
 * A defect count may only ever be stated WITH its denominator, and the global
 * question — *is this product free of integrity defects?* — has a third answer
 * besides yes and no:
 *
 * ```
 * MEASURED_INTEGRITY_DEFECTS   n over the surfaces actually measured
 * UNMEASURED_SURFACES          m, each named, with the route that is missing
 * GLOBAL_INTEGRITY_STATUS      NOT_ESTABLISHED while m > 0
 * ```
 *
 * `NOT_ESTABLISHED` is not a failure and not a hedge. It is the honest verdict
 * for a question nobody has finished asking, and it is the same discipline the
 * rest of this repository already runs on: a check that could not run has found
 * nothing either way, an absence is never asserted, and a finite attempt count
 * never earns a completion.
 */

export type GlobalIntegrityStatus =
  /** Something is not measured. The global question is open, whatever n is. */
  | "NOT_ESTABLISHED"
  /** Everything in scope was measured and something is wrong. */
  | "DEFECTS_FOUND"
  /** Everything in scope was measured and nothing is wrong. */
  | "NO_DEFECTS_OVER_FULL_SCOPE";

export interface IntegrityTally {
  /** Surfaces the instrument actually measured. */
  measured: number;
  /** Surfaces it could not measure, each of which must stay NAMED. */
  unmeasured: number;
  /** Integrity defects found on the measured surfaces. */
  defects: number;
}

/**
 * The verdict, derived — never asserted.
 *
 * Note the order: **unmeasured surfaces decide first.** A run with zero defects
 * and one unmeasured surface is `NOT_ESTABLISHED`, not "clean with a caveat",
 * because the caveat is the only part that is load-bearing.
 */
export function globalIntegrityStatus(tally: IntegrityTally): GlobalIntegrityStatus {
  if (tally.unmeasured > 0) return "NOT_ESTABLISHED";
  return tally.defects > 0 ? "DEFECTS_FOUND" : "NO_DEFECTS_OVER_FULL_SCOPE";
}

/** The line a run prints, and the line a report is required to carry forward. */
export function globalIntegrityLine(tally: IntegrityTally): string {
  const status = globalIntegrityStatus(tally);
  const head =
    `MEASURED_INTEGRITY_DEFECTS ${tally.defects} of ${tally.measured} measured surface(s) · ` +
    `UNMEASURED_SURFACES ${tally.unmeasured} · GLOBAL_INTEGRITY_STATUS ${status}`;
  if (status !== "NOT_ESTABLISHED") return head;
  return (
    `${head}\n` +
    `  ${tally.unmeasured} surface(s) were not measured, so the product-wide question is OPEN. ` +
    `A defect\n  count of ${tally.defects} describes the ${tally.measured} surface(s) above and nothing else. ` +
    "Ask was an\n  unmeasured surface on 2026-08-27 and was carrying a reader-visible defect at the time."
  );
}

/**
 * **THE MECHANICAL GUARD.** Does this text turn a measured zero into a claim
 * about the product?
 *
 * It looks for a zero-defect statement that carries NO denominator anywhere
 * near it. The qualifier can be a count of measured surfaces, the word
 * "measured", or an explicit unmeasured/`NOT_ESTABLISHED` note — any of those
 * means the sentence is doing the right thing.
 *
 * Deliberately narrow. It has to be safe to run over prose that legitimately
 * discusses defect counts, so it fires only on the compressed shape that
 * actually misleads: a bare number of integrity defects presented as the
 * answer. Returning the offending fragments rather than a boolean is what lets
 * a caller name what to fix.
 */
export function unqualifiedGlobalClaims(text: string): string[] {
  const found: string[] = [];
  /*
   * A zero-defect statement, in either word order.
   *
   * **"integrity" is REQUIRED, not optional.** Without it this matched "the 0,0
   * defect" in `docs/synthetic-runs.md` — the NAME of a defect (a response of
   * zero meetings and zero bodies), not a count of zero defects. A guard that
   * fires on prose describing a bug is a guard that gets switched off, and the
   * claim this exists to catch is specifically about INTEGRITY defects.
   */
  const claim =
    /(?:\b(?:0|zero|no)\s+integrity\s+defects?\b|\bintegrity\s+defects?\s*[:=]?\s*(?:0|zero|none)\b)/gi;

  let m: RegExpExecArray | null;
  while ((m = claim.exec(text)) !== null) {
    /* The window a qualifier may live in — the sentence around the claim. */
    const from = Math.max(0, m.index - QUALIFIER_WINDOW);
    const to = Math.min(text.length, m.index + m[0].length + QUALIFIER_WINDOW);
    const window = text.slice(from, to);
    if (QUALIFIERS.some((q) => q.test(window))) continue;
    found.push(text.slice(from, to).replace(/\s+/g, " ").trim());
  }
  return found;
}

/** How far from the claim a denominator still counts as attached to it. */
const QUALIFIER_WINDOW = 240;

/**
 * Any one of these makes a zero-defect statement honest. They are the shapes a
 * denominator actually takes in this repository's own output and prose.
 */
const QUALIFIERS: readonly RegExp[] = [
  /\bmeasured\b/i,
  /\bunmeasured\b/i,
  /\bnot\s+measurable\b/i,
  /\bunmeasurable\b/i,
  /\bNOT_ESTABLISHED\b/,
  /\bGLOBAL_INTEGRITY_STATUS\b/,
  /\bof\s+\d+\s+surface/i,
  /\bsurfaces?\s+this\s+instrument\b/i,
];
