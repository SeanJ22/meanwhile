/**
 * **BC-11 RULE 4 — ABUSE TRIAGE, NOT FORWARDING.**
 * (2026-08-24.)
 *
 * A "say it to their face" box will collect threats. Nothing typed here is
 * ever auto-forwarded to anyone. Flagged-severe rows go to a held queue for
 * the owner's review.
 *
 * ## The tiers are `docs/abuse-policy.md`'s, not new ones
 *
 * That document already models this: **T0** political speech (retained,
 * exported, no action), **T1** abusive but not threatening (retained, flagged,
 * excluded from export), **T2** concerning and ambiguous (held for human
 * review), **T3** apparent true threat or targeting (held immediately). A
 * second tier vocabulary would be a second policy, and only one of them could
 * be the one counsel reviewed.
 *
 * ## T0 IS THE DEFAULT AND IT IS THE COMMON CASE
 *
 * The policy says why, and it is the half most likely to be over-corrected:
 * *political speech about people seeking or holding power is harsh by design,
 * and harshness is the signal buyers want.* A constituent writing that a
 * council member is a corrupt liar who should be run out of town is exactly
 * what this box exists to collect. **Over-filtering degrades the product to
 * guard against a rare case**, and a box promising you can say what you would
 * say to their face and then swallowing it would be worse than not asking.
 *
 * So the patterns below are narrow, they are anchored on INTENT TO ACT or on
 * LOCATING A PERSON, and the known-good list holds the harsh political speech
 * that must always pass.
 *
 * ## NOTHING HERE CONTACTS ANYBODY
 *
 * There is no notifier in this module and there is no caller that could be one.
 * A hit sets `HELD` on a row, which excludes it from everything and puts it in
 * front of the author. The policy's own sentence: *a classifier hit is never
 * sufficient to contact law enforcement; every report passes human review
 * first* — because *"I'd kill for a bike lane on Speedway"* and *"someone
 * should make sure he doesn't make it to the next meeting"* score alike on
 * most classifiers, and sending police to the first person's house is the kind
 * of error that ends a product built on trust.
 *
 * ## This is `T05`'s first concrete surface, and `T05` stays open
 *
 * `T05` — *the abuse policy is written but the review path behind it does not
 * exist* — is a **Needs Sean** row, and RULING 37 says only he closes one.
 * This builds the HOLD half; the queue he reads and the act of reviewing are
 * his. A row is opened linking the two rather than resolving his.
 */

export type ReviewReason = "T1_ABUSIVE" | "T2_CONCERNING" | "T3_THREAT";

export interface Triage {
  reviewState: "NONE" | "HELD";
  reviewReason: ReviewReason | null;
}

interface Rule {
  reason: ReviewReason;
  what: string;
  pattern: RegExp;
}

/**
 * Ordered most severe first, so the first hit is the tier recorded. A message
 * that is both threatening and abusive is a threat.
 */
const RULES: readonly Rule[] = [
  {
    reason: "T3_THREAT",
    what: "states an intent to harm a specific person, or locates them",
    pattern:
      /\b(?:i(?:'m| am)\s+going\s+to|i(?:'ll| will))\s+(?:kill|shoot|stab|hurt|beat|burn)\b|\b(?:i know where|we know where)\s+(?:you|he|she|they)\s+live|\b(?:your|his|her|their)\s+(?:home address|kids['’]? school|children['’]? school|daily routine)\b/i,
  },
  {
    reason: "T2_CONCERNING",
    what: "menacing without a clear target or intent — violent imagery, weapons",
    pattern:
      /\b(?:someone\s+should\s+(?:make sure|see to it)|watch\s+(?:your|his|her|their)\s+back|won'?t\s+make\s+it\s+to\s+the\s+next\s+meeting|bring\s+a\s+(?:gun|rifle|weapon))\b/i,
  },
  {
    reason: "T1_ABUSIVE",
    what: "degrades a person's identity rather than their politics",
    pattern:
      /\b(?:go\s+back\s+to\s+(?:your|their)\s+country|people\s+like\s+(?:you|him|her|them)\s+don'?t\s+belong)\b/i,
  },
];

/**
 * Harsh political speech that must ALWAYS pass. Asserted in
 * `tests/speak-your-mind.test.ts`, because a triage that quietly swallowed
 * these would be the product refusing the sentiment it asked for.
 */
export const KNOWN_GOOD: readonly string[] = [
  "You are a corrupt liar and you should be run out of town.",
  "I'd kill for a bike lane on Speedway.",
  "Vote him out. He has ignored this neighbourhood for six years.",
  "This board is a disgrace and every one of you should resign.",
  "I am furious about the closure and I want an answer.",
];

export function triage(text: string): Triage {
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { reviewState: "HELD", reviewReason: rule.reason };
    }
  }
  return { reviewState: "NONE", reviewReason: null };
}

/** What the rules look for, in plain words — printed by any report over them. */
export function triageRules(): { reason: ReviewReason; what: string }[] {
  return RULES.map(({ reason, what }) => ({ reason, what }));
}
