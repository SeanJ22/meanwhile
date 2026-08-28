import { SCRUB_MARK, scrubFreeText } from "../log/scrub.ts";

/**
 * **BC-11 RULE 3 — PII SELF-DISCLOSURE, REDACTED AND FLAGGED.**
 * (The author's ruling, 2026-08-24.)
 *
 * His words: *People type their own names, emails, phones, and street
 * addresses into boxes like this. Before any row can ever reach an export
 * path: a redaction pass flags self-identifying content, and a flagged row
 * never exports verbatim. Build the pass and the flag now, even though no
 * export path exists yet — the store is born safe, not retrofitted.*
 *
 * ## Why a FLAG and not just the existing scrub
 *
 * `lib/log/scrub.ts` (T09) already removes email-shaped, phone-shaped and
 * street-address-shaped tokens at every write path, and this reuses it rather
 * than reimplementing it — a second redactor is a second thing to drift.
 *
 * What the scrub cannot do is TELL YOU IT FIRED. It returns a string, so a row
 * that arrived clean and a row that arrived carrying somebody's phone number
 * are indistinguishable afterwards. The author's rule is about the second
 * kind: **a flagged row never exports verbatim**, and that is a decision an
 * export path has to be able to make. So the pass reports what it found, the
 * flag rides on the row, and the export question is answered by reading a
 * column rather than by re-running a classifier the export path might forget.
 *
 * ## A NAME is the hard one, and this does not try to recognise names
 *
 * A name is not a shape. "Alma" is a name and a word; every list of names is
 * incomplete and every list built from OUR OWN DATA would be worse than
 * incomplete — matching a reader's text against the officials we hold would
 * flag *"Ravi Shah should resign"*, which is the sentiment this box exists to
 * collect, while missing every reader whose name we do not happen to hold.
 *
 * What IS a shape is the act of INTRODUCING yourself. *My name is —*, *I'm
 * —*, *Signed, —*, a dash and a name at the end of a note. Those are patterns
 * in the disclosure rather than in the name, so they work for a reader called
 * Alma and for a reader called anything else, and they cannot fire on a reader
 * naming the official they are angry at.
 *
 * **This will miss some self-disclosures**, and that is stated rather than
 * hidden. It is why the flag gates EXPORT rather than storage: the row is
 * kept, the author reviews before anything is sold, and the pass narrows what
 * he has to look at instead of pretending to have finished the job.
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
   * **The exact values that were removed — held in memory, NEVER stored.**
   * (PR #212 follow-up, 2026-08-28.)
   *
   * Added because Ask stores two texts rather than one. A reader can write
   * *"My name is Alma Hernandez, when does the board meet?"*, and a synthesis
   * model can perfectly reasonably begin its reply *"Alma, the board meets
   * …"*. Scrubbing the question and truncating the answer would then persist,
   * in the answer column, exactly the name the question column correctly
   * removed — the store defeating its own redaction one field over.
   *
   * A shape-based pass cannot find that echo: "Alma" in the answer is not a
   * disclosure shape, it is a word. What CAN find it is knowing which value was
   * removed from the question and striking that same value from the answer,
   * which is what `lib/db/ask-signal.ts` does with this field.
   *
   * It is a return value and never a column. Nothing may write it anywhere.
   */
  redactedValues: string[];
}

const EMAIL_SHAPED = /\S+@\S+\.\S+/;
const LONG_DIGIT_RUN = /\(?(?:\d[\s().-]{0,2}){6}\d[\d().-]*/;
const STREET_ADDRESS_SHAPED = /\b\d{1,6}(?:\s+[A-Z][A-Za-z]+){1,4}\b/;

/**
 * The self-introduction shapes. Each captures the NAME so it can be replaced.
 *
 * Anchored on the introducing phrase, never on the name, so a reader who
 * writes *"Ravi Shah has ignored three of these"* is untouched — there is no
 * first person in front of it.
 */
/*
 * **THE CASE RULES ARE SPLIT ON PURPOSE, and getting it wrong is silent.**
 *
 * The INTRODUCING PHRASE is case-insensitive, because it starts a sentence as
 * often as not — "My name is" and "my name is" are one shape. The NAME is
 * case-SENSITIVE, because the initial capital is most of what distinguishes a
 * name from an ordinary word: with an `i` flag "my name is not important"
 * captures "not important" and redacts it.
 *
 * So the prefix carries an explicit character class rather than the flag, and
 * the sign-off pattern — the one place the whole match can safely be
 * case-insensitive, since the capture is still `[A-Z]` — keeps its `i`.
 *
 * The first draft used `\bmy name` with no flag and no class, so it matched
 * only a lower-case "my" and missed every sentence that began with the word.
 * That is a pass which passes: it reports no self-disclosure on the commonest
 * phrasing there is. The plant in `tests/speak-your-mind.test.ts` is what
 * caught it, which is the whole argument for planting real instances.
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
 * Redact what identifies the WRITER, and say what was found.
 *
 * Detection runs BEFORE the scrub, because the scrub replaces the very tokens
 * that would have to be detected — asking afterwards would report nothing on
 * every row, which is a pass that always passes.
 */
export function redactSelfDisclosure(raw: string): SelfDisclosureResult {
  const flags = new Set<SelfDisclosureFlag>();
  /* What was taken out, so a second field carrying the same text can have it
     taken out there too. Never stored — see `redactedValues`. */
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

  // Self-naming is removed here, because T09 does not know about it.
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
 * **The export gate.** A row carrying any self-disclosure flag may never leave
 * verbatim.
 *
 * Deliberately a function over the STORED flags rather than a re-classification
 * of the stored text: by the time a row is exported the text has already been
 * redacted, so re-running the pass would find nothing and answer yes to
 * everything. The row remembers what it arrived as.
 */
export function exportsVerbatim(row: { selfDisclosure: readonly string[] }): boolean {
  return row.selfDisclosure.length === 0;
}
