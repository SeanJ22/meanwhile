/**
 * Surname display case (2d, 2026-08-17).
 *
 * County clerks file candidates in ledger caps — the Morris County PDF ships
 * "BOOKER", "ROACH", "DeCROCE" — and rendering the shout verbatim fails the
 * plain-language rule: "Brian ROACH" reads like a form, not a person. This
 * is a *display* pass only; the filed string stays untouched in the data
 * files, and sorting still keys on the filed value.
 *
 * The pass is deliberately not naive title-case:
 * - it only fires when the source is shouting (all caps) — a mixed-case name
 *   is someone's chosen capitalization and is never "corrected";
 * - Mc- and O'/D'/L'-prefixed names keep their internal capital (McDonald,
 *   O'Brien, D'Amato);
 * - hyphenated and multi-word surnames case each part (Tang-Williams,
 *   Van Drew — U.S. ballots capitalize the particle, and a bearer who
 *   lowercases theirs belongs in the exceptions map);
 * - names with an internal capital no rule can recover (DeCroce, DiMaio,
 *   LaVecchia, MacDonald-with-a-capital-D) live in an exceptions map keyed
 *   on the all-caps form, because "DECROCE" alone cannot tell you where the
 *   capital goes.
 */

/** All-caps form → the bearer's actual capitalization. Extend as candidates
 *  with internal capitals appear on covered ballots. */
const EXCEPTIONS: Record<string, string> = {
  DECROCE: "DeCroce",
  DIMAIO: "DiMaio",
  DELGAUDIO: "DelGaudio",
  LAVECCHIA: "LaVecchia",
  MACDONALD: "MacDonald",
  MCDONALD: "McDonald",
};

/** Generational suffixes that are correctly all-caps and must not be cased. */
const KEEP_AS_IS = new Set(["II", "III", "IV", "V"]);

function caseWord(word: string): string {
  if (word.length === 0) return word;
  if (KEEP_AS_IS.has(word)) return word;
  const exception = EXCEPTIONS[word];
  if (exception) return exception;

  // O'BRIEN / D'AMATO / L'HEUREUX — capital after the apostrophe.
  const apostrophe = word.match(/^([ODL])(['’])(.+)$/);
  if (apostrophe) {
    return `${apostrophe[1]}${apostrophe[2]}${caseWord(apostrophe[3])}`;
  }

  // McDONALD / MCDONALD — Mc keeps its internal capital. (Mac is NOT safely
  // inferable — MACEY is not MacEy — so Mac names go via the exceptions map.)
  if (word.startsWith("MC") && word.length > 2) {
    return `Mc${caseWord(word.slice(2))}`;
  }

  return word.charAt(0) + word.slice(1).toLowerCase();
}

/**
 * Render a filed surname for display. Fires only on all-caps input; anything
 * already mixed-case passes through byte-identical.
 */
export function surnameDisplayCase(surname: string): string {
  const trimmed = surname.trim();
  if (trimmed.length === 0) return surname;
  // Not shouting (has any lowercase) → the filing already carries real
  // capitalization; keep it.
  if (trimmed !== trimmed.toUpperCase()) return surname;
  // Single letters with periods (initials like "B.") and suffixes keep form.
  return trimmed
    .split(/(\s+|-)/)
    .map((part) => (/^\s+$/.test(part) || part === "-" ? part : caseWord(part)))
    .join("");
}
