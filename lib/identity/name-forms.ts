/**
 * Personal-name forms, as a parse, never as a similarity score. Each function
 * expands one published name into a finite set of exact strings, each labelled
 * with the annotation rule that produced it; reconciliation is string equality
 * between two such sets. No edit distance, token-subset test or "closest".
 *
 * - `AS_PUBLISHED`: after Unicode and whitespace normalisation only.
 * - `NICKNAME_REMOVED`: a quoted segment (`"Nick"`) is a publisher's
 *   annotation, so the name without it is a real form.
 * - `NICKNAME_AS_GIVEN` / `NICKNAME_AS_FAMILY`: the quoted segment standing in
 *   for either end of the name. Both readings are generated, since the
 *   publisher marks both uses identically.
 * - `SUFFIX_REMOVED`: a trailing generational suffix, applied on top of each
 *   rule above.
 *
 * A diminutive is not an annotation and is never inferred (`Tom` is not
 * derived from `Thomas`).
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
 * Generational suffixes, as tokens. Short and closed: a longer list risks
 * deleting a real name token.
 */
const SUFFIX_TOKENS = new Set(["jr", "sr", "ii", "iii", "iv"]);

/**
 * Unicode and whitespace normalisation, applied to both sides identically
 * (curly quotes and apostrophes fold to straight ones).
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
 * The comparison key for one already-parsed form. Case is folded and `.` is
 * dropped; apostrophes and hyphens are kept (`O'Donnell` is a different surname
 * without its apostrophe).
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
 * Every exact form one published name may be compared as. Always contains
 * `AS_PUBLISHED`; other rules apply only when the name carries their
 * annotation. De-duplicated on the comparison key, keeping the shortest rule
 * chain.
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
 * Do two published names share at least one exact form, and which one? The
 * shared form with the shortest rule chain, or `null`.
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
