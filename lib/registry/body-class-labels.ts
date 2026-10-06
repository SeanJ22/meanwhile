import type { BodyClass } from "./types.ts";
import { DEFAULT_KINDS, kindLabel, type KindTable } from "./kinds.ts";

/**
 * **RULING 118 — AN APPOINTED BODY NEVER CARRIES THE GOVERN VERB.**
 * **RULING 119 — A SOVEREIGN TRIBAL NATION IS ITS OWN CATEGORY OF GOVERNMENT.**
 * (Both 2026-08-24, closing `NS07` and `NS08`.)
 *
 * ## Why one module and not three maps
 *
 * There were three. `coverage-notice.tsx` had `BODY_CLASS_NOUN`,
 * `map-entry.tsx` had `CLASS`, and `door-overlay.tsx` had a BINARY —
 * `bodyClass === "GOVERNING" ? "Governing" : "Advisory"` — which meant that
 * the moment a fourth kind of body existed, that surface would call it
 * advisory. A tribal nation labelled "Advisory" is not a cosmetic defect; it
 * is a false claim about a sovereign government.
 *
 * That is the duplicate-implementation shape RULING 103 names: three copies,
 * no shared path, and a grep for the symptom finds none of them because they
 * do not share a single string. So the labels live here once.
 *
 * ## `NS07` — the govern verb, and what the rule actually covers
 *
 * The who-governs card's verb is GOVERN, and that is a stronger claim than
 * *is responsible for this area*. New Jersey's executive departments are
 * enumerated as bodies under RULING 57 and their rulemaking hearings are
 * exactly the there-is-a-hearing-Tuesday surface this product exists for — so
 * their MEETINGS were never in question.
 *
 * What was in question was the person. The rule (2026-08-24): **appointed
 * people never carry the govern verb, and neither does any role description.**
 * What to say instead: *"runs the department," "chair," "president of the
 * committee."*
 *
 * A Commissioner of Banking and Insurance is not somebody a reader elected and
 * cannot be voted out by them. Saying they *govern you* would tell a reader
 * something untrue about their own relationship to that person — and this
 * product's whole claim is that it does not do that.
 *
 * ## `NS08` — tribal nations, and why a new class rather than a flag
 *
 * The design: tribal nations are their own specific category of government —
 * and nationally, not an Arizona special case. New Mexico, Oklahoma and Texas
 * are coming.
 *
 * A sovereign nation is neither federal nor state nor local, and the existing
 * classes could only lie about it: `GOVERNING` inside a state hierarchy makes
 * it a subdivision of that state, which is precisely what it is not, and every
 * other value is worse. RULING 57 says the twig is as relevant as the trunk —
 * a sovereign nation is not a twig, it is a trunk this product had never
 * touched.
 *
 * **The govern verb is not forbidden here — it is UNSETTLED, and that is a
 * different thing.** Tribal jurisdiction turns on tribal membership and on land
 * status, not only on where a reader is standing, and this product resolves a
 * reader by geography alone. So it says what it can support: this nation's
 * government, its territory, its meetings — without asserting a governing
 * relationship it has not established.
 */

/**
 * The reader-facing name for each class. Plain language, 15-year-old test.
 * Never an enum, never a key.
 */
export interface BodyClassLabel {
  /** The short structural label, for a dense list row. */
  short: string;
  /** The fuller noun phrase, for a card. */
  long: string;
  /**
   * **May the GOVERN verb attach to this body for a reader?**
   *
   * `false` is not a smaller claim; it is a DIFFERENT one. An appointed
   * department runs something that affects the reader, and saying so is
   * accurate. Saying it governs them is not.
   */
  governVerbMayAttach: boolean;
  /** Why, in one sentence, so the rule travels with the value. */
  why: string;
}

export const BODY_CLASS_LABELS: Readonly<Record<BodyClass, BodyClassLabel>> = {
  GOVERNING: {
    short: "Governing",
    long: "Governing body",
    governVerbMayAttach: true,
    why: "Elected to govern a territory the reader can be inside of.",
  },
  ADVISORY: {
    short: "Advisory",
    long: "Advisory body",
    governVerbMayAttach: false,
    why: "Advises a governing body; it does not govern anybody itself.",
  },
  COMMISSION: {
    short: "Commission",
    long: "Commission",
    governVerbMayAttach: false,
    why: "Usually appointed, and its authority is over a subject rather than over a territory.",
  },
  REGIONAL: {
    short: "Regional",
    long: "Regional body",
    governVerbMayAttach: true,
    why: "Governs a territory that crosses municipal lines, and a reader can be inside it.",
  },
  PRIVATE_ASSOCIATION: {
    short: "Private",
    long: "Private association",
    governVerbMayAttach: false,
    why: "Not a government at all. It may matter to a resident and it is not their government.",
  },
  EXECUTIVE_AGENCY: {
    short: "Department",
    long: "Executive department",
    governVerbMayAttach: false,
    why:
      "Run by somebody appointed, not elected. It runs a department and holds hearings that " +
      "reach the reader; it is not somebody they chose or can vote out.",
  },
  SOVEREIGN_TRIBAL: {
    short: "Sovereign nation",
    long: "Sovereign tribal nation",
    governVerbMayAttach: false,
    why:
      "A sovereign government, neither federal nor state nor local. Its jurisdiction turns on " +
      "tribal membership and land status rather than on where a reader is standing, and this " +
      "product resolves a reader by geography alone — so the governing relationship is not ours to assert.",
  },
};

/** The short structural label. */
export function bodyClassShort(bodyClass: BodyClass, kinds: KindTable = DEFAULT_KINDS): string {
  return BODY_CLASS_LABELS[bodyClass]?.short ?? kindLabel(kinds, "body", bodyClass) ?? "Body";
}

/** The fuller noun phrase. */
export function bodyClassLong(bodyClass: BodyClass, kinds: KindTable = DEFAULT_KINDS): string {
  return BODY_CLASS_LABELS[bodyClass]?.long ?? kindLabel(kinds, "body", bodyClass) ?? "Body";
}

/**
 * **The one question every govern-verb surface must ask before it uses the
 * verb.** Asking it here rather than at each call site is what stops the next
 * surface reinventing the binary that would have called a tribal nation
 * advisory.
 */
export function governVerbMayAttach(bodyClass: BodyClass): boolean {
  return BODY_CLASS_LABELS[bodyClass]?.governVerbMayAttach ?? false;
}

/**
 * Classes whose bodies are led by APPOINTED people rather than elected ones.
 * Kept as a named set so a sweep can ask the question rather than matching
 * strings.
 */
export const APPOINTED_LED: readonly BodyClass[] = [
  "EXECUTIVE_AGENCY",
  "COMMISSION",
  "ADVISORY",
];
