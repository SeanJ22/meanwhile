/**
 * What the final rendered Reader proof certifies about the footer's failed-
 * refresh disclosure (RLC-1, 2026-09-05): the page carries exactly the
 * sentences the served snapshot status requires, computed from the one
 * contract the footer renders from (`lib/meetings/freshness.ts`). The proof
 * holds no copy of the prose — its own copy is what refused two genuine
 * holding changes in refresh run #25 — and the check is not vacuous: a page
 * missing a required sentence, or carrying the OTHER form of the carried-rows
 * sentence, is named here. `tests/reader-freshness-disclosure.test.ts` pins
 * both directions against the actual footer component.
 */
import {
  carriedListingsSentence,
  freshnessDisclosure,
  type FreshnessDisclosure,
  type SnapshotStatus,
} from "../../lib/meetings/freshness.ts";

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();
/** `relativeAge`'s whole vocabulary — the `<time>` the REACHED_TOGETHER form ends with. */
const RELATIVE_AGE = /^(?:just now|\d+ (?:minute|hour|day)s? ago)\b/;

export interface FreshnessDisclosureCheck {
  /** What the served status required the footer to say. */
  required: FreshnessDisclosure;
  problems: string[];
}

export function freshnessDisclosureProblems(
  pageText: string,
  status: Pick<SnapshotStatus, "failed" | "carried">,
): FreshnessDisclosureCheck {
  const text = collapse(pageText);
  const required = freshnessDisclosure(status);
  const problems: string[] = [];
  if (required.unreachable && !text.includes(collapse(required.unreachable))) {
    problems.push(`the footer does not say: ${required.unreachable}`);
  }
  if (required.carried) {
    const { lead, form, reached, lastFreshAt, count } = required.carried;
    const sentence = collapse(`${lead} ${reached}`);
    const at = text.indexOf(sentence);
    if (at === -1) problems.push(`the footer does not say: ${sentence}`);
    else if (form === "REACHED_TOGETHER" && !RELATIVE_AGE.test(text.slice(at + sentence.length).trimStart())) {
      problems.push(`"${reached}" is not followed by when (${lastFreshAt})`);
    }
    // The other form is a claim the rows do not support: one date spoken for
    // rows that disagree, or a per-row deferral when one date is true of all.
    const other = collapse(`${lead} ${carriedListingsSentence(form === "REACHED_TOGETHER" ? "EACH_ON_ITS_OWN" : "REACHED_TOGETHER", count)}`);
    if (text.includes(other)) problems.push(`the footer says "${other}", which the carried rows do not support`);
  }
  return { required, problems };
}
