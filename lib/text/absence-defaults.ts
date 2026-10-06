/**
 * **THE ABSENCE-TO-ASSERTION SHAPE — a null falling through to a default that
 * READS AS A FINDING.** (Item 3, 2026-08-23.)
 *
 * ## The class, named from its three instances
 *
 * - **JUR-1.** A body card rendered *"Governs your area"* beside *"Boundary
 *   not published"* — two sentences that cannot both be true, from two code
 *   paths with nothing making them agree.
 * - **JUR-4.** The ballot annotated the 11th Congressional District as
 *   covering part of 07866 while the certainty was `UNKNOWN` rather than
 *   `AMBIGUOUS`. Caught only by reading the rendered page.
 * - **The party label.** `cand.partyLabel ?? "No party label filed"` on the
 *   ballot. A null far more often meant nobody had collected the party than
 *   that the filing carried none, and the card stated the second — a specific,
 *   checkable, false claim about a named person standing for office.
 *
 * All three are one shape: **a value we do not hold, given a default chosen
 * for the type's convenience, which a reader reads as something we found out.**
 *
 * ## Why a BASELINE and not a ban
 *
 * `x ?? "literal"` is everywhere and most of it is fine — an internal enum
 * default, a CSS token, a placeholder attribute, a log field. What is NOT fine
 * is a SENTENCE: a default that reads as prose about the subject. So the
 * matcher looks for sentence-shaped defaults in reader-facing render paths,
 * and every one of them is either fixed or carries a written REASON in
 * `tests/absence-defaults.json`.
 *
 * The baseline **only shrinks** — the same discipline
 * `tests/duplicate-implementations.json` runs under. A new sentence-shaped
 * default fails the build, and making the build pass means either fixing it or
 * writing down why it is not a claim, which is a diff a reviewer can see.
 *
 * @absence-defaults-definition
 */

/**
 * Where a reader-facing default can be written.
 *
 * `lib/` and `data/` are excluded deliberately: a default there becomes a
 * claim only when a render path uses it, and the render paths are all here.
 * A `lib` default that reaches a reader unchanged is caught by the
 * render-default rule directly, at the component that rendered it.
 */
export const RENDER_ROOTS = ["app", "components"] as const;

/**
 * A default is SENTENCE-SHAPED when it could be read as prose about the
 * subject rather than as a token: it holds a space and starts with a letter.
 *
 * `"unknown"`, `"local"`, `"place"`, `"xx"`, `"MINUTE"` are single tokens and
 * do not match — they are type defaults, and a type default that reaches a
 * reader is a different defect caught by the render-default rule directly.
 * `"No party label filed"` matches, which is the whole point.
 */
export const SENTENCE_DEFAULT = /(?:\?\?|\|\|)\s*"([A-Za-z][^"]*\s[^"]*)"/;

export interface AbsenceDefaultHit {
  line: number;
  /** The literal that would render. */
  text: string;
}

/**
 * Comments are stripped before matching, for the reason
 * `lib/text/refusal-shapes.ts` gives about its own sweep: a comment recording
 * why a default was removed contains the default, and flagging it would turn
 * the record of the fix into a defect — which is a direct incentive to delete
 * the record.
 */
export function absenceDefaultsIn(source: string): AbsenceDefaultHit[] {
  const out: AbsenceDefaultHit[] = [];
  if (source.includes("@absence-defaults-definition")) return out;
  const lines = source.split("\n");
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const open = line.indexOf("/*");
    if (open !== -1) {
      const close = line.indexOf("*/", open + 2);
      if (close === -1) {
        line = line.slice(0, open);
        inBlockComment = true;
      } else line = line.slice(0, open) + line.slice(close + 2);
    }
    const slash = line.indexOf("//");
    if (slash !== -1) line = line.slice(0, slash);
    const m = SENTENCE_DEFAULT.exec(line);
    if (m !== null) out.push({ line: i + 1, text: m[1] });
  }
  return out;
}

/** FE-31: reader gaps use the shared component; disclaimer copy cannot return. */
export function readerCopyViolations(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");
  return [...code.matchAll(/We(?:['’]|&apos;)re working on getting this info|not a statement that|not evidence that|We (?:don't|don’t|don&apos;t) hold/gi)].map(match => match[0]);
}
