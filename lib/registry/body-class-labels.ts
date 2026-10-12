import type { BodyClass } from "./types.ts";
import { DEFAULT_KINDS, kindLabel, type KindTable } from "./kinds.ts";

/**
 * Reader-facing labels for every body class, in one place so no surface falls back to a binary.
 *
 * Appointed bodies never carry the govern verb, and neither does any role description: say "runs the
 * department", "chair", "president of the committee". A sovereign tribal nation is its own category of
 * government, neither federal, state nor local; for it the govern verb is unsettled (tribal jurisdiction
 * turns on membership and land status, and readers are resolved by geography alone), so it is not used.
 */

/** The reader-facing name for each class. Plain language; never an enum or key. */
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

/** The one question every govern-verb surface must ask before it uses the verb. */
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
