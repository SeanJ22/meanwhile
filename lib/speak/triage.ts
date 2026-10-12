/**
 * Abuse triage for the Speak box. Nothing here contacts anyone: a hit only marks
 * the row HELD for human review, which excludes it from everything else.
 *
 * Tiers: T0 political speech (the default; kept), T1 abusive but not
 * threatening, T2 concerning and ambiguous, T3 apparent threat or targeting.
 * Harsh political speech is the common case and must pass, so the patterns are
 * narrow and anchored on intent to act or on locating a person.
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

/** Harsh political speech that must always pass. */
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

/** What the rules look for, in plain words. */
export function triageRules(): { reason: ReviewReason; what: string }[] {
  return RULES.map(({ reason, what }) => ({ reason, what }));
}
