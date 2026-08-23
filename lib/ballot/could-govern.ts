/**
 * **THE WORDS RULING 71's PILL SAYS.** (NJ Hunt 3 item 3, 2026-08-22.)
 *
 * Here rather than in the component for two reasons, and the second is the real
 * one:
 *
 * 1. The test runner cannot import a `.tsx`, so a guard that pins the SENTENCE
 *    rather than a class name needs the sentence to live in a `.ts` module.
 * 2. **The wording is the rule.** RULING 71 specifies the pill "in substance",
 *    and the substance is what separates it from a completeness marker: its
 *    subject must be the READER and their street, never us and never this
 *    record. `tests/could-govern-pill.test.ts` asserts that mechanically
 *    against the same lexicons the RULING 44 guard uses — so a future rewording
 *    that drifted toward *we don't know which one is yours* would fail the
 *    build rather than quietly reintroduce the badge RULING 42 deleted.
 *
 * The register is LEVEL, not playful: a contest card is a claim surface, and
 * nothing here is cute about a real municipality or a reader's home.
 */

/** The claim. Present tense, about the body, addressed to the reader. */
export const COULD_GOVERN_TEXT = "Could govern you";

/** The invitation. An offer the reader may decline at no cost. */
export const COULD_GOVERN_ACTION = "add your address to confirm";

/** The whole sentence, assembled once so nothing assembles it differently. */
export const COULD_GOVERN_SENTENCE = `${COULD_GOVERN_TEXT} — ${COULD_GOVERN_ACTION}`;

/**
 * **The reader-facing name of the BODY a contest sits on**, from its OCD-ID.
 *
 * Added 2026-08-23 for JUR-4's page-level block, over a defect that only
 * reading the rendered page showed. The first version of that block listed
 * `contest.title` — the OFFICE — so it told a reader that the governments
 * covering only part of their zip were *"Member of the Borough Council, Member
 * of the Board of Education, Member of the Board of Education — Unexpired
 * Term"*. Those are three job titles and two of them are the same one. A reader
 * who knows perfectly well which town they live in could not use it, which is
 * the entire purpose of naming the jurisdictions rather than counting them.
 *
 * It reads the LAST identifying segment, which is the body: `place:` for a
 * municipality, `school_district:` for a district, `county:` for a county.
 *
 * Casing is title case with the small words left alone, because these are
 * proper names of governments and *"Rockaway Township School District"* is how
 * that district writes its own name.
 */
const SMALL_WORDS = new Set(["of", "the", "and", "at", "on", "in", "for"]);

export function jurisdictionNameFromOcdId(ocdId: string): string | null {
  const segments = ocdId.split("/").filter((s) => s.includes(":"));
  // The body is the deepest segment that names a government, not `country` or
  // `state` — those are containers, and a block that said "New Jersey covers
  // only part of your zip" would be false as well as useless.
  const CONTAINERS = new Set(["ocd-division", "country", "state"]);
  const body = [...segments]
    .reverse()
    .find((s) => !CONTAINERS.has(s.split(":")[0] ?? ""));
  if (body === undefined) return null;
  const [type, value] = body.split(":");
  if (value === undefined || value.length === 0) return null;

  /*
   * Two types do not carry their own noun in the identifier, so a bare
   * title-casing of the value produces "Morris" and "11" — a county with no
   * word "county" in it, and a bare number. Both are supplied here rather than
   * at the call site, because a caller that had to remember would eventually be
   * a caller that forgot.
   */
  if (type === "cd") return `${ordinal(value)} Congressional District`;

  const titled = value
    .split("_")
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
  return type === "county" ? `${titled} County` : titled;
}

/** `11` → `11th`. Only the three irregular endings need naming. */
function ordinal(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ones = n % 10;
  return `${n}${ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"}`;
}
