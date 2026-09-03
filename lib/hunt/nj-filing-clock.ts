/**
 * **THE DECISION, SEPARATED FROM ITS PLUMBING.** (NJ Hunt 3 item 2, 2026-08-22.)
 *
 * `scripts/check-nj-filing.mts` fetches the Morris County Clerk's page, reads
 * its own hrefs for the current PDF versions, extracts each text layer and
 * parses it. None of that is the rule. The rule is one comparison, and it lives
 * here for the reason `lib/ops/job-watch.ts` gives about the same shape: a
 * check whose logic is only ever exercised against a live network is the shape
 * it exists to catch.
 *
 * ## What is being compared, and why it is a PAIR
 *
 * `data/states/nj/ballot/nj-morris-2026.json` is GENERATED from those PDFs. The clerk
 * republishes at a new version path on their own schedule and leaves the old
 * path reachable — `/v/9/…-082126.pdf` superseded `/v/6/…-080726.pdf` while NJ
 * Hunt 2 was running, so the New Jersey ballot was stale the day it shipped.
 *
 * A generated file whose source moves underneath it goes stale silently, and
 * **a hand transcription's only symptom is a contest that does not render** —
 * invisible to everyone except the reader whose race is missing, who has no way
 * to know it should have been there. So both numbers are stated and made to
 * reconcile: what the clerk PUBLISHES and what this repo RENDERS.
 *
 * ## The window is a DAY, against RULING 53's seven
 *
 * RULING 53 puts candidate fields on 7 days. This is deliberately tighter. A
 * county filing document is not a candidate field — **it is the ballot**. It is
 * revised on the authority's own schedule, and near a filing deadline or a
 * ballot-position drawing it moves daily. Seven days of staleness on a phone
 * number is a gap; seven days here renders a wrong ballot as a right one.
 */

/** Whole days between two `YYYY-MM-DD` stamps. Never negative. */
export function ageInDays(curatedAt: string, today: string): number {
  const a = Date.parse(`${curatedAt}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  /*
   * An unparseable stamp reads as INFINITELY stale rather than as fresh.
   * RULING 53: a record that cannot say when it was measured reads as stale,
   * because defaulting the other way is how a bad date buys permanent trust.
   */
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * Four states, kept apart for the standing reason: a check that could not reach
 * its subject must never print like one that agreed with it.
 */
export type FilingVerdict =
  | { state: "AGREES"; published: number; rendered: number; ageDays: number }
  | { state: "DIVERGED"; published: number; rendered: number; ageDays: number; why: string }
  | { state: "STALE"; published: number; rendered: number; ageDays: number; why: string }
  | { state: "CANNOT_TELL"; why: string };

export function compareFiling(input: {
  /** `null` when the clerk could not be read this run — NOT zero. */
  published: number | null;
  rendered: number;
  contestsRendered: number;
  curatedAt: string;
  today: string;
  maxAgeDays: number;
}): FilingVerdict {
  if (input.published === null) {
    return {
      state: "CANNOT_TELL",
      why: "the clerk's documents could not be read on this run",
    };
  }
  if (input.published === 0) {
    // A zero-row extraction is a FAILED extraction, never an empty document.
    return {
      state: "CANNOT_TELL",
      why: "the clerk's documents parsed to zero candidates — that is a failed parse, not an empty filing",
    };
  }

  const ageDays = ageInDays(input.curatedAt, input.today);

  if (input.contestsRendered === 0) {
    /*
     * Both candidate counts can agree while the page shows nothing, because
     * candidacies and contests are two different measurements. The D68 pair
     * rule is precisely about not letting one number stand in front of two.
     */
    return {
      state: "DIVERGED",
      published: input.published,
      rendered: input.rendered,
      ageDays,
      why: "the committed ballot renders no contests at all",
    };
  }
  if (input.published !== input.rendered) {
    return {
      state: "DIVERGED",
      published: input.published,
      rendered: input.rendered,
      ageDays,
      why:
        `the clerk publishes ${input.published} candidacies and this repo renders ` +
        `${input.rendered} — rebuild with \`pnpm nj:ballot --write\``,
    };
  }
  if (ageDays > input.maxAgeDays) {
    return {
      state: "STALE",
      published: input.published,
      rendered: input.rendered,
      ageDays,
      why: `last pulled ${ageDays} day(s) ago against a ${input.maxAgeDays}-day window (RULING 53)`,
    };
  }
  return { state: "AGREES", published: input.published, rendered: input.rendered, ageDays };
}
