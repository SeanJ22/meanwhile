/**
 * **PERSONAL-NAME FORMS, AS A PARSE — NEVER AS A SIMILARITY SCORE.**
 * (Session C3, 2026-09-01. RULING 229.)
 *
 * ## What this is for, and what it is forbidden from being
 *
 * Two Arizona election authorities publish the same 2026 candidates under
 * annotated forms of one name. The certified canvass writes
 * `Walter "Les" Presmyk`; the Secretary of State's candidate-filing list writes
 * the same person the same way; other pairs differ only in an annotation one
 * side chose to carry. Reconciling them requires knowing what an annotation
 * MEANS — not how close two strings look.
 *
 * **There is no fuzzy matching here and there may never be one.** No edit
 * distance, no token-subset test, no "closest" anything. Every function below
 * EXPANDS one published name into a finite set of EXACT strings, each labelled
 * with the annotation rule that produced it. A reconciliation is then string
 * equality between two such sets, and a nominee whose set shares nothing with
 * exactly one candidacy's set is simply not reconciled.
 *
 * The reason is measured rather than theoretical: this project has already
 * watched a name join turn five live committees into manufactured absences, and
 * the failure mode in the other direction is worse — a wrong join puts one
 * candidate's fundraising under their opponent's photograph. A candidate's
 * money is the single field where a plausible answer is more dangerous than no
 * answer.
 *
 * ## The rules, each named because the artifact records which one fired
 *
 * - `AS_PUBLISHED` — the name after Unicode and whitespace normalisation only.
 *   Nothing is removed. This is the form that matches in the ordinary case.
 * - `NICKNAME_REMOVED` — a quoted segment (`"Les"`, `“Nick”`) is an ANNOTATION
 *   the publisher added, so the name with it removed is a real form of the same
 *   name.
 * - `NICKNAME_AS_GIVEN` / `NICKNAME_AS_FAMILY` — the quoted segment standing in
 *   for one end of the name. **Both readings are generated, deliberately.**
 *   Arizona's own 2026 filings contain one of each — `Nicholas "Nick" Myers`
 *   (given) and `Rachel "Jones" Keshel` (family) — the publisher marks them
 *   identically, and nothing in the string says which is meant. Generating one
 *   reading would silently drop whichever candidate used the other; generating
 *   both costs nothing, because a form describing nobody matches nobody.
 * - `SUFFIX_REMOVED` — a trailing generational suffix (`Jr`, `Sr`, `II`…) is an
 *   annotation in exactly the same sense. Emitted ON TOP OF each rule above, so
 *   `Daniel Francis Butierez Sr.` reconciles whether or not the other authority
 *   carried the suffix.
 *
 * **A diminutive is not an annotation and is never inferred.** `Tom` is not
 * derived from `Thomas` anywhere in this file. Arizona's own control for that
 * is `Tom Horne` against the filed `Horne, Thomas Chalres`, and the correct
 * outcome there is that he stays unreconciled and renders an honest gap.
 */

/** Which annotation rule produced a form. Recorded in the artifact, per row. */
export type NameFormRule =
  | "AS_PUBLISHED"
  | "NICKNAME_REMOVED"
  | "NICKNAME_AS_GIVEN"
  | "NICKNAME_AS_FAMILY"
  | "SUFFIX_REMOVED";

export interface NameForm {
  /** The comparison string: normalised, case-folded, punctuation-folded. */
  form: string;
  /** Which rules were applied to reach it, in the order they were applied. */
  rules: NameFormRule[];
}

/**
 * Generational suffixes, as TOKENS.
 *
 * Deliberately short and closed. It holds the forms Arizona's two 2026
 * authorities actually publish and nothing speculative — a longer list is more
 * chances to delete a real name token (`Ross`, `Vi`) than to gain a match.
 */
const SUFFIX_TOKENS = new Set(["jr", "sr", "ii", "iii", "iv"]);

/**
 * Unicode and whitespace normalisation, applied to BOTH sides identically.
 *
 * Curly punctuation is the one that actually bites: a canvass transcribed from
 * a PDF carries `’` and `“ ”` where a JSON filing list carries `'` and `"`, and
 * two identical names then compare unequal for a reason no reader would accept.
 */
