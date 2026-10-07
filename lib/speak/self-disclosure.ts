import { SCRUB_MARK, scrubFreeText } from "../log/scrub.ts";

/**
 * Self-disclosure redaction for Speak rows. It reuses `lib/log/scrub.ts`
 * (email, phone and street-address shapes) and also reports what it found, so
 * the flag rides on the row and an export path reads a column: a flagged row
 * never exports verbatim.
 *
 * Names are not recognised as such (matching against officials we hold would
 * flag the sentiment the box collects). Only the act of introducing or signing
 * oneself is detected. This will miss some disclosures, which is why the flag
 * gates export rather than storage.
 */

export type SelfDisclosureFlag =
  /** An email-shaped token was present and was removed. */
  | "EMAIL"
  /** A run of seven or more digits — a phone, an account, an SSN. */
  | "PHONE_OR_NUMBER"
  /** A number followed by capitalised words: the street-address shape. */
  | "STREET_ADDRESS"
  /** The reader introduced or signed themselves by name. */
  | "SELF_NAMED";

export interface SelfDisclosureResult {
  /** What may be stored: scrubbed, and with any self-naming removed. */
  text: string;
  /**
   * What was found, in a stable order. EMPTY means the pass found nothing —
   * never that it did not run. `exportsVerbatim` reads this.
   */
  flags: SelfDisclosureFlag[];
  /**
   * The exact values removed, held in memory and NEVER stored. Used to strike
   * the same values from a second field (e.g. a generated answer that echoes
   * the reader's name; see `lib/db/ask-signal.ts`).
   */
  redactedValues: string[];
}

const EMAIL_SHAPED = /\S+@\S+\.\S+/;
const LONG_DIGIT_RUN = /\(?(?:\d[\s().-]{0,2}){6}\d[\d().-]*/;
const STREET_ADDRESS_SHAPED = /\b\d{1,6}(?:\s+[A-Z][A-Za-z]+){1,4}\b/;

/**
 * The self-introduction shapes. Each captures the NAME so it can be replaced,
 * and is anchored on the introducing phrase, so naming an official is untouched.
 */
/*
 * The case rules are split on purpose. The introducing phrase is
 * case-insensitive (explicit character class); the NAME is case-sensitive,
 * because the initial capital is what distinguishes a name from a word ("my
 * name is not important"). Only the sign-off pattern carries `i`, since its
 * capture is still `[A-Z]`.
 */
const SELF_NAMING: RegExp[] = [
  // "My name is Alma Hernandez", "my name's Alma"
  /\b[Mm]y name(?:'s| is)\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3})/g,
  // "I am Alma Hernandez", "I'm Alma" — capitalised, so "I'm angry" is safe.
  /\bI(?:'m| am)\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3})\b/g,
  // "This is Alma Hernandez"
  /\b[Tt]his is\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3})\s*(?:,|\.|$)/g,
  // A sign-off: "Signed, Alma Hernandez" / "- Alma Hernandez" at the end.
  /\b(?:signed|sincerely|regards|thanks),?\s+([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3})/gi,
  /(?:^|\n)\s*[-–—]{1,2}\s*([A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,3})\s*$/g,
];

/**
 * Redacts what identifies the WRITER, and says what was found. Detection runs
 * before the scrub, which replaces the very tokens that would be detected.
 */
export function redactSelfDisclosure(raw: string): SelfDisclosureResult {
  const flags = new Set<SelfDisclosureFlag>();
  /* What was taken out, so a second field can have it taken out too. Never stored. */
  const redactedValues: string[] = [];
  const remember = (value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed && trimmed.length > 1 && !redactedValues.includes(trimmed)) {
      redactedValues.push(trimmed);
    }
  };

  const email = EMAIL_SHAPED.exec(raw);
  if (email) {
    flags.add("EMAIL");
    remember(email[0]);
  }
  const digits = LONG_DIGIT_RUN.exec(raw);
  if (digits) {
    flags.add("PHONE_OR_NUMBER");
    remember(digits[0]);
  }
  const street = STREET_ADDRESS_SHAPED.exec(raw);
  if (street) {
    flags.add("STREET_ADDRESS");
    remember(street[0]);
  }

  // Self-naming is removed here; the shared scrub does not know about it.
  let text = raw;
  for (const pattern of SELF_NAMING) {
    text = text.replace(pattern, (whole, name: string) => {
      flags.add("SELF_NAMED");
      remember(name);
      return whole.replace(name, SCRUB_MARK);
    });
  }

  // Then the shared scrub, which removes the three token shapes above.
  text = scrubFreeText(text);

  const order: SelfDisclosureFlag[] = [
    "EMAIL",
    "PHONE_OR_NUMBER",
    "STREET_ADDRESS",
    "SELF_NAMED",
  ];
  return { text, flags: order.filter((flag) => flags.has(flag)), redactedValues };
}

/**
 * The export gate: a row carrying any self-disclosure flag may never leave
 * verbatim. It reads the STORED flags, because re-running the pass over
 * already-redacted text would find nothing.
 */
export function exportsVerbatim(row: { selfDisclosure: readonly string[] }): boolean {
  return row.selfDisclosure.length === 0;
}