export function normalizeNameText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/ /g, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The comparison key for one already-parsed form.
 *
 * Case is folded and `.` is dropped, both symmetrically: `Michael D. Butts` and
 * `Michael D Butts` are one name written two ways, and a period is not a fact
 * about a person. Apostrophes and hyphens are KEPT — `O'Donnell` without its
 * apostrophe is a different surname, and dropping it would widen the key rather
 * than normalise it.
 */
function comparisonKey(text: string): string {
  return normalizeNameText(text).toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
}

/** The quoted annotation segments a publisher attached to a name, in order. */
export function quotedSegments(raw: string): string[] {
  const text = normalizeNameText(raw);
  return [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter((s) => s.length > 0);
}

function stripTrailingSuffix(tokens: string[]): string[] | null {
  if (tokens.length < 2) return null;
  const last = tokens[tokens.length - 1].replace(/\./g, "").toLowerCase();
  if (!SUFFIX_TOKENS.has(last)) return null;
  return tokens.slice(0, -1);
}

/**
 * Every exact form one published name may lawfully be compared as.
 *
 * The set always contains `AS_PUBLISHED`; everything else is present only when
 * the name actually carries the annotation that rule is about. Forms are
 * de-duplicated on their comparison key, keeping the SHORTEST rule chain, so
 * the artifact records the simplest true reason a pair matched.
 */
export function nameForms(raw: string): NameForm[] {
  const base = normalizeNameText(raw);
  const out = new Map<string, NameForm>();

  const add = (text: string, rules: NameFormRule[]) => {
    const key = comparisonKey(text);
    if (key.length === 0) return;
    const existing = out.get(key);
    if (existing && existing.rules.length <= rules.length) return;
    out.set(key, { form: key, rules });
  };

  add(base, ["AS_PUBLISHED"]);

  const quoted = quotedSegments(base);
  if (quoted.length > 0) {
    const withoutQuoted = normalizeNameText(base.replace(/"[^"]+"/g, " "));
    add(withoutQuoted, ["NICKNAME_REMOVED"]);
    const parts = withoutQuoted.split(" ").filter(Boolean);
    for (const alt of quoted) {
      if (parts.length >= 2) {
        add([alt, ...parts.slice(1)].join(" "), ["NICKNAME_AS_GIVEN"]);
        add([...parts.slice(0, -1), alt].join(" "), ["NICKNAME_AS_FAMILY"]);
      } else if (parts.length === 1) {
        add(`${alt} ${parts[0]}`, ["NICKNAME_AS_GIVEN"]);
      }
    }
  }

  /* SUFFIX_REMOVED rides on top of every form above rather than replacing it,
     so a suffix and a nickname on one name do not cancel each other out. */
  for (const form of [...out.values()]) {
    const shorter = stripTrailingSuffix(form.form.split(" ").filter(Boolean));
    if (shorter && shorter.length > 0) add(shorter.join(" "), [...form.rules, "SUFFIX_REMOVED"]);
  }

  return [...out.values()];
}

/** The comparison keys alone, for a set-intersection test. */
export function nameFormKeys(raw: string): Set<string> {
  return new Set(nameForms(raw).map((f) => f.form));
}

/**
 * Do two published names share at least one EXACT form, and which one?
 *
 * Returns the shared form with the shortest rule chain, or `null`. `null` is
 * the whole answer — there is no second-best return value, because there is no
 * such thing as an almost-match here.
 */
export function sharedNameForm(a: string, b: string): NameForm | null {
  const bKeys = new Map(nameForms(b).map((f) => [f.form, f]));
  let best: NameForm | null = null;
  for (const form of nameForms(a)) {
    const other = bKeys.get(form.form);
    if (!other) continue;
    const rules = form.rules.length <= other.rules.length ? form.rules : other.rules;
    if (best === null || rules.length < best.rules.length) best = { form: form.form, rules };
  }
  return best;
}
